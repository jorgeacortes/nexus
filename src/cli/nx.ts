/**
 * `nx` — the thin command surface for the operator and the agents.
 *
 * This is an HTTP client and nothing else: it never imports SQLite or the
 * application layer, so it runs from any cwd, inside or outside the container,
 * and cannot corrupt the database. The board it talks to comes from `NEXUS_URL`,
 * then `~/.config/nexus/env`, then a probe of the local ports — the deployed
 * container before the dev server (see `board-target.ts`); `nx doctor` prints
 * what every candidate answered, and the chosen board is always reported.
 *
 *   nx ping / nx doctor
 *   nx project add|edit|list
 *   nx task add|list|show
 *   nx claim <id> / nx done <id> [--notes] / nx need <id> [--reason]
 *   nx review <id> [--undo]       record the operator's verification of a done task
 *   nx archive sweep / nx archive undo <id>
 *   nx board [--watch [seconds]]
 *   nx assign <id> --to <pane-id|auto>
 *
 * `--json` is accepted everywhere for scripting.
 */

import fs from "node:fs";

import { buildBoardRows, renderBoard } from "./board";
import {
  type BoardTarget,
  candidateUrls,
  configPath,
  configUrl,
  describeInstance,
  describeTarget,
  probeHttp,
  resolveBoard,
} from "./board-target";
import { orDash, renderTable, shortId, terminalWidth } from "./format";
import { compareTasks, DEFAULT_TASK_SORT, TASK_SORTS, type TaskSort } from "./task-sort";
import type {
  ApiEnvelope,
  ArchiveSweepResult,
  CloseHarnessResult,
  DetectLostAgentsResult,
  DispatchResult,
  LiveAgentsPayload,
  Project,
  Task,
} from "./types";

const DEFAULT_WATCH_SECONDS = 10;
const TASK_STATUSES = ["backlog", "ready", "in_progress", "blocked", "done"];
const TASK_PRIORITIES = ["blocker", "high", "normal", "low", "someday"];

/** Raised for every expected failure: printed as `nx: <message>`, never a stack trace. */
export class CliError extends Error {}

export type ParsedArgs = { positionals: string[]; flags: Map<string, string | true> };

/** Resolved once per process: every command in one invocation talks to one board. */
let resolvedBoard: Promise<BoardTarget> | null = null;
let probedBoardAnnounced = false;
let forceWrites = false;

/**
 * The board this invocation talks to, plus a one-line note on stderr the first
 * time the URL was only guessed by the probe, so a guess is never silent.
 */
async function currentBoard(): Promise<BoardTarget> {
  resolvedBoard ??= resolveBoard({ probe: probeHttp });
  const target = await resolvedBoard;
  if (target.source === "probe" && !probedBoardAnnounced) {
    probedBoardAnnounced = true;
    const also = target.reachable.slice(1);
    const suffix = also.length > 0 ? ` (also up: ${also.join(", ")})` : "";
    console.error(`nx: board ${describeTarget(target)} — probed${suffix}; pin it with NEXUS_URL or ${configPath()}`);
  }
  return target;
}

/**
 * A probed board with no projects is almost certainly the empty dev database, so
 * the write is refused unless the caller passes `--force` or pinned the URL.
 */
function assertWritable(target: BoardTarget): void {
  if (forceWrites || target.source !== "probe") return;
  const projects = target.instance?.counts.projects;
  if (projects === undefined || projects > 0) return;
  throw new CliError(
    `${describeTarget(target)} has no projects — refusing to write to a probed board (pass --force, or set NEXUS_URL)`,
  );
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Flags that never take a value, so the next token stays a positional. */
const BOOLEAN_FLAGS = new Set(["json", "force", "undo"]);

/** Parses `--key value`, `--key=value`, and `--flag`; `--watch` keeps a bare numeric value. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    if (equals !== -1) {
      flags.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      index += 1;
    }
  }
  return { positionals, flags };
}

export function parseDescription(rawDesc: string | null): string | null | undefined {
  if (rawDesc === null) return undefined;
  let description: string;
  if (rawDesc === "@-") {
    description = fs.readFileSync(0, "utf-8");
  } else if (rawDesc.startsWith("@")) {
    try {
      description = fs.readFileSync(rawDesc.slice(1), "utf-8");
    } catch (err) {
      throw new CliError(
        `cannot read description file ${rawDesc.slice(1)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    description = rawDesc.replace(/\\n/g, "\n");
  }
  return description.trim() === "" ? null : description;
}

function flagValue(flags: Map<string, string | true>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === "string" ? value : null;
}

/**
 * Reads a flag that can also be cleared: `undefined` when it was not passed,
 * `null` when it was passed as `-` / `none` / empty, otherwise the trimmed value.
 */
function clearableFlag(flags: Map<string, string | true>, name: string): string | null | undefined {
  const raw = flagValue(flags, name);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed.toLowerCase() === "none") return null;
  return trimmed;
}

