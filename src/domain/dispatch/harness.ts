/**
 * Port owned by the dispatch context: the Herdr terminal topology it places work
 * on (workspaces, tabs, panes, foreground processes) plus the four write
 * operations the dispatcher needs to create and tear that topology down.
 *
 * A narrow port/gateway, not a repository, following the
 * `src/domain/tasks/agent-prompt.ts` precedent: implemented by `HerdrClient`
 * over the JSON-RPC socket and wired in `src/infrastructure/container.ts`.
 * Domain and application code never touch the socket.
 *
 * `snapshot()` stays on `HerdrPort` and `prompt()` on the tasks context's
 * `AgentPromptPort`; the dispatch context declares only what it uses. The one
 * deliberate absence is a guard: `closeTab()` on the adapter stays dumb, and the
 * decision to refuse a close belongs in the application layer, where it can read
 * task state and be unit-tested.
 */

export interface HarnessWorkspace {
  workspaceId: string;
  label: string;
  focused: boolean;
  tabCount: number;
  paneCount: number;
  agentStatus: string;
  /** The workspace's focused tab, or null when Herdr reports none. */
  activeTabId: string | null;
}

export interface HarnessTab {
  tabId: string;
  workspaceId: string;
  label: string;
  focused: boolean;
  paneCount: number;
  agentStatus: string;
}

export interface HarnessPane {
  paneId: string;
  tabId: string;
  workspaceId: string;
  /** The live agent kind in the pane (e.g. "pi"), or null for a bare shell. */
  agent: string | null;
  agentStatus: string;
  cwd: string | null;
  focused: boolean;
  terminalTitle: string;
}

/** A foreground process `pane process-info` reports for a pane's shell. */
export interface HarnessProcess {
  pid: number;
  name: string;
  cmdline: string | null;
  cwd: string | null;
}

/** A freshly created tab and the shell pane an agent is started in. */
export interface HarnessTabCreated {
  tab: HarnessTab;
  rootPane: HarnessPane;
}

export interface HarnessPort {
  listWorkspaces(): Promise<HarnessWorkspace[]>;
  listTabs(workspaceId: string): Promise<HarnessTab[]>;
  listPanes(workspaceId: string): Promise<HarnessPane[]>;
  /** The tab with this id, or null when Herdr does not report it. */
  getTab(tabId: string): Promise<HarnessTab | null>;
  /**
   * The pane's foreground processes, **excluding the pane's own shell**: empty
   * for a bare prompt, non-empty while the shell runs a build, a test or any
   * other foreground command. The shell is always the foreground process when it
   * sits at its prompt (`shell_pid`), so it is filtered out here rather than by
   * every caller.
   */
  processes(paneId: string): Promise<HarnessProcess[]>;
  /** Creates a workspace; `focus: false` so the operator's view never moves. */
  createWorkspace(label: string, cwd: string | null): Promise<HarnessWorkspace>;
  /** Creates a tab in an existing workspace; `focus: false` for the same reason. */
  createTab(workspaceId: string, label: string, cwd: string | null): Promise<HarnessTabCreated>;
  /**
   * Starts an agent in an existing shell pane. `timeoutMs` is how long Herdr may
   * wait for the agent to become interactive and named before it fails. Throws
   * when Herdr refuses or the wait expires. Never closes anything.
   */
  startAgent(name: string, kind: string, paneId: string, options?: { timeoutMs?: number }): Promise<void>;
  /**
   * Closes a tab. Dumb on purpose: Herdr cannot be made to refuse a close, so the
   * guard that protects a working agent lives in the application layer.
   */
  closeTab(tabId: string): Promise<void>;
}
