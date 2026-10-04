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
};

export interface LiveAgentPort {
  list(): Promise<LiveAgentInfo[]>;
}

/** The agent identity a task inherits from the pane it was claimed in. */
export type PaneAgentIdentity = {
  /** The live Herdr agent kind, or null when the pane is not a live agent. */
  agentName: string | null;
  /** The mapped Nexus harness, or null for a kind Nexus does not know. */
  harness: Harness | null;
};

const NO_IDENTITY: PaneAgentIdentity = { agentName: null, harness: null };

/**
 * The single writer of `agentName`/`harness` on the claim and dispatch paths: a
 * task's agent is the live agent behind its pane, so the identity comes from the
 * same Herdr snapshot the board reads (pane id → agent kind → harness). A pane
 * Herdr does not report as a live agent — a bare shell, a closed pane, or Herdr
 * unreachable — yields no identity rather than a pane/tab id.
 */
export function agentIdentityForPane(
  agents: readonly LiveAgentInfo[],
  paneId: string | null | undefined,
): PaneAgentIdentity {
  const id = paneId?.trim();
  if (!id) return NO_IDENTITY;
  const kind = agents.find((agent) => agent.paneId === id)?.agentKind.trim();
  if (!kind) return NO_IDENTITY;
  return { agentName: kind, harness: harnessFromAgentKind(kind) };
}
