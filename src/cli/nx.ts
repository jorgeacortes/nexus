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
 *   nx project add|list
 *   nx task add|list|show
 *   nx claim <id> / nx done <id> [--notes] / nx need <id> [--reason]
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
import type { ApiEnvelope, LiveAgentsPayload, Project, Task } from "./types";

const DEFAULT_WATCH_SECONDS = 10;
const TASK_STATUSES = ["backlog", "ready", "in_progress", "blocked", "done"];
const TASK_PRIORITIES = ["blocker", "high", "normal", "low", "someday"];
const PRIORITY_ORDER: Record<string, number> = { blocker: 0, high: 1, normal: 2, low: 3, someday: 4 };

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
const BOOLEAN_FLAGS = new Set(["json", "force"]);

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
  throw new CliError(`Unknown project action "${action ?? ""}". Try: nx project add|list`);
}

async function taskCommand(argv: string[]): Promise<void> {
  const [action, ...rest] = argv;
  const { positionals, flags } = parseArgs(rest);

  if (action === "list") {
    const [projectRef] = positionals;
    const status = flagValue(flags, "status");
    const priority = flagValue(flags, "priority");
    if (status && !TASK_STATUSES.includes(status)) {
      throw new CliError(`Unknown status "${status}". Known statuses: ${TASK_STATUSES.join(", ")}.`);
    }
    if (priority && !TASK_PRIORITIES.includes(priority)) {
      throw new CliError(`Unknown priority "${priority}". Known priorities: ${TASK_PRIORITIES.join(", ")}.`);
    }
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
    tasks.sort((a, b) => {
      const pA = PRIORITY_ORDER[a.priority ?? "normal"] ?? 2;
      const pB = PRIORITY_ORDER[b.priority ?? "normal"] ?? 2;
      if (pA !== pB) return pA - pB;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
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
    const tasks = await listTasks();
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
  const task = resolveTask(positionals[0], await listTasks());
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

function usage(): void {
  console.log(`nx — talk to the Nexus board over HTTP

  nx ping                        print the board in use (non-zero exit when none answers)
  nx doctor                      every candidate board, what answered, and warnings
  nx project add <name> [--folder <path>] [--workspace <herdr-id>]
  nx project list
  nx task add <project> "<title>" [--description <text>] [--status backlog|ready] [--priority <level>]
  nx task edit <id> [--title <text>] [--description <text>] [--status <status>] [--project <name>] [--priority <level>]
  nx task list [project] [--status <status>] [--priority <level>]
  nx task show <id>
  nx claim <id>                  claim for this Herdr pane ($HERDR_PANE_ID)
  nx done <id> [--notes <text>]  complete the task
  nx need <id> [--reason <t>]    flag the task as needing the operator
  nx board [--watch [seconds]]   live join of tasks and Herdr agents (default 10s)
  nx assign <id> --to <pane-id|auto>  push the task's prompt into a Herdr pane

  --json is accepted everywhere. Task ids may be abbreviated to a unique prefix.
  --force writes to a probed board that has no projects.

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
    case "board":
      await boardCommand(rest);
      return;
    case "assign":
      await assignCommand(rest);
      return;
    default:
      throw new CliError(`Unknown command "${command}". Run \`nx help\`.`);
  }
}

main().catch((error: unknown) => {
  console.error(`nx: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