/**
 * The PATCH body for `nx project edit`: only the fields the operator passed, so
 * an omitted one is left untouched and `-` / `none` / empty clears a nullable
 * one. This is the supported way to repoint a project at a Herdr workspace (a
 * dead `herdrWorkspaceId` is also repaired automatically by `dispatch`).
 */
export function projectEditBody(flags: Map<string, string | true>): {
  name?: string;
  folderPath?: string | null;
  herdrWorkspaceId?: string | null;
} {
  const body: { name?: string; folderPath?: string | null; herdrWorkspaceId?: string | null } = {};
  const name = flagValue(flags, "name");
  if (name !== null) body.name = name;
  const folder = clearableFlag(flags, "folder");
  if (folder !== undefined) body.folderPath = folder;
  const workspace = clearableFlag(flags, "workspace");
  if (workspace !== undefined) body.herdrWorkspaceId = workspace;
  if (Object.keys(body).length === 0) {
    throw new CliError("nx project edit: pass at least one field to edit (--name, --folder, --workspace)");
  }
  return body;
}

function hasFlag(flags: Map<string, string | true>, name: string): boolean {
  return flags.has(name);
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const target = await currentBoard();
  if ((init.method ?? "GET") !== "GET") assertWritable(target);
  let response: Response;
  try {
    response = await fetch(`${target.url}${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network error";
    throw new CliError(`cannot reach Nexus at ${target.url} (${detail})`);
  }
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!payload) {
    throw new CliError(`Nexus returned a non-JSON response (HTTP ${response.status})`);
  }
  if (payload.error !== null || !response.ok) {
    throw new CliError(payload.error ?? `request failed with HTTP ${response.status}`);
  }
  return payload.data;
}

const listProjects = () => request<Project[]>("/api/projects");
const listTasks = () => request<Task[]>("/api/tasks");
/** Active tasks plus archived ones, so claim and unarchive can still name a card that left the board. */
const listTasksIncludingArchived = () => request<Task[]>("/api/tasks?archived=include");
const readLiveAgents = () => request<LiveAgentsPayload>("/api/herdr/snapshot");

function resolveTask(ref: string | undefined, tasks: Task[]): Task {
  if (!ref) throw new CliError("Which task? Pass a task id (see `nx task list`).");
  const exact = tasks.find((task) => task.id === ref);
  if (exact) return exact;
  const matches = tasks.filter((task) => task.id.startsWith(ref));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new CliError(`Task id "${ref}" is ambiguous (${matches.length} matches).`);
  throw new CliError(`No task matches "${ref}".`);
}

function resolveProject(ref: string | undefined, projects: Project[]): Project {
  if (!ref) throw new CliError("Which project? Pass a project name or id (see `nx project list`).");
  const byId = projects.find((project) => project.id === ref);
  if (byId) return byId;
  const lowered = ref.toLowerCase();
  const byName = projects.find((project) => project.name.toLowerCase() === lowered);
  if (byName) return byName;
  const known = projects.map((project) => project.name).join(", ") || "none yet";
  throw new CliError(`No project matches "${ref}". Known projects: ${known}.`);
}

function projectName(projects: Project[], projectId: string | null): string {
  if (!projectId) return "—";
  return projects.find((project) => project.id === projectId)?.name ?? shortId(projectId);
}

/** Prints the payload as JSON or hands it to a human renderer. */
function output(flags: Map<string, string | true>, data: unknown, render: () => void): void {
  if (hasFlag(flags, "json")) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  render();
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function projectCommand(argv: string[]): Promise<void> {
  const [action, ...rest] = argv;
  const { positionals, flags } = parseArgs(rest);
  if (action === "list") {
    const projects = await listProjects();
    output(flags, projects, () =>
      console.log(
        renderTable(
          ["ID", "NAME", "FOLDER", "WORKSPACE"],
          projects.map((project) => [
            shortId(project.id),
            project.name,
            project.folderPath ?? "",
            project.herdrWorkspaceId ?? "",
          ]),
          terminalWidth(),
        ),
      ),
    );
    return;
  }
  if (action === "add") {
    const name = positionals[0];
    if (!name) throw new CliError("Usage: nx project add <name> [--folder <path>] [--workspace <id>]");
    const project = await request<Project>("/api/projects", {
      method: "POST",
      body: {
        name,
        folderPath: flagValue(flags, "folder"),
        herdrWorkspaceId: flagValue(flags, "workspace"),
      },
    });
    output(flags, project, () => {
      const folder = project.folderPath ? ` · ${project.folderPath}` : "";
      console.log(`Created project ${project.name} (${shortId(project.id)})${folder}`);
    });
    return;
  }
  if (action === "edit") {
    const ref = positionals[0];
    if (!ref) {
      throw new CliError(
        "Usage: nx project edit <name|id> [--name <text>] [--folder <path>| -] [--workspace <herdr-id>| -]",
      );
    }
    const project = resolveProject(ref, await listProjects());
    const updated = await request<Project>(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: projectEditBody(flags),
    });
    output(flags, updated, () => {
      const folder = updated.folderPath ? ` · ${updated.folderPath}` : "";
      const workspace = updated.herdrWorkspaceId ? ` · workspace ${updated.herdrWorkspaceId}` : "";
      console.log(`Updated project ${updated.name} (${shortId(updated.id)})${folder}${workspace}`);
    });
    return;
  }
  throw new CliError(`Unknown project action "${action ?? ""}". Try: nx project add|edit|list`);
}

async function taskCommand(argv: string[]): Promise<void> {
  const [action, ...rest] = argv;
  const { positionals, flags } = parseArgs(rest);

  if (action === "list") {
    const [projectRef] = positionals;
    const status = flagValue(flags, "status");
    const priority = flagValue(flags, "priority");
    const sortFlag = flagValue(flags, "sort");
    if (status && !TASK_STATUSES.includes(status)) {
      throw new CliError(`Unknown status "${status}". Known statuses: ${TASK_STATUSES.join(", ")}.`);
    }
    if (priority && !TASK_PRIORITIES.includes(priority)) {
      throw new CliError(`Unknown priority "${priority}". Known priorities: ${TASK_PRIORITIES.join(", ")}.`);
    }
    if (sortFlag && !TASK_SORTS.includes(sortFlag as TaskSort)) {
      throw new CliError(`Unknown sort "${sortFlag}". Known sorts: ${TASK_SORTS.join(", ")}.`);
    }
    const sort: TaskSort = sortFlag === "priority" ? "priority" : DEFAULT_TASK_SORT;
    const projects = await listProjects();
    let tasks = await listTasks();
    if (projectRef) {
      const project = resolveProject(projectRef, projects);
      tasks = tasks.filter((task) => task.projectId === project.id);
    }
    if (status) {
      tasks = tasks.filter((task) => task.status === status);
    }
    if (priority) {
      tasks = tasks.filter((task) => task.priority === priority);
    }
    tasks.sort((a, b) => compareTasks(a, b, sort));
    output(flags, tasks, () =>
      console.log(
        renderTable(
          ["ID", "STATUS", "PRIORITY", "TITLE", "PROJECT", "ASSIGNEE", "CLAIMED"],
          tasks.map((task) => [
            shortId(task.id),
            task.status,
            task.priority ?? "normal",
            task.title,
            projectName(projects, task.projectId),
            orDash(task.assignee),
            task.claimedAt ? new Date(task.claimedAt).toISOString().slice(0, 16).replace("T", " ") : "",
          ]),
          terminalWidth(),
        ),
      ),
    );
    return;
  }

  if (action === "add") {
    const [projectRef, title] = positionals;
    const status = flagValue(flags, "status");
    const priority = flagValue(flags, "priority");
    if (status && status !== "backlog" && status !== "ready") {
      throw new CliError(`nx task add only accepts --status backlog|ready (got "${status}").`);
    }
    if (priority && !TASK_PRIORITIES.includes(priority)) {
      throw new CliError(`Unknown priority "${priority}". Known priorities: ${TASK_PRIORITIES.join(", ")}.`);
    }
    if (!title) {
      throw new CliError(
        'Usage: nx task add <project> "<title>" [--description <text>] [--status backlog|ready] [--priority <level>]',
      );
    }
    let projectId: string | null = null;
    if (projectRef && projectRef !== "-") {
      projectId = resolveProject(projectRef, await listProjects()).id;
    }
    const task = await request<Task>("/api/tasks", {
      method: "POST",
      body: {
        projectId,
        title,
        description: flagValue(flags, "description"),
        status: status ?? undefined,
        priority: priority ?? undefined,
      },
    });
    output(flags, task, () =>
      console.log(`Created task #${shortId(task.id)} ${task.title} (${task.status}, ${task.priority ?? "normal"})`),
    );
    return;
  }

  if (action === "show") {
    const tasks = await listTasksIncludingArchived();
    const task = resolveTask(positionals[0], tasks);
    const projects = await listProjects();
    const target = await currentBoard();
    output(flags, task, () => {
      const lines: Array<[string, string]> = [
        ["id", task.id],
        ["title", task.title],
        ["status", task.status],
        ["priority", task.priority ?? "normal"],
        ["project", projectName(projects, task.projectId)],
        ["assignee", orDash(task.assignee)],
        ["agent", orDash(task.agentName)],
        ["harness", orDash(task.harness)],
        ["model", task.model ? `${task.model}${task.effort ? ` · ${task.effort}` : ""}` : "—"],
        ["pane", orDash(task.herdrPaneId)],
        ["claimed", orDash(task.claimedAt)],
        ["completed", orDash(task.completedAt)],
        ["reviewed", orDash(task.reviewedAt)],
        ["archived", orDash(task.archivedAt)],
        ["needs human", task.needsHuman ? (task.needsHumanReason ?? "yes") : "no"],
        ["description", orDash(task.description)],
        ["notes", orDash(task.completionNotes)],
        ["board", describeTarget(target)],
      ];
      const width = Math.max(...lines.map(([key]) => key.length));
      console.log(lines.map(([key, value]) => `${key.padEnd(width)}  ${value}`).join("\n"));
    });
    return;
  }

  if (action === "edit") {
    const idRef = positionals[0];
    if (!idRef) {
      throw new CliError(
        "Usage: nx task edit <id> [--title <text>] [--description <text>] [--status <status>] [--project <name>] [--priority <level>]",
      );
    }
    const title = flagValue(flags, "title");
    const rawDesc = flagValue(flags, "description");
    const status = flagValue(flags, "status");
    const projectRef = flagValue(flags, "project");
    const priority = flagValue(flags, "priority");

    if (title === null && rawDesc === null && status === null && projectRef === null && priority === null) {
      throw new CliError(
        "nx task edit: pass at least one field to edit (--title, --description, --status, --project, --priority)",
      );
    }

    if (status && !TASK_STATUSES.includes(status)) {
      throw new CliError(`Unknown status "${status}". Known statuses: ${TASK_STATUSES.join(", ")}.`);
    }
    if (priority && !TASK_PRIORITIES.includes(priority)) {
      throw new CliError(`Unknown priority "${priority}". Known priorities: ${TASK_PRIORITIES.join(", ")}.`);
    }

    const task = resolveTask(idRef, await listTasks());
    const description = parseDescription(rawDesc);

    let projectId: string | null | undefined;
    if (projectRef !== null) {
      if (projectRef === "-" || projectRef === "none" || projectRef === "") {
        projectId = null;
      } else {
        projectId = resolveProject(projectRef, await listProjects()).id;
      }
    }

    const updated = await request<Task>(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: {
        title: title ?? undefined,
        description: rawDesc !== null ? description : undefined,
        status: status ?? undefined,
        projectId,
        priority: priority ?? undefined,
      },
    });

    output(flags, updated, () =>
      console.log(
        `Updated task #${shortId(updated.id)} ${updated.title} (${updated.status}, ${updated.priority ?? "normal"})`,
      ),
    );
    return;
  }

  throw new CliError(`Unknown task action "${action ?? ""}". Try: nx task add|list|show|edit`);
}

