import { describe, expect, it } from "vitest";

import { parseSnapshot, resolveHerdrSocketPath } from "@/infrastructure/herdr/herdr-client";

describe("parseSnapshot", () => {
  it("maps herdr snapshot agents into Nexus state with workspace/tab labels and model", () => {
    const snapshot = parseSnapshot({
      workspaces: [{ workspace_id: "wK", label: "valua proposal", agent_status: "idle", tab_count: 1, pane_count: 3 }],
      tabs: [{ tab_id: "wK:t1", workspace_id: "wK", label: "1", agent_status: "idle" }],
      agents: [
        {
          agent: "pi",
          agent_status: "working",
          pane_id: "wK:p1",
          tab_id: "wK:t1",
          workspace_id: "wK",
          cwd: "/home/sandbox/ws/nexus",
          terminal_title_stripped: "task review",
          focused: true,
          tokens: { quota_provider_model: "Claude/Sonnet 5.5" },
        },
        { agent: "claude", agent_status: "bogus" },
      ],
      focused_pane_id: "wK:p1",
    });

    expect(snapshot.agents).toHaveLength(2);
    expect(snapshot.agents[0]).toEqual({
      agent: "pi",
      agentStatus: "working",
      paneId: "wK:p1",
      tabId: "wK:t1",
      workspaceId: "wK",
      workspaceLabel: "valua proposal",
      tabLabel: "1",
      cwd: "/home/sandbox/ws/nexus",
      terminalTitle: "task review",
      model: "Claude/Sonnet 5.5",
      focused: true,
    });
    expect(snapshot.agents[1].agentStatus).toBe("unknown");
    expect(snapshot.workspaces[0]?.label).toBe("valua proposal");
    expect(snapshot.focusedPaneId).toBe("wK:p1");
  });

  it("returns empty sections for a missing snapshot", () => {
    expect(parseSnapshot({})).toEqual({
      agents: [],
      workspaces: [],
      tabs: [],
      focusedWorkspaceId: null,
      focusedTabId: null,
      focusedPaneId: null,
    });
  });
});

describe("resolveHerdrSocketPath", () => {
  it("prefers an explicit HERDR_SOCKET", () => {
    expect(resolveHerdrSocketPath({ HERDR_SOCKET: "/tmp/custom.sock" })).toBe("/tmp/custom.sock");
  });

  it("falls back to Herdr's own socket path variable", () => {
    expect(resolveHerdrSocketPath({ HERDR_SOCKET_PATH: "/tmp/herdr.sock" })).toBe("/tmp/herdr.sock");
  });

  it("falls back to a default path when nothing is configured", () => {
    expect(resolveHerdrSocketPath({})).toMatch(/herdr\.sock$/);
  });
});
