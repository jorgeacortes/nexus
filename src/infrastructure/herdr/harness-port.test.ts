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

  it("treats the pane's own shell as a bare prompt, not a foreground process", async () => {
    const { client } = clientAnswering({
      "pane.process_info": {
        type: "pane_process_info",
        process_info: {
          pane_id: "wR:pF",
          shell_pid: 481221,
          foreground_process_group_id: 481221,
          foreground_processes: [{ pid: 481221, name: "bash", cmdline: "/bin/bash", cwd: "/tmp" }],
        },
      },
    });

    expect(await client.processes("wR:pF")).toEqual([]);
  });

  it("keeps every process when Herdr reports no shell_pid, so the guard fails safe", async () => {
    const { client } = clientAnswering({
      "pane.process_info": {
        type: "pane_process_info",
        process_info: {
          pane_id: "wR:pF",
          foreground_processes: [{ pid: 481221, name: "bash", cmdline: "/bin/bash", cwd: "/tmp" }],
        },
      },
    });

    expect(await client.processes("wR:pF")).toEqual([{ pid: 481221, name: "bash", cmdline: "/bin/bash", cwd: "/tmp" }]);
  });

  it("sends tab.get and maps the tab", async () => {
    const { client, calls } = clientAnswering({
      "tab.get": {
        type: "tab_info",
        tab: {
          tab_id: "wR:t7",
          workspace_id: "wR",
          label: "dsp-2-harness-port",
          focused: false,
          pane_count: 1,
          agent_status: "done",
        },
      },
    });

    expect(await client.getTab("wR:t7")).toEqual({
      tabId: "wR:t7",
      workspaceId: "wR",
      label: "dsp-2-harness-port",
      focused: false,
      paneCount: 1,
      agentStatus: "done",
    });
    expect(calls).toEqual([{ method: "tab.get", params: { tab_id: "wR:t7" } }]);
  });

  it("returns null for a tab Herdr does not report", async () => {
    const { client } = clientWith(async () => ({ error: { code: "tab_not_found", message: "tab wR:zz not found" } }));

    expect(await client.getTab("wR:zz")).toBeNull();
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

  it("renames a tab", async () => {
    const { client, calls } = clientAnswering({
      "tab.rename": { type: "tab_renamed", tab: { tab_id: "wN:t1", workspace_id: "wN", label: "dsp-2" } },
    });

    await expect(client.renameTab("wN:t1", "dsp-2")).resolves.toBeUndefined();
    expect(calls).toEqual([{ method: "tab.rename", params: { tab_id: "wN:t1", label: "dsp-2" } }]);
  });

  it("starts an agent in an existing pane, waiting until it is interactive", async () => {
    const { client, calls } = clientAnswering({
      "agent.start": { type: "agent_started" },
      "agent.get": { type: "agent_info", agent: { interactive_ready: true } },
    });

    await expect(client.startAgent("dsp-2-ab12cd", "pi", "wN:p1")).resolves.toBeUndefined();
    expect(calls).toEqual([
      { method: "agent.start", params: { name: "dsp-2-ab12cd", kind: "pi", pane_id: "wN:p1" } },
      { method: "agent.get", params: { target: "dsp-2-ab12cd" } },
    ]);
  });

  it("retries the start while the fresh pane is not yet an available shell", async () => {
    let attempts = 0;
    const { client, calls } = clientWith(async (method) => {
      if (method === "agent.start") {
        attempts += 1;
        return attempts === 1
          ? { error: { code: "agent_pane_busy", message: "agent target pane wN:p1 is not an available shell" } }
          : { result: { type: "agent_started" } };
      }
      return { result: { type: "agent_info", agent: { interactive_ready: true } } };
    });

    await expect(client.startAgent("dsp-2-ab12cd", "pi", "wN:p1")).resolves.toBeUndefined();
    expect(calls.filter((call) => call.method === "agent.start")).toHaveLength(2);
  });

  it("polls agent.get until Herdr reports the agent interactive", async () => {
    let polls = 0;
    const { client, calls } = clientWith(async (method) => {
      if (method === "agent.start") return { result: { type: "agent_started" } };
      polls += 1;
      return { result: { type: "agent_info", agent: { interactive_ready: polls >= 3 } } };
    });

    await expect(client.startAgent("dsp-2-ab12cd", "pi", "wN:p1", { timeoutMs: 5000 })).resolves.toBeUndefined();
    expect(calls.filter((call) => call.method === "agent.get")).toHaveLength(3);
  });

  it("propagates a start refusal that is not a pane-availability race", async () => {
    const { client } = clientWith(async () => ({
      error: { code: "invalid_agent_name", message: "invalid agent name" },
    }));

    await expect(client.startAgent("BAD NAME", "pi", "wN:p1")).rejects.toThrow("invalid agent name");
  });

  it("closes a tab and surfaces a Herdr refusal as an error", async () => {
    const ok = clientAnswering({ "tab.close": { type: "ok" } });
    await expect(ok.client.closeTab("wN:t1")).resolves.toBeUndefined();
    expect(ok.calls).toEqual([{ method: "tab.close", params: { tab_id: "wN:t1" } }]);

    const { client } = clientWith(async () => ({ error: { message: "tab not found" } }));
    await expect(client.closeTab("wN:t9")).rejects.toThrow("tab not found");
  });
});
