import { describe, expect, it } from "vitest";

import { HerdrClient, type HerdrRequestFn } from "@/infrastructure/herdr/herdr-client";

type Call = { method: string; params?: Record<string, unknown> };

/** A client whose one JSON-RPC round-trip is recorded instead of hitting the socket. */
function clientWith(handler: HerdrRequestFn): { client: HerdrClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = new HerdrClient((method, params) => {
    calls.push({ method, params });
    return handler(method, params);
  });
  return { client, calls };
}

/** A fake whose result depends on the method, so one client serves a whole flow. */
function clientAnswering(answers: Record<string, unknown>): { client: HerdrClient; calls: Call[] } {
  return clientWith(async (method) => ({ result: answers[method] }));
}

describe("HerdrClient HarnessPort reads", () => {
  it("sends workspace.list and maps the workspaces", async () => {
    const { client, calls } = clientAnswering({
      "workspace.list": {
        type: "workspace_list",
        workspaces: [
          {
            workspace_id: "wR",
            label: "nexus",
            focused: true,
            tab_count: 2,
            pane_count: 3,
            agent_status: "working",
            active_tab_id: "wR:t1",
          },
        ],
      },
    });

    expect(await client.listWorkspaces()).toEqual([
      {
        workspaceId: "wR",
        label: "nexus",
        focused: true,
        tabCount: 2,
        paneCount: 3,
        agentStatus: "working",
        activeTabId: "wR:t1",
      },
    ]);
    expect(calls).toEqual([{ method: "workspace.list", params: undefined }]);
  });

  it("sends tab.list scoped to the workspace", async () => {
    const { client, calls } = clientAnswering({
      "tab.list": {
        type: "tab_list",
        tabs: [
          { tab_id: "wR:t7", workspace_id: "wR", label: "dsp-2", focused: false, pane_count: 1, agent_status: "idle" },
        ],
      },
    });

    expect(await client.listTabs("wR")).toEqual([
      { tabId: "wR:t7", workspaceId: "wR", label: "dsp-2", focused: false, paneCount: 1, agentStatus: "idle" },
    ]);
    expect(calls).toEqual([{ method: "tab.list", params: { workspace_id: "wR" } }]);
  });

  it("sends pane.list scoped to the workspace", async () => {
    const { client, calls } = clientAnswering({
      "pane.list": {
        type: "pane_list",
        panes: [
          {
            pane_id: "wR:p1",
            tab_id: "wR:t7",
            workspace_id: "wR",
            agent: "pi",
            agent_status: "working",
            cwd: "/home/sandbox/ws/nexus",
            focused: true,
            terminal_title_stripped: "π - nexus",
          },
          { pane_id: "wR:p2", terminal_title: "bare" },
        ],
      },
    });

    expect(await client.listPanes("wR")).toEqual([
      {
        paneId: "wR:p1",
        tabId: "wR:t7",
        workspaceId: "wR",
        agent: "pi",
        agentStatus: "working",
        cwd: "/home/sandbox/ws/nexus",
        focused: true,
        terminalTitle: "π - nexus",
      },
      {
        paneId: "wR:p2",
        tabId: "",
        workspaceId: "",
        agent: null,
        agentStatus: "unknown",
        cwd: null,
        focused: false,
        terminalTitle: "bare",
      },
    ]);
    expect(calls).toEqual([{ method: "pane.list", params: { workspace_id: "wR" } }]);
  });

  it("sends pane.process_info and maps only the foreground processes", async () => {
    const { client, calls } = clientAnswering({
      "pane.process_info": {
        type: "pane_process_info",
        process_info: {
          pane_id: "wR:p1",
          shell_pid: 2974538,
          foreground_process_group_id: 351115,
          foreground_processes: [{ pid: 351115, name: "pi", cmdline: "pi", cwd: "/home/sandbox/ws/nexus" }],
        },
      },
    });

    expect(await client.processes("wR:p1")).toEqual([
      { pid: 351115, name: "pi", cmdline: "pi", cwd: "/home/sandbox/ws/nexus" },
    ]);
    expect(calls).toEqual([{ method: "pane.process_info", params: { pane_id: "wR:p1" } }]);
  });
});

describe("HerdrClient HarnessPort writes", () => {
  it("creates a workspace without stealing focus", async () => {
    const { client, calls } = clientAnswering({
      "workspace.create": {
        type: "workspace_created",
        workspace: {
          workspace_id: "wN",
          label: "nexus",
          focused: false,
          tab_count: 1,
          pane_count: 1,
          agent_status: "unknown",
        },
      },
    });

    expect(await client.createWorkspace("nexus", "/home/sandbox/ws/nexus")).toEqual({
      workspaceId: "wN",
      label: "nexus",
      focused: false,
      tabCount: 1,
      paneCount: 1,
      agentStatus: "unknown",
      activeTabId: null,
    });
    expect(calls).toEqual([
      { method: "workspace.create", params: { label: "nexus", cwd: "/home/sandbox/ws/nexus", focus: false } },
    ]);
  });

  it("creates a tab and returns its root pane for the agent to start in", async () => {
    const { client, calls } = clientAnswering({
      "tab.create": {
        type: "tab_created",
        tab: {
          tab_id: "wN:t1",
          workspace_id: "wN",
          label: "dsp-2",
          focused: false,
          pane_count: 1,
          agent_status: "unknown",
        },
        root_pane: { pane_id: "wN:p1", tab_id: "wN:t1", workspace_id: "wN", focused: false, agent_status: "unknown" },
      },
    });

    expect(await client.createTab("wN", "dsp-2", null)).toEqual({
      tab: { tabId: "wN:t1", workspaceId: "wN", label: "dsp-2", focused: false, paneCount: 1, agentStatus: "unknown" },
      rootPane: {
        paneId: "wN:p1",
        tabId: "wN:t1",
        workspaceId: "wN",
        agent: null,
        agentStatus: "unknown",
        cwd: null,
        focused: false,
        terminalTitle: "",
      },
    });
    expect(calls).toEqual([
      { method: "tab.create", params: { workspace_id: "wN", label: "dsp-2", cwd: null, focus: false } },
    ]);
  });

  it("starts an agent in an existing pane", async () => {
    const { client, calls } = clientAnswering({ "agent.start": { type: "agent_started" } });

    await expect(client.startAgent("dsp-2-ab12cd", "pi", "wN:p1")).resolves.toBeUndefined();
    expect(calls).toEqual([{ method: "agent.start", params: { name: "dsp-2-ab12cd", kind: "pi", pane_id: "wN:p1" } }]);
  });

  it("closes a tab and surfaces a Herdr refusal as an error", async () => {
    const ok = clientAnswering({ "tab.close": { type: "ok" } });
    await expect(ok.client.closeTab("wN:t1")).resolves.toBeUndefined();
    expect(ok.calls).toEqual([{ method: "tab.close", params: { tab_id: "wN:t1" } }]);

    const { client } = clientWith(async () => ({ error: { message: "tab not found" } }));
    await expect(client.closeTab("wN:t9")).rejects.toThrow("tab not found");
  });
});
