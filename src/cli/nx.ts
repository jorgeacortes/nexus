/**
 * `nx` — the thin command surface for the operator and the agents.
 *
 * This is an HTTP client and nothing else: it never imports SQLite or the
 * application layer, so it runs from any cwd, inside or outside the container,
 * and cannot corrupt the database. Set `NEXUS_URL` to point at another host.
 *
 *   nx project add|list
 *   nx task add|list|show
 *   nx claim <id> / nx done <id> [--notes] / nx need <id> [--reason]
 *   nx board [--watch [seconds]]
 *   nx assign <id> --to <pane-id|auto>
 *
 * `--json` is accepted everywhere for scripting.
 */

import { buildBoardRows, renderBoard } from "./board";
import { orDash, renderTable, shortId, terminalWidth } from "./format";
import type { ApiEnvelope, LiveAgentsPayload, Project, Task } from "./types";

const DEFAULT_URL = "http://localhost:3100";
const DEFAULT_WATCH_SECONDS = 10;
const TASK_STATUSES = ["backlog", "ready", "in_progress", "blocked", "done"];

/** Raised for every expected failure: printed as `nx: <message>`, never a stack trace. */
class CliError extends Error {}

type ParsedArgs = { positionals: string[]; flags: Map<string, string | true> };

function baseUrl(): string {
  return (process.env.NEXUS_URL?.trim() || DEFAULT_URL).replace(/\/+$/, "");
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Flags that never take a value, so the next token stays a positional. */
const BOOLEAN_FLAGS = new Set(["json"]);

/** Parses `--key value`, `--key=value`, and `--flag`; `--watch` keeps a bare numeric value. */
function parseArgs(argv: string[]): ParsedArgs {
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

function flagValue(flags: Map<string, string | true>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === "string" ? value : null;
}

function hasFlag(flags: Map<string, string | true>, name: string): boolean {
  return flags.has(name);
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network error";
    throw new CliError(`cannot reach Nexus at ${baseUrl()} (${detail})`);
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
    if (status && !TASK_STATUSES.includes(status)) {
      throw new CliError(`Unknown status "${status}". Known statuses: ${TASK_STATUSES.join(", ")}.`);
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
    output(flags, tasks, () =>
      console.log(
        renderTable(
          ["ID", "STATUS", "TITLE", "PROJECT", "ASSIGNEE", "CLAIMED"],
          tasks.map((task) => [
            shortId(task.id),
            task.status,
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
    if (status && status !== "backlog" && status !== "ready") {
      throw new CliError(`nx task add only accepts --status backlog|ready (got "${status}").`);
    }
    if (!title) {
      throw new CliError('Usage: nx task add <project> "<title>" [--description <text>] [--status backlog|ready]');
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
      },
    });
    output(flags, task, () => console.log(`Created task #${shortId(task.id)} ${task.title} (${task.status})`));
    return;
  }

  if (action === "show") {
    const tasks = await listTasks();
    const task = resolveTask(positionals[0], tasks);
    const projects = await listProjects();
    output(flags, task, () => {
      const lines: Array<[string, string]> = [
        ["id", task.id],
        ["title", task.title],
        ["status", task.status],
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
      ];
      const width = Math.max(...lines.map(([key]) => key.length));
      console.log(lines.map(([key, value]) => `${key.padEnd(width)}  ${value}`).join("\n"));
    });
    return;
  }

  throw new CliError(`Unknown task action "${action ?? ""}". Try: nx task add|list|show`);
}

async function claimCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const task = resolveTask(positionals[0], await listTasks());
  const claimed = await request<Task>(`/api/tasks/${task.id}/claim`, {
    method: "POST",
    body: {
      paneId: envValue("HERDR_PANE_ID"),
      agentName: envValue("HERDR_AGENT") ?? envValue("HERDR_TAB_ID"),
    },
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

function printBoard(rows: ReturnType<typeof buildBoardRows>, live: LiveAgentsPayload, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ agents: live.agents.length, available: live.available, rows }, null, 2));
    return;
  }
  console.log(renderBoard(rows, terminalWidth()));
  if (!live.available) {
    console.log(`\nHerdr unavailable${live.error ? `: ${live.error}` : ""} — showing task state only.`);
  }
}

async function boardCommand(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = hasFlag(flags, "json");
  const watch = flags.get("watch");
  if (watch === undefined) {
    const { rows, live } = await loadBoard();
    printBoard(rows, live, json);
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
      printBoard(rows, live, json);
    } catch (error) {
      console.log(`nx: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(seconds * 1000);
  }
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
  console.log(`nx — talk to Nexus over HTTP (NEXUS_URL, default ${DEFAULT_URL})

  nx project add <name> [--folder <path>] [--workspace <herdr-id>]
  nx project list
  nx task add <project> "<title>" [--description <text>] [--status backlog|ready]
  nx task list [project] [--status <status>]
  nx task show <id>
  nx claim <id>                  claim for this Herdr pane ($HERDR_PANE_ID)
  nx done <id> [--notes <text>]  complete the task
  nx need <id> [--reason <t>]    flag the task as needing the operator
  nx board [--watch [seconds]]   live join of tasks and Herdr agents (default 10s)
  nx assign <id> --to <pane|auto>  push the task's prompt into a Herdr pane

  --json is accepted everywhere. Task ids may be abbreviated to a unique prefix.`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      usage();
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