async function claimCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const task = resolveTask(positionals[0], await listTasksIncludingArchived());
  const claimed = await request<Task>(`/api/tasks/${task.id}/claim`, {
    method: "POST",
    body: { paneId: envValue("HERDR_PANE_ID") },
  });
  output(flags, claimed, () =>
    console.log(`Claimed #${shortId(claimed.id)} ${claimed.title} — pane ${orDash(claimed.herdrPaneId)}`),
  );
}

async function doneCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const task = resolveTask(positionals[0], await listTasks());
  const completed = await request<Task>(`/api/tasks/${task.id}/complete`, {
    method: "POST",
    body: { notes: flagValue(flags, "notes") },
  });
  output(flags, completed, () => {
    const notes = completed.completionNotes ? ` — ${completed.completionNotes}` : "";
    console.log(`Completed #${shortId(completed.id)} ${completed.title}${notes}`);
  });
}

async function needCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const task = resolveTask(positionals[0], await listTasks());
  const updated = await request<Task>(`/api/tasks/${task.id}`, {
    method: "PATCH",
    body: { needsHuman: true, needsHumanReason: flagValue(flags, "reason") },
  });
  output(flags, updated, () =>
    console.log(`Flagged #${shortId(updated.id)} as needing human — ${orDash(updated.needsHumanReason)}`),
  );
}

