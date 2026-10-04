import { describe, expect, it } from "vitest";

import { agentStateForPane, type LiveAgentInfo } from "@/domain/tasks/live-agents";

function agent(paneId: string, agentKind: string, model: string | null = null): LiveAgentInfo {
  return { paneId, agentKind, status: "working", cwd: "/ws/nexus", model, effort: model ? "high" : null };
}

describe("agentStateForPane", () => {
  it("resolves the pane's live kind, mapped harness, and observed model", () => {
    const agents = [
      agent("wR:p1", "claude", "claude-sonnet-5-5"),
      agent("wP:p4", "codex"),
      agent("wA:p1", "agy", "gemini-3.8-flash"),
    ];
    expect(agentStateForPane(agents, "wR:p1")).toEqual({
      agentName: "claude",
      harness: "claude_code",
      model: "claude-sonnet-5-5",
      effort: "high",
    });
    expect(agentStateForPane(agents, "wP:p4")).toEqual({
      agentName: "codex",
      harness: null,
      model: null,
      effort: null,
    });
    expect(agentStateForPane(agents, "wA:p1")).toMatchObject({ harness: "agy", model: "gemini-3.8-flash" });
  });

  it("yields no state for an unknown, empty, or missing pane", () => {
    const none = { agentName: null, harness: null, model: null, effort: null };
    expect(agentStateForPane([agent("wR:p1", "pi")], "wR:p9")).toEqual(none);
    expect(agentStateForPane([agent("wR:p1", "pi")], null)).toEqual(none);
    expect(agentStateForPane([agent("wR:p1", "  ")], "wR:p1")).toEqual(none);
  });
});
