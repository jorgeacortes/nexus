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
  archivedAt: string | null;
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
  lastSeenStatus: string | null;
  lastSeenAt: string | null;
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

/** `POST /api/dispatch/close` payload: the tab that passed the guard. */
export type CloseHarnessResult = {
  tab: {
    tabId: string;
    workspaceId: string;
    label: string;
    focused: boolean;
    paneCount: number;
    agentStatus: string;
  };
  paneCount: number;
};

/** One agent `POST /api/dispatch/detect` ended as lost and flagged for the operator. */
export type LostAgentFinding = {
  dispatchId: string;
  taskId: string;
  taskTitle: string | null;
  tabId: string | null;
  paneId: string;
  agentName: string | null;
  harness: string | null;
  lastSeenStatus: string | null;
  lastSeenAt: string | null;
  reason: string;
};

/** `POST /api/dispatch/detect` payload: the one-shot lost-agent sweep's outcome. */
export type DetectLostAgentsResult = {
  available: boolean;
  reason: string | null;
  checked: number;
  live: number;
  completed: number;
  lost: LostAgentFinding[];
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

/** `/api/jobs` row. `needsHuman` is true when the job is dead. */
export type Job = {
  id: string;
  name: string;
  kind: string;
  predicate: string | null;
  dailyRunCap: number | null;
  schedule: string | null;
  intervalSeconds: number | null;
  timezone: string | null;
  prompt: string;
  projectId: string | null;
  targetPaneId: string | null;
  targetMode: string;
  enabled: boolean;
  state: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  retryCount: number;
  maxRetries: number;
  needsHuman: boolean;
};

/** `POST /api/jobs/[id]/run` — the attempt, plus the job after it. */
export type JobRunResult = {
  run: { jobId: string; runId: string; status: string; paneId: string | null; error: string | null; state: string };
  job: Job | null;
};

/** `POST /api/jobs/tick` — one pass of due jobs. */
export type JobTickResult = {
  dryRun: boolean;
  due: string[];
  reaped: string[];
  lost: string[];
  runs: Array<{ jobId: string; status: string; paneId: string | null; error: string | null; state: string }>;
  lastTickAt: string | null;
};

/** `POST /api/tasks/archive` — the one-shot sweep. */
export type ArchiveSweepResult = {
  archived: Task[];
};

export type ApiEnvelope<T> = { data: T; error: string | null };