/**
 * `nx review` records that the OPERATOR personally verified a done task.
 *
 * This is an operator assertion, never an agent self-assessment: an agent may
 * run it only when the operator has explicitly confirmed, in the conversation,
 * that they reviewed the task. "Tests pass" / "looks done" / "I finished it"
 * is not a review.
 */
async function reviewCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  if (!positionals[0]) {
    throw new CliError("Usage: nx review <id> [--undo]");
  }
  const undo = hasFlag(flags, "undo");
  const task = resolveTask(positionals[0], await listTasks());
  const updated = await request<Task>(`/api/tasks/${task.id}`, {
    method: "PATCH",
    body: { reviewed: !undo },
  });
  output(flags, updated, () => {
    if (updated.reviewedAt) {
      console.log(`Reviewed #${shortId(updated.id)} ${updated.title} — ${new Date(updated.reviewedAt).toISOString()}`);
      console.log(
        "This records the OPERATOR's personal verification, not an agent self-assessment — only run it when they confirmed they reviewed the work.",
      );
      return;
    }
    console.log(`Cleared review on #${shortId(updated.id)} ${updated.title}`);
  });
}

/**
 * `nx archive sweep` runs the one-shot sweep. `nx archive undo <id>` puts a
 * task back on the board as `ready`. The same sweep also runs when the board
 * or a task list is read; nothing here is on a timer.
 */
