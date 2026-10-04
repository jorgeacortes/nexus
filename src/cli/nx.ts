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
 *
 * `--json` is accepted everywhere for scripting.
 */

const DEFAULT_URL = "http://localhost:3100";
const TASK_STATUSES = ["backlog", "ready", "in_progress", "blocked", "done"];

/** Raised for every expected failure: printed as `nx: <message>`, never a stack trace. */
class CliError extends Error {}

type Task = {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: string;
  assignee: string | null;
  agentName: string | null;
  harness: string | null;
  model: string | null;
  effort: string | null;
  herdrPaneId: string | null;
  needsHuman: boolean;
  needsHumanReason: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  completionNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

type Project = {
  id: string;
  name: string;
  folderPath: string | null;
  herdrWorkspaceId: string | null;
  createdAt: string;
};

type ApiEnvelope<T> = { data: T; error: string | null };

type ParsedArgs = { positionals: string[]; flags: Map<string, string | true> };

function baseUrl(): string {
  return (process.env.NEXUS_URL?.trim() || DEFAULT_URL).replace(/\/+$/, "");
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Flags that never take a value, so the next token stays a positional. */
const BOOLEAN_FLAGS = new Set(["json"]);

/** Parses `--key value`, `--key=value`, and `--flag`; numeric values stay with `--watch`. */
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

/** Prints the payload as JSON or hands it to a human renderer. */
function output(flags: Map<string, string | true>, data: unknown, render: () => void): void {
  if (hasFlag(flags, "json")) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  render();
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** Approximate terminal cell width (wide/emoji code points count as two). */
function cellWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    width += isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2b00 && codePoint <= 0x2bff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f000 && codePoint <= 0x1faff)
  );
}

function clip(text: string, width: number): string {
  if (cellWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const character of text) {
    const size = isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1;
    if (used + size > width - 1) break;
    out += character;
    used += size;
  }
  return `${out}…`;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - cellWidth(text)));
}

const GAP = "  ";

/** Width-bounded table: header, rule, rows; the widest columns shrink to fit. */
function renderTable(headers: string[], rows: string[][], maxWidth: number): string {
  const widths = headers.map((header, index) =>
    Math.max(cellWidth(header), ...rows.map((row) => cellWidth(row[index] ?? ""))),
  );
  let total = widths.reduce((sum, width) => sum + width, 0) + (headers.length - 1) * GAP.length;
  while (total > maxWidth) {
    let widest = 0;
    for (let index = 1; index < widths.length; index += 1) {
      if (widths[index] > widths[widest]) widest = index;
    }
    if (widths[widest] <= Math.max(8, cellWidth(headers[widest]))) break;
    widths[widest] -= 1;
    total -= 1;
  }
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => pad(clip(cell, widths[index]), widths[index]))
      .join(GAP)
      .trimEnd();
  const rule = headers.map((_, index) => "─".repeat(widths[index])).join(GAP);
  return [line(headers), rule, ...rows.map((row) => line(row))].join("\n");
}

function terminalWidth(): number {
  const columns = process.stdout.columns;
  return columns && columns > 40 ? columns : 120;
}

function printTable(headers: string[], rows: string[][]): void {
  console.log(renderTable(headers, rows, terminalWidth()));
}

function orDash(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "—";
}

function projectName(projects: Project[], projectId: string | null): string {
  if (!projectId) return "—";
  return projects.find((project) => project.id === projectId)?.name ?? shortId(projectId);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function projectCommand(argv: string[]): Promise<void> {
  const [action, ...rest] = argv;
  const { positionals, flags } = parseArgs(rest);
  if (action === "list") {
    const projects = await listProjects();
    output(flags, projects, () =>
      printTable(
        ["ID", "NAME", "FOLDER", "WORKSPACE"],
        projects.map((project) => [
          shortId(project.id),
          project.name,
          project.folderPath ?? "",
          project.herdrWorkspaceId ?? "",
        ]),
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
      printTable(
        ["ID", "STATUS", "TITLE", "PROJECT", "ASSIGNEE", "CLAIMED"],
        tasks.map((task) => [
          shortId(task.id),
          task.status,
          task.title,
          projectName(projects, task.projectId),
          orDash(task.assignee),
          task.claimedAt ? new Date(task.claimedAt).toISOString().slice(0, 16).replace("T", " ") : "",
        ]),
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
      console.log(lines.map(([key, value]) => `${pad(key, width)}  ${value}`).join("\n"));
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
  output(flags, completed, () =>
    console.log(
      `Completed #${shortId(completed.id)} ${completed.title}${completed.completionNotes ? ` — ${completed.completionNotes}` : ""}`,
    ),
  );
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

function usage(): void {
  console.log(`nx — talk to Nexus over HTTP (NEXUS_URL, default ${DEFAULT_URL})

  nx project add <name> [--folder <path>] [--workspace <herdr-id>]
  nx project list
  nx task add <project> "<title>" [--description <text>] [--status backlog|ready]
  nx task list [project] [--status <status>]
  nx task show <id>
  nx claim <id>                 claim for this Herdr pane ($HERDR_PANE_ID)
  nx done <id> [--notes <text>]  complete the task
  nx need <id> [--reason <t>]    flag the task as needing the operator

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
    default:
      throw new CliError(`Unknown command "${command}". Run \`nx help\`.`);
  }
}

main().catch((error: unknown) => {
  console.error(`nx: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
