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