async function archiveCommand(argv: string[]): Promise<void> {
  const [action, ...rest] = argv;
  const { positionals, flags } = parseArgs(rest);

  if (action === "sweep") {
    const result = await request<ArchiveSweepResult>("/api/tasks/archive", { method: "POST" });
    output(flags, result, () => {
      if (result.archived.length === 0) {
        console.log("No tasks were ready to archive.");
        return;
      }
      console.log(`Archived ${result.archived.length} task(s).`);
      for (const task of result.archived) {
        console.log(`  • #${shortId(task.id)} ${task.title}`);
      }
    });
    return;
  }

  if (action === "undo") {
    const task = resolveTask(positionals[0], await listTasksIncludingArchived());
    if (!task.archivedAt) {
      throw new CliError(`#${shortId(task.id)} ${task.title} is not archived.`);
    }
    const restored = await request<Task>(`/api/tasks/${task.id}/unarchive`, { method: "POST" });
    output(flags, restored, () => {
      console.log(`Unarchived #${shortId(restored.id)} ${restored.title} — back on the board as ${restored.status}`);
    });
    return;
  }

  throw new CliError("Usage: nx archive sweep | nx archive undo <id>");
}

async function loadBoard(): Promise<{ rows: ReturnType<typeof buildBoardRows>; live: LiveAgentsPayload }> {
  const [tasks, projects, live] = await Promise.all([listTasks(), listProjects(), readLiveAgents()]);
  return { rows: buildBoardRows({ tasks, projects, agents: live.agents }), live };
}

function printBoard(
  rows: ReturnType<typeof buildBoardRows>,
  live: LiveAgentsPayload,
  json: boolean,
  target: BoardTarget,
): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          board: { url: target.url, source: target.source, instance: target.instance },
          agents: live.agents.length,
          available: live.available,
          rows,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`board · ${describeTarget(target)}`);
  console.log(renderBoard(rows, terminalWidth()));
  if (!live.available) {
    console.log(`\nHerdr unavailable${live.error ? `: ${live.error}` : ""} — showing task state only.`);
  }
}

