import { type Harness, harnessFromAgentKind } from "@/domain/tasks/task";

/**
 * Port owned by the tasks context: the live Herdr agents a dispatch can target.
 * Read-only live state (never stored in SQLite); implemented by the Herdr client.
 */
export type LiveAgentInfo = {
  paneId: string;
  agentKind: string;
  status: string;
  cwd: string;
  /**
   * The model the agent's *session* is running, already normalised to a
   * canonical id by the adapter, or null when the harness's own state says
   * nothing. Not the Herdr quota/status-line label: that label is a fallback the
   * adapter applies only when the session cannot be read (Cursor reports Claude
   * usage for a grok session, for instance).
   */
  model: string | null;
  effort: string | null;
};

export interface LiveAgentPort {
  list(): Promise<LiveAgentInfo[]>;
}

/** The agent state a task inherits from the pane it was claimed in. */
export type PaneAgentState = {
  /** The live Herdr agent kind, or null when the pane is not a live agent. */
  agentName: string | null;
  /** The mapped Nexus harness, or null for a kind Nexus does not know. */
  harness: Harness | null;
  /** The observed session model of the pane, canonical id, or null. */
  model: string | null;
  /** The observed session effort, or null. */
  effort: string | null;
};

const NO_STATE: PaneAgentState = { agentName: null, harness: null, model: null, effort: null };

/**
 * The single writer of `agentName`/`harness`/`model`/`effort` on the claim and
 * dispatch paths: a task's agent is the live agent behind its pane, so the state
 * comes from the same Herdr snapshot the board reads (pane id → agent kind →
 * harness, plus the model the adapter observed in the harness's session state).
 * A pane Herdr does not report as a live agent — a bare shell, a closed pane, or
 * Herdr unreachable — yields no state rather than a pane/tab id.
 */
export function agentStateForPane(agents: readonly LiveAgentInfo[], paneId: string | null | undefined): PaneAgentState {
  const id = paneId?.trim();
  if (!id) return NO_STATE;
  const agent = agents.find((candidate) => candidate.paneId === id);
  const kind = agent?.agentKind.trim();
  if (!kind) return NO_STATE;
  return {
    agentName: kind,
    harness: harnessFromAgentKind(kind),
    model: agent?.model ?? null,
    effort: agent?.effort ?? null,
  };
}
