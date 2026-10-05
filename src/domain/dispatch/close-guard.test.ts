import { describe, expect, it } from "vitest";

import {
  assessTabClose,
  type CloseGuardTask,
  type ClosePaneFacts,
  hasLiveAgent,
  TabCloseRefusedError,
} from "@/domain/dispatch/close-guard";
import type { HarnessPane, HarnessProcess } from "@/domain/dispatch/harness";

function pane(overrides: Partial<HarnessPane> = {}): HarnessPane {
  return {
    paneId: "wR:p1",
    tabId: "wR:t1",
    workspaceId: "wR",
    agent: null,
    agentStatus: "unknown",
    cwd: "/tmp/dsp-smoke",
    focused: false,
    terminalTitle: "",
    ...overrides,
  };
}

function agentPane(status: string, agent = "pi"): HarnessPane {
  return pane({ agent, agentStatus: status });
}

function task(status: string): CloseGuardTask {
  return { id: "5f7325b7-9bfb-4440-9875-94ad71e82dcc", title: "Guard tab closes", status };
}

function foreground(): HarnessProcess {
  return { pid: 351115, name: "npm", cmdline: "npm test", cwd: "/tmp/dsp-smoke" };
}

function facts(overrides: Partial<ClosePaneFacts> = {}): ClosePaneFacts {
  return { pane: pane(), task: null, processes: [], ...overrides };
}

describe("assessTabClose — agents", () => {
  it("refuses while an agent is working, blocked or unknown", () => {
    for (const status of ["working", "blocked", "unknown"]) {
      const assessment = assessTabClose([facts({ pane: agentPane(status), task: task("done") })]);
      expect(assessment.closeable).toBe(false);
      expect(assessment.blocks).toHaveLength(1);
      expect(assessment.blocks[0]).toMatchObject({ paneId: "wR:p1", agent: "pi", status });
    }
  });

  it("refuses an idle agent whose task is not done", () => {
    const assessment = assessTabClose([facts({ pane: agentPane("idle"), task: task("in_progress") })]);
    expect(assessment.closeable).toBe(false);
    expect(assessment.blocks[0].reason).toContain("in_progress");
    expect(assessment.blocks[0].reason).toContain("5f7325b7");
  });

  it("allows an idle agent with no task", () => {
    expect(assessTabClose([facts({ pane: agentPane("idle"), task: null })]).closeable).toBe(true);
  });

  it("allows an idle agent whose task is done", () => {
    expect(assessTabClose([facts({ pane: agentPane("idle"), task: task("done") })]).closeable).toBe(true);
  });

  it("allows a done agent even while its task is not done", () => {
    expect(assessTabClose([facts({ pane: agentPane("done"), task: task("in_progress") })]).closeable).toBe(true);
  });

  it("treats a status outside Herdr's enum as unknown and refuses", () => {
    const assessment = assessTabClose([facts({ pane: agentPane("starting") })]);
    expect(assessment.closeable).toBe(false);
    expect(assessment.blocks[0].status).toBe("unknown");
  });
});

describe("assessTabClose — panes without an agent", () => {
  it("refuses a bare pane that is running a foreground process", () => {
    const assessment = assessTabClose([facts({ pane: pane(), processes: [foreground()] })]);
    expect(assessment.closeable).toBe(false);
    expect(assessment.blocks[0].agent).toBeNull();
    expect(assessment.blocks[0].reason).toContain("npm test");
    expect(assessment.blocks[0].reason).toContain("351115");
  });

  it("allows a bare prompt with no foreground process", () => {
    expect(assessTabClose([facts({ pane: pane(), processes: [] })]).closeable).toBe(true);
  });

  it("refuses a pane with no agent even if it owns a done task and runs work", () => {
    const assessment = assessTabClose([facts({ pane: pane(), task: task("done"), processes: [foreground()] })]);
    expect(assessment.closeable).toBe(false);
  });
});

describe("assessTabClose — one protected pane protects the tab", () => {
  it("refuses when any pane blocks, naming every blocker", () => {
    const assessment = assessTabClose([
      facts({ pane: pane({ paneId: "wR:p1" }) }),
      facts({ pane: pane({ paneId: "wR:p2", agent: "claude", agentStatus: "working" }), task: null }),
      facts({ pane: pane({ paneId: "wR:p3", agent: "pi", agentStatus: "idle" }), task: task("blocked") }),
    ]);
    expect(assessment.closeable).toBe(false);
    expect(assessment.blocks.map((block) => block.paneId)).toEqual(["wR:p2", "wR:p3"]);
  });

  it("allows when every pane is clear", () => {
    const assessment = assessTabClose([
      facts({ pane: pane({ paneId: "wR:p1" }) }),
      facts({ pane: agentPane("done"), task: task("in_progress") }),
      facts({ pane: agentPane("idle"), task: task("done") }),
    ]);
    expect(assessment.closeable).toBe(true);
    expect(assessment.blocks).toEqual([]);
  });
});

describe("hasLiveAgent", () => {
  it("counts only a non-empty agent kind", () => {
    expect(hasLiveAgent({ agent: "pi" })).toBe(true);
    expect(hasLiveAgent({ agent: null })).toBe(false);
    expect(hasLiveAgent({ agent: "  " })).toBe(false);
  });
});

describe("TabCloseRefusedError", () => {
  it("names the tab and each pane's agent and status", () => {
    const error = new TabCloseRefusedError({ tabId: "wR:tA", label: "dsp-5-close-guard" }, [
      { paneId: "wR:pE", agent: "pi", status: "working", reason: 'agent "pi" is working' },
    ]);
    expect(error.name).toBe("TabCloseRefusedError");
    expect(error.message).toContain("wR:tA");
    expect(error.message).toContain("dsp-5-close-guard");
    expect(error.message).toContain("wR:pE");
    expect(error.message).toContain('agent "pi"');
    expect(error.message).toContain("working");
    expect(error.message).toContain("No action was taken");
  });
});