async function boardCommand(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = hasFlag(flags, "json");
  const watch = flags.get("watch");
  const target = await currentBoard();
  if (watch === undefined) {
    const { rows, live } = await loadBoard();
    printBoard(rows, live, json, target);
    return;
  }

  const requested = watch === true ? DEFAULT_WATCH_SECONDS : Number.parseInt(watch, 10);
  const seconds = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_WATCH_SECONDS;
  process.on("SIGINT", () => process.exit(0));
  for (;;) {
    try {
      if (!json) process.stdout.write("\u001B[2J\u001B[H");
      const { rows, live } = await loadBoard();
      if (!json) {
        console.log(`nexus board · ${new Date().toLocaleTimeString()} · every ${seconds}s · Ctrl-C to exit\n`);
      }
      printBoard(rows, live, json, target);
    } catch (error) {
      console.log(`nx: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(seconds * 1000);
  }
}

/** `nx ping`: which board is in use, or a non-zero exit when none answers. */
async function pingCommand(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const target = await currentBoard();
  output(flags, target, () => console.log(`OK ${describeTarget(target)}`));
}

/** `nx doctor`: every candidate board, which one won, and what is suspicious about it. */
async function doctorCommand(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const target = await currentBoard();
  const configFile = configPath();
  const pinnedBy = process.env.NEXUS_URL?.trim() ? "NEXUS_URL (env)" : configUrl() !== null ? configFile : null;
  const candidates = candidateUrls();
  const urls = candidates.includes(target.url) ? candidates : [target.url, ...candidates];
  const probed = await Promise.all(
    urls.map(async (url) => {
      const result = await probeHttp(url);
      return { url, reachable: result.reachable, instance: result.reachable ? result.instance : null };
    }),
  );

  if (hasFlag(flags, "json")) {
    console.log(
      JSON.stringify(
        {
          board: { url: target.url, source: target.source, instance: target.instance },
          pinnedBy,
          configFile,
          configPresent: configUrl() !== null,
          candidates: probed,
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines: Array<[string, string]> = [
    ["board", describeTarget(target)],
    ["pinned by", pinnedBy ?? "nothing — probed"],
    ["config", `${configFile} (${configUrl() !== null ? "present" : "missing"})`],
  ];
  const width = Math.max(...lines.map(([key]) => key.length));
  console.log(lines.map(([key, value]) => `${key.padEnd(width)}  ${value}`).join("\n"));
  console.log("");
  console.log(
    renderTable(
      ["URL", "STATUS", "DATABASE", "TASKS", "PROJECTS", "USED"],
      probed.map((entry) => [
        entry.url,
        entry.reachable ? "up" : "down",
        entry.instance?.database ?? "",
        entry.instance?.counts.tasks === null || entry.instance?.counts.tasks === undefined
          ? ""
          : String(entry.instance.counts.tasks),
        entry.instance ? String(entry.instance.counts.projects) : "",
        entry.url === target.url ? "yes" : "",
      ]),
      terminalWidth(),
    ),
  );

  const warnings: string[] = [];
  if (target.source === "probe") {
    warnings.push(`probed: the selected board is a guess — pin it with NEXUS_URL or ${configFile}`);
  }
  if (target.instance === null) {
    warnings.push("the selected board has no /api/instance: identity unknown, so probed writes cannot be guarded");
  }
  if (target.instance !== null && target.instance.counts.projects === 0) {
    warnings.push("the selected board has no projects: writes are refused unless --force");
  }
  for (const entry of probed) {
    if (entry.reachable && entry.url !== target.url) {
      warnings.push(`also up: ${entry.url} · ${describeInstance(entry.instance)}`);
    }
  }
  for (const warning of warnings) console.log(`\n! ${warning}`);
}

async function assignCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const task = resolveTask(positionals[0], await listTasks());
  const to = flagValue(flags, "to");
  if (!to) throw new CliError("Usage: nx assign <id> --to <pane-id|auto>");
  const dispatched = await request<Task>(`/api/tasks/${task.id}/dispatch`, {
    method: "POST",
    body: to === "auto" ? { target: "auto" } : { paneId: to },
  });
  output(flags, dispatched, () => {
    const agent = dispatched.agentName ? ` (${dispatched.agentName})` : "";
    console.log(
      `Dispatched #${shortId(dispatched.id)} ${dispatched.title} → pane ${orDash(dispatched.herdrPaneId)}${agent}`,
    );
  });
}

