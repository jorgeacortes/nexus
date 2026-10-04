import { type Harness, harnessFromAgentKind } from "@/domain/tasks/task";
import type { HerdrAgentStatus, HerdrSnapshot } from "@/infrastructure/herdr/herdr-client";

export type LiveAgentStatus = HerdrAgentStatus;

/** Normalized live agent row the UI consumes (Herdr state, never stored in SQLite). */
export type LiveAgent = {
  paneId: string;
  tabId: string;
  workspaceId: string;
  workspaceLabel: string;
  tabLabel: string;
  agentKind: string;
  harness: Harness | null;
  status: LiveAgentStatus;
  cwd: string;
  terminalTitle: string;
  model: string | null;
  /** Herdr's current topic for the agent — good enough for the board's TOPIC column. */
  topic: string | null;
  focused: boolean;
};

export type LiveWorkspace = {
  id: string;
  label: string;
  agentStatus: string;
  tabCount: number;
  paneCount: number;
};

export type LiveAgentsPayload = {
  available: boolean;
  error: string | null;
  agents: LiveAgent[];
  workspaces: LiveWorkspace[];
};

export const EMPTY_LIVE_AGENTS: LiveAgentsPayload = { available: false, error: null, agents: [], workspaces: [] };

export function toLiveAgents(snapshot: HerdrSnapshot): LiveAgentsPayload {
  return {
    available: true,
    error: null,
    agents: snapshot.agents.map((agent) => ({
      paneId: agent.paneId,
      tabId: agent.tabId,
      workspaceId: agent.workspaceId,
      workspaceLabel: agent.workspaceLabel,
      tabLabel: agent.tabLabel,
      agentKind: agent.agent,
      harness: harnessFromAgentKind(agent.agent),
      status: agent.agentStatus,
      cwd: agent.cwd,
      terminalTitle: agent.terminalTitle,
      model: agent.model,
      topic: agent.topic,
      focused: agent.focused,
    })),
    workspaces: snapshot.workspaces.map((workspace) => ({
      id: workspace.workspaceId,
      label: workspace.label,
      agentStatus: workspace.agentStatus,
      tabCount: workspace.tabCount,
      paneCount: workspace.paneCount,
    })),
  };
}

export const AGENT_STATUS_LABELS: Record<LiveAgentStatus, string> = {
  idle: "Idle",
  working: "Working",
  blocked: "Blocked",
  done: "Done",
  unknown: "Unknown",
};

export const AGENT_STATUS_DOT: Record<LiveAgentStatus, string> = {
  working: "bg-emerald-500",
  idle: "bg-muted-foreground/50",
  blocked: "bg-destructive",
  done: "bg-chart-1",
  unknown: "bg-muted-foreground/30",
};
