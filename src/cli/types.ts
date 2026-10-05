/** Wire shapes shared by the `nx` commands, so the CLI stays independent of the app. */

/**
 * `/api/instance` — which board answered. `dataDir`/`database` are null and
 * `counts.tasks` is null when a board predates the route and only its project
 * list could be read.
 */
export type BoardInstance = {
  dataDir: string | null;
  database: string | null;
  counts: { projects: number; tasks: number | null };
};

export type Task = {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
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
  reviewedAt: string | null;
  completionNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  folderPath: string | null;
  herdrWorkspaceId: string | null;
  createdAt: string;
};

/** One `dispatches` row as `POST /api/dispatch` returns it. */
export type Dispatch = {
  id: string;
  taskId: string;
  workspaceId: string | null;
  tabId: string | null;
  paneId: string | null;
  agentName: string | null;
  harness: string | null;
  leaseOwner: string;
  leaseUntil: string;
  startedAt: string | null;
  endedAt: string | null;
  outcome: string | null;
  createdAt: string;
};

/** The live Herdr workspace a dispatch resolved or created. */
export type HarnessWorkspace = {
  workspaceId: string;
  label: string;
  tabCount: number;
  paneCount: number;
  agentStatus: string;
  activeTabId: string | null;
};

/** `POST /api/dispatch` payload: the task, the ledger row and where it landed. */
export type DispatchResult = {
  task: Task;
  dispatch: Dispatch;
  workspace: HarnessWorkspace;
  workspaceOutcome: string;
  matchedBy: string | null;
  placement: string;
};

/** Live agent row from `/api/herdr/snapshot` (Herdr state, never stored in SQLite). */
export type LiveAgent = {
  paneId: string;
  tabId: string;
  workspaceId: string;
  workspaceLabel: string;
  tabLabel: string;
  agentKind: string;
  harness: string | null;
  status: string;
  cwd: string;
  terminalTitle: string;
  model: string | null;
  effort: string | null;
  topic: string | null;
  focused: boolean;
};

export type LiveAgentsPayload = {
  available: boolean;
  error: string | null;
  agents: LiveAgent[];
};

export type ApiEnvelope<T> = { data: T; error: string | null };