/**
 * `nx dispatch` — the full create flow: lease → ensure workspace → place → start
 * agent → assign. Unlike `nx assign` it needs no pre-existing pane: it creates
 * the workspace and tab the agent runs in. A second dispatch of the same task is
 * refused by the lease.
 *
 * `nx dispatch close <tab>` is the sibling teardown and the **sanctioned** way to
 * close a harness tab (DESIGN-dispatch.md §3.2 / §4): it refuses, non-zero, while
 * any pane in the tab still holds live work. A raw `herdr tab close` bypasses it.
 *
 * `nx dispatch detect` is the one-shot sweep that covers that bypass
 * (DESIGN-dispatch.md §3.3): it reads the live snapshot once and flags any agent
 * whose pane vanished while its task was unfinished. It runs once per call — no
 * daemon, no timer.
 */
async function dispatchCommand(argv: string[]): Promise<void> {
  const closeAt = argv.indexOf("close");
  if (closeAt !== -1) {
    await dispatchCloseCommand([...argv.slice(0, closeAt), ...argv.slice(closeAt + 1)]);
    return;
  }
  const detectAt = argv.indexOf("detect");
  if (detectAt !== -1) {
    await dispatchDetectCommand([...argv.slice(0, detectAt), ...argv.slice(detectAt + 1)]);
    return;
  }
  const { positionals, flags } = parseArgs(argv);
  const task = resolveTask(positionals[0], await listTasks());
  const result = await request<DispatchResult>("/api/dispatch", { method: "POST", body: { taskId: task.id } });
  output(flags, result, () => {
    console.log(`Dispatched #${shortId(result.task.id)} ${result.task.title} (${result.placement})`);
    console.log(`  workspace  ${result.workspace.workspaceId} ${result.workspace.label} · ${result.workspaceOutcome}`);
    console.log(`  tab        ${orDash(result.dispatch.tabId)}`);
    console.log(`  pane       ${orDash(result.dispatch.paneId)}`);
    console.log(`  agent      ${orDash(result.dispatch.agentName)} · harness ${orDash(result.dispatch.harness)}`);
    console.log(`  lease      ${result.dispatch.leaseOwner} until ${result.dispatch.leaseUntil}`);
    console.log("  Nothing is closed automatically; close it later with `nx dispatch close <tab>`.");
  });
}

/**
 * `nx dispatch close <tab>` — the guarded teardown. It either closes the tab, or
 * the server refuses with 409 and `nx` exits non-zero, having taken no action.
 */
async function dispatchCloseCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const tabId = positionals[0];
  if (!tabId) throw new CliError("Usage: nx dispatch close <tab-id>");
  const result = await request<CloseHarnessResult>("/api/dispatch/close", { method: "POST", body: { tabId } });
  output(flags, result, () => {
    const label = result.tab.label ? ` "${result.tab.label}"` : "";
    console.log(
      `Closed tab ${result.tab.tabId}${label} (${result.paneCount} pane(s) checked, none holding live work).`,
    );
  });
}

/**
 * `nx dispatch detect` — the one-shot lost-agent sweep (DESIGN-dispatch.md §3.3).
 * Read-only with respect to Herdr: it only reads the snapshot, ends a dispatch
 * row as `lost` and flags the task. An unreadable snapshot exits non-zero and
 * flags nothing, so "Herdr is down" never reads as "every agent vanished".
 */
async function dispatchDetectCommand(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const result = await request<DetectLostAgentsResult>("/api/dispatch/detect", { method: "POST" });
  if (!result.available) {
    throw new CliError(
      `lost-agent detection did not run: ${result.reason ?? "the live Herdr snapshot is unavailable"}`,
    );
  }
  output(flags, result, () => {
    if (result.lost.length === 0) {
      console.log(
        `No lost agents (${result.checked} open dispatch(es): ${result.live} live, ${result.completed} with a done task).`,
      );
      return;
    }
    console.log(`Detected ${result.lost.length} lost agent(s); their tasks now need the operator.`);
    for (const finding of result.lost) {
      const agent = finding.agentName ?? "unknown agent";
      const harness = finding.harness ? ` · ${finding.harness}` : "";
      const tab = finding.tabId ? ` (tab ${finding.tabId})` : "";
      console.log(
        `  • #${shortId(finding.taskId)}  pane ${finding.paneId}${tab}  ${agent}${harness}  last seen ${finding.lastSeenStatus ?? "unknown"}`,
      );
      console.log(`    ${finding.reason}`);
    }
  });
}

