/** Wire shapes shared by the `nx` commands, so the CLI stays independent of the app. */

export type Task = {
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

export type Project = {
  id: string;
  name: string;
  folderPath: string | null;
  herdrWorkspaceId: string | null;
  createdAt: string;
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
  topic: string | null;
  focused: boolean;
};

export type LiveAgentsPayload = {
  available: boolean;
  error: string | null;
  agents: LiveAgent[];
};

export type ApiEnvelope<T> = { data: T; error: string | null };
