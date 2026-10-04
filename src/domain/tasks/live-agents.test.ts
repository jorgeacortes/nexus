import { describe, expect, it } from "vitest";

import { agentIdentityForPane, type LiveAgentInfo } from "@/domain/tasks/live-agents";

function agent(paneId: string, agentKind: string): LiveAgentInfo {
  return { paneId, agentKind, status: "working", cwd: "/ws/nexus" };
}

describe("agentIdentityForPane", () => {
  it("resolves the pane's live kind and mapped harness", () => {
    const agents = [agent("wR:p1", "claude"), agent("wP:p4", "codex"), agent("wA:p1", "agy")];
    expect(agentIdentityForPane(agents, "wR:p1")).toEqual({ agentName: "claude", harness: "claude_code" });
    expect(agentIdentityForPane(agents, "wP:p4")).toEqual({ agentName: "codex", harness: null });
    expect(agentIdentityForPane(agents, "wA:p1")).toEqual({ agentName: "agy", harness: "agy" });
  });

  it("yields no identity for an unknown, empty, or missing pane", () => {
    expect(agentIdentityForPane([agent("wR:p1", "pi")], "wR:p9")).toEqual({ agentName: null, harness: null });
    expect(agentIdentityForPane([agent("wR:p1", "pi")], null)).toEqual({ agentName: null, harness: null });
    expect(agentIdentityForPane([agent("wR:p1", "  ")], "wR:p1")).toEqual({ agentName: null, harness: null });
  });
});