function usage(): void {
  console.log(`nx — talk to the Nexus board over HTTP

  nx ping                        print the board in use (non-zero exit when none answers)
  nx doctor                      every candidate board, what answered, and warnings
  nx project add <name> [--folder <path>] [--workspace <herdr-id>]
  nx project edit <name|id> [--name <text>] [--folder <path>| -] [--workspace <herdr-id>| -]
  nx project list
  nx task add <project> "<title>" [--description <text>] [--status backlog|ready] [--priority <level>]
  nx task edit <id> [--title <text>] [--description <text>] [--status <status>] [--project <name>] [--priority <level>]
  nx task list [project] [--status <status>] [--priority <level>] [--sort activity|priority]
  nx task show <id>
  nx claim <id>                  claim for this Herdr pane ($HERDR_PANE_ID)
  nx done <id> [--notes <text>]  complete the task
  nx need <id> [--reason <t>]    flag the task as needing the operator
  nx review <id> [--undo]        record the OPERATOR's verification of a done task (or clear it)
  nx archive sweep               archive done tasks completed more than 7 days ago
  nx archive undo <id>           put an archived task back on the board as ready
  nx board [--watch [seconds]]   live join of tasks and Herdr agents (default 10s)
  nx assign <id> --to <pane-id|auto>  push the task's prompt into an existing Herdr pane
  nx dispatch <id>               lease, ensure workspace, place + start an agent, assign it
  nx dispatch close <tab-id>     guarded teardown: refuses while a pane holds live work
  nx dispatch detect             one-shot lost-agent sweep: flag tasks whose agent vanished

  --json is accepted everywhere. Task ids may be abbreviated to a unique prefix.
  --force writes to a probed board that has no projects.

  \`nx project add\` refuses a second project with the same name, matched
  case-insensitively on the trimmed name. The folder is not part of the
  identity, and add does not update the existing project. Use
  \`nx project edit\` to change its folder or workspace.

  \`nx project edit --workspace <id>\` is the supported way to repoint a project
  at a Herdr workspace; pass \`-\` to clear it. \`dispatch\` also repairs a dangling
  herdrWorkspaceId automatically when it resolves a project's workspace.

  nx review is an operator assertion, never an agent self-assessment: an agent
  may run it only when the operator has explicitly confirmed they reviewed the
  task. Running the tests, or the work merely looking finished, is not a review.

  \`nx dispatch close <tab>\` is the sanctioned way to close a harness tab: it
  refuses (non-zero, naming the pane/agent/status) while any pane in the tab has
  a working, blocked or unknown agent, an idle agent whose task is not done, or a
  foreground process. Never \`herdr tab close\` a tab you did not start.

  \`nx dispatch detect\` covers a raw \`herdr tab close\` Nexus cannot block: it reads
  the live snapshot once and flags any dispatched agent whose pane is gone while
  its task is unfinished. Run it on demand; nothing here runs on a timer.

  \`nx archive sweep\` is the same shape: one shot, no crontab line and no timer
  inside the app. Opening the board or listing tasks runs that sweep too, so a
  done card older than 7 days leaves the board when someone looks. Unarchive
  (\`nx archive undo\`) puts it back as ready and clears the completion stamp, so
  the next sweep does not immediately archive it again.

  The board comes from NEXUS_URL, then ${configPath()}, then the first of
  ${candidateUrls().join(", ")} that answers.`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  forceWrites = hasFlag(parseArgs(argv).flags, "force");
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      usage();
      return;
    case "ping":
      await pingCommand(rest);
      return;
    case "doctor":
      await doctorCommand(rest);
      return;
    case "project":
      await projectCommand(rest);
      return;
    case "task":
      await taskCommand(rest);
      return;
    case "claim":
      await claimCommand(rest);
      return;
    case "done":
      await doneCommand(rest);
      return;
    case "need":
      await needCommand(rest);
      return;
    case "review":
      await reviewCommand(rest);
      return;
    case "archive":
      await archiveCommand(rest);
      return;
    case "board":
      await boardCommand(rest);
      return;
    case "assign":
      await assignCommand(rest);
      return;
    case "dispatch":
      await dispatchCommand(rest);
      return;
    default:
      throw new CliError(`Unknown command "${command}". Run \`nx help\`.`);
  }
}

main().catch((error: unknown) => {
  console.error(`nx: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
