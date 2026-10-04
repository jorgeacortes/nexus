import { describe, expect, it } from "vitest";

import { parseSnapshot } from "@/infrastructure/herdr/herdr-client";

describe("parseSnapshot", () => {
  it("maps herdr snapshot agents into Nexus state", () => {
    const snapshot = parseSnapshot({
      agents: [
        {
          agent: "pi",
          agent_status: "working",
          pane_id: "wK:p1",
          tab_id: "wK:t1",
          workspace_id: "wK",
          cwd: "/home/sandbox/ws/nexus",
          terminal_title_stripped: "task review",
        },
        { agent: "claude", agent_status: "bogus" },
      ],
    });
    expect(snapshot.agents).toHaveLength(2);
    expect(snapshot.agents[0]).toEqual({
      agent: "pi",
      agentStatus: "working",
      paneId: "wK:p1",
      tabId: "wK:t1",
      workspaceId: "wK",
      cwd: "/home/sandbox/ws/nexus",
      terminalTitle: "task review",
    });
    expect(snapshot.agents[1].agentStatus).toBe("unknown");
  });

  it("returns empty arrays for missing sections", () => {
    expect(parseSnapshot({})).toEqual({ agents: [], workspaces: [], tabs: [] });
  });
});
