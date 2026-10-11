/**
 * The `nx board` join: Nexus tasks (SQLite, via the API) × live Herdr agents.
 *
 * Read-only. A pane's current task is the `in_progress` one that names it
 * (`herdrPaneId` on a finished task is provenance, not ownership). Unclaimed
 * tasks fall back to a project by the agent pane's cwd, and a task pinned in
 * the agent's topic as `[#<id>]` is shown as a display-only hint. Nothing here
 * is ever persisted.
 */

import { currentTaskByPane } from "../lib/pane-link";
import { renderTable, shortId } from "./format";
import type { LiveAgent, Project, Task } from "./types";

export type BoardRow = {
  project: string;
  agent: string;
  status: string;
  task: string;
  taskStatus: string;
  topic: string;
};

export const BOARD_HEADERS = ["PROJECT", "AGENT (pane)", "LIVE STATUS", "TASK", "TASK STATUS", "TOPIC / NOTES"];

const STATUS_ICON: Record<string, string> = {
  working: "🟡",
  blocked: "🔴",
  idle: "🟢",
  done: "✅",
  unknown: "⚪",
};

const STATUS_ORDER = ["working", "blocked", "done", "idle", "unknown"];

const KIND_ICON: Record<string, string> = {
  pi: "π",
  claude: "✳",
  codex: "⌬",
  gemini: "✦",
  aider: "△",
  opencode: "◇",
};

type DraftRow = BoardRow & { statusKey: string };

function agentCell(agent: LiveAgent): string {
  const icon = KIND_ICON[agent.agentKind.trim().toLowerCase()] ?? "◆";
  return `${icon} ${agent.agentKind} (${agent.paneId})`;
}

function expandFolder(folder: string): string {
  const home = process.env.HOME ?? "";
  const expanded = folder.startsWith("~/") && home ? `${home}/${folder.slice(2)}` : folder;
  return expanded.replace(/\/+$/, "");
}

function projectForCwd(cwd: string, projects: Project[]): Project | null {
  if (!cwd) return null;
  return (
    projects.find((project) => {
      const folder = project.folderPath ? expandFolder(project.folderPath) : null;
      return folder !== null && (cwd === folder || cwd.startsWith(`${folder}/`));
    }) ?? null
  );
}

/** A task the agent pinned in its title/topic as `[#<id>]`, if any. Display-only. */
function hintedTask(agent: LiveAgent, tasks: Task[], taken: Set<string>): Task | null {
  const match = `${agent.terminalTitle} ${agent.topic ?? ""}`.match(/\[#([\w-]+)\]/);
  if (!match) return null;
  const ref = match[1];
  return tasks.find((task) => task.id.startsWith(ref) && !taken.has(task.id)) ?? null;
}

function projectName(projects: Project[], projectId: string | null): string {
  if (!projectId) return "";
  return projects.find((project) => project.id === projectId)?.name ?? shortId(projectId);
}

export function buildBoardRows(input: { tasks: Task[]; projects: Project[]; agents: LiveAgent[] }): BoardRow[] {
  const { tasks, projects, agents } = input;
  const rows: DraftRow[] = [];
  const shown = new Set<string>();

  const currentByPane = currentTaskByPane(tasks);
  const currentIds = new Set([...currentByPane.values()].map((task) => task.id));

  for (const agent of agents) {
    const current = currentByPane.get(agent.paneId) ?? null;
    const hint = current ? null : hintedTask(agent, tasks, currentIds);
    const task = current ?? hint;
    if (task) shown.add(task.id);

    const cwdProject = projectForCwd(agent.cwd, projects);
    rows.push({
      project: task ? projectName(projects, task.projectId) : (cwdProject?.name ?? agent.workspaceLabel),
      agent: agentCell(agent),
      status: `${STATUS_ICON[agent.status] ?? "⚪"} ${agent.status}`,
      statusKey: agent.status,
      task: task ? `#${shortId(task.id)} ${task.title}${hint ? " ~" : ""}` : "",
      taskStatus: task?.status ?? "",
      topic: agent.topic ?? "",
    });
  }

  for (const task of tasks) {
    if (shown.has(task.id) || task.status === "done") continue;
    rows.push({
      project: projectName(projects, task.projectId),
      agent: "",
      status: "",
      statusKey: "",
      task: `#${shortId(task.id)} ${task.title}`,
      taskStatus: task.status,
      topic: task.needsHuman ? (task.needsHumanReason ?? "needs human") : "",
    });
  }

  return rows.sort(compareRows).map(toBoardRow);
}

function compareRows(a: DraftRow, b: DraftRow): number {
  const project = compareProject(a.project, b.project);
  if (project !== 0) return project;
  const statusA = a.statusKey ? STATUS_ORDER.indexOf(a.statusKey) : STATUS_ORDER.length;
  const statusB = b.statusKey ? STATUS_ORDER.indexOf(b.statusKey) : STATUS_ORDER.length;
  if (statusA !== statusB) return statusA - statusB;
  return a.agent.localeCompare(b.agent);
}

/** Empty project sorts last so unclaimed rows gather at the bottom. */
function compareProject(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function toBoardRow(row: DraftRow): BoardRow {
  return {
    project: row.project,
    agent: row.agent,
    status: row.status,
    task: row.task,
    taskStatus: row.taskStatus,
    topic: row.topic,
  };
}

export function renderBoard(rows: BoardRow[], maxWidth: number): string {
  return renderTable(
    BOARD_HEADERS,
    rows.map((row) => [row.project, row.agent, row.status, row.task, row.taskStatus, row.topic]),
    maxWidth,
  );
}
