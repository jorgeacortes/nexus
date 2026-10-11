import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { herdrRequest, parseSnapshot, resolveHerdrSocketPath } from "@/infrastructure/herdr/herdr-client";

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
          tokens: { quota_provider_model: "Claude/Sonnet 5.5", quota_topic: "reviewing the board" },
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
      model: "claude-sonnet-5-5",
      effort: null,
      session: null,
      topic: "reviewing the board",
      focused: true,
    });
    expect(snapshot.agents[1].agentStatus).toBe("unknown");
    expect(snapshot.agents[1].effort).toBeNull();
    expect(snapshot.workspaces[0]?.label).toBe("valua proposal");
    expect(snapshot.focusedPaneId).toBe("wK:p1");
  });

  it("parses effort from quota_effort or effort token fields", () => {
    const snapshot = parseSnapshot({
      agents: [
        {
          agent: "agy",
          pane_id: "wR:p1",
          tokens: { quota_model: "gemini-3.8-flash", quota_effort: "high" },
        },
        {
          agent: "pi",
          pane_id: "wR:p2",
          tokens: { model: "gpt-5.6-luna", effort: "xhigh" },
        },
      ],
    });
    expect(snapshot.agents[0].effort).toBe("high");
    expect(snapshot.agents[1].effort).toBe("xhigh");
  });

  it("parses the harness agent_session descriptor", () => {
    const snapshot = parseSnapshot({
      agents: [
        {
          agent: "pi",
          pane_id: "wR:p1",
          agent_session: {
            agent: "pi",
            kind: "path",
            source: "herdr:pi",
            value: "/home/sandbox/.pi/agent/sessions/--ws--/session.jsonl",
          },
        },
        { agent: "cursor", pane_id: "wP:p4" },
      ],
    });
    expect(snapshot.agents[0].session).toEqual({
      agent: "pi",
      kind: "path",
      source: "herdr:pi",
      value: "/home/sandbox/.pi/agent/sessions/--ws--/session.jsonl",
    });
    expect(snapshot.agents[1].session).toBeNull();
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

describe("herdrRequest", () => {
  async function withSocket(onConnection: (socket: Socket) => void, run: (env: NodeJS.Dict<string>) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "nexus-herdr-"));
    const socketPath = join(dir, "herdr.sock");
    const server: Server = createServer((socket) => {
      socket.on("error", () => {});
      onConnection(socket);
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      await run({ HERDR_SOCKET: socketPath });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("reads a response that arrives only while the write side is still open", async () => {
    let writableWhenReplying = false;
    await withSocket(
      (socket) => {
        let request = "";
        socket.on("data", (chunk) => {
          request += chunk.toString("utf8");
          if (!request.includes("\n")) return;
          setTimeout(() => {
            writableWhenReplying = socket.writable && !socket.writableEnded;
            socket.write(`${JSON.stringify({ id: "1", result: { type: "agent_prompted" } })}\n`);
            socket.end();
          }, 40);
        });
        socket.on("end", () => {
          if (!writableWhenReplying) socket.destroy();
        });
      },
      async (env) => {
        await expect(herdrRequest("agent.prompt", { target: "w1R:p2", text: "hello" }, env, 1_000)).resolves.toEqual({
          id: "1",
          result: { type: "agent_prompted" },
        });
        expect(writableWhenReplying).toBe(true);
      },
    );
  });

  it("assembles a JSON body that arrives in pieces", async () => {
    await withSocket(
      (socket) => {
        socket.once("data", () => {
          const body = JSON.stringify({ id: "2", result: { ok: true } });
          socket.write(body.slice(0, 8));
          setTimeout(() => {
            socket.write(body.slice(8));
            socket.end();
          }, 20);
        });
      },
      async (env) => {
        await expect(herdrRequest("agent.get", { target: "w1R:p2" }, env, 1_000)).resolves.toEqual({
          id: "2",
          result: { ok: true },
        });
      },
    );
  });

  it("rejects a connection that closes with an empty body", async () => {
    await withSocket(
      (socket) => {
        socket.once("data", () => socket.end());
      },
      async (env) => {
        await expect(herdrRequest("agent.prompt", {}, env, 1_000)).rejects.toThrow(
          "herdr: invalid response: Unexpected end of JSON input",
        );
      },
    );
  });

  it("rejects when the socket stays silent past the budget", async () => {
    await withSocket(
      (socket) => {
        socket.on("data", () => {});
      },
      async (env) => {
        await expect(herdrRequest("agent.prompt", {}, env, 50)).rejects.toThrow("herdr socket timeout: agent.prompt");
      },
    );
  });
});
