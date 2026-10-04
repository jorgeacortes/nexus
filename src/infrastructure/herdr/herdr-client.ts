import { spawn } from "node:child_process";

/** Live agent/pane state as reported by `herdr api snapshot`. */
export interface HerdrAgentState {
  agent: string;
  agentStatus: "idle" | "working" | "blocked" | "done" | "unknown";
  paneId: string;
  tabId: string;
  workspaceId: string;
  cwd: string;
  terminalTitle: string;
}

export interface HerdrSnapshot {
  agents: HerdrAgentState[];
  workspaces: Array<{ workspaceId: string }>;
  tabs: Array<{ tabId: string; workspaceId: string; label: string; agentStatus: string }>;
}

/** Port: how Nexus talks to Herdr. Adapters implement this; domain code never touches sockets. */
export interface HerdrPort {
  /** Returns the live session snapshot (agents, panes, tabs, workspaces). */
  snapshot(): Promise<HerdrSnapshot>;
  /** Sends a prompt to an agent. `target` is a pane id or other agent target. */
  prompt(target: string, text: string, options?: { timeoutMs?: number; until?: string[] }): Promise<void>;
}

type HerdrResponse = { result?: unknown; error?: { message?: string } };

/** Runs a request against the Herdr API socket and returns the parsed response. */
export async function herdrRequest(method: string, params?: Record<string, unknown>): Promise<HerdrResponse> {
  const { default: net } = await import("node:net");
  const socketPath = process.env.HERDR_SOCKET ?? `${process.env.HOME}/.herdr/herdr.sock`;
  const payload = JSON.stringify({ id: `nexus:${method}:${Date.now()}`, method, params: params ?? {} });

  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`herdr socket timeout: ${method}`));
    }, 10_000);

    socket.on("connect", () => socket.end(`${payload}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
    });
    socket.on("end", () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(buffer) as HerdrResponse);
      } catch (error) {
        reject(new Error(`herdr: invalid response: ${error instanceof Error ? error.message : "unknown"}`));
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/** Maps the raw snapshot JSON into the shapes Nexus needs. */
export function parseSnapshot(raw: {
  agents?: Array<Record<string, unknown>>;
  workspaces?: Array<Record<string, unknown>>;
  tabs?: Array<Record<string, unknown>>;
}): HerdrSnapshot {
  return {
    agents: (raw.agents ?? []).map((agent) => ({
      agent: String(agent.agent ?? "unknown"),
      agentStatus: normalizeStatus(agent.agent_status),
      paneId: String(agent.pane_id ?? ""),
      tabId: String(agent.tab_id ?? ""),
      workspaceId: String(agent.workspace_id ?? ""),
      cwd: String(agent.cwd ?? ""),
      terminalTitle: String(agent.terminal_title_stripped ?? agent.terminal_title ?? ""),
    })),
    workspaces: (raw.workspaces ?? []).map((workspace) => ({ workspaceId: String(workspace.workspace_id ?? "") })),
    tabs: (raw.tabs ?? []).map((tab) => ({
      tabId: String(tab.tab_id ?? ""),
      workspaceId: String(tab.workspace_id ?? ""),
      label: String(tab.label ?? ""),
      agentStatus: String(tab.agent_status ?? "unknown"),
    })),
  };
}

function normalizeStatus(value: unknown): HerdrAgentState["agentStatus"] {
  const status = String(value ?? "unknown");
  return status === "idle" || status === "working" || status === "blocked" || status === "done" ? status : "unknown";
}

/**
 * Adapter: Herdr CLI/socket. `herdr api snapshot` is the stable read path;
 * the socket is used for prompting agents.
 */
export class HerdrClient implements HerdrPort {
  async snapshot(): Promise<HerdrSnapshot> {
    const raw = await this.runCli(["api", "snapshot"]);
    const payload = (raw as { result?: { snapshot?: unknown } }).result?.snapshot ?? {};
    return parseSnapshot(payload as Parameters<typeof parseSnapshot>[0]);
  }

  async prompt(target: string, text: string, options?: { timeoutMs?: number; until?: string[] }): Promise<void> {
    const response = await herdrRequest("agent.prompt", {
      target,
      text,
      wait: options?.until ? { until: options.until, timeout_ms: options.timeoutMs ?? null } : null,
    });
    if (response.error) {
      throw new Error(response.error.message ?? "herdr agent.prompt failed");
    }
  }

  private runCli(args: string[]): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const child = spawn("herdr", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`herdr ${args.join(" ")} exited with ${code}: ${stderr.trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as Record<string, unknown>);
        } catch {
          reject(new Error(`herdr ${args.join(" ")} returned invalid JSON`));
        }
      });
      child.on("error", reject);
    });
  }
}
