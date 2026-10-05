import { describe, expect, it } from "vitest";

import type { HarnessPane } from "@/domain/dispatch/harness";
import { agentKindForHarness, agentNameForTask, choosePlacement, taskSlug } from "@/domain/dispatch/placement";

const FOLDER = "/tmp/dsp-smoke";

function pane(overrides: Partial<HarnessPane> = {}): HarnessPane {
  return {
    paneId: "wR:p1",
    tabId: "wR:t1",
    workspaceId: "wR",
    agent: null,
    agentStatus: "unknown",
    cwd: FOLDER,
    focused: false,
    terminalTitle: "",
    ...overrides,
  };
}

describe("taskSlug", () => {
  it("lowercases and dashes a title", () => {
    expect(taskSlug("Smoke: reply OK")).toBe("smoke-reply-ok");
    expect(taskSlug("  Fix   the /tmp dispatcher!  ")).toBe("fix-the-tmp-dispatcher");
  });

  it("never returns an empty slug", () => {
    expect(taskSlug("!!!")).toBe("task");
  });
});

describe("agentNameForTask", () => {
  const task = { id: "46e044bf-1fdf-4841-b00f-11d0bcf469e3", title: "Smoke: reply OK" };

  it("is <task-slug>-<short-id>", () => {
    expect(agentNameForTask(task)).toBe("smoke-reply-ok-46e044bf");
  });

  it("satisfies Herdr's [a-z][a-z0-9_-]{0,31} even for a numeric title and a long one", () => {
    const numeric = agentNameForTask({ id: task.id, title: "42 things" });
    expect(numeric).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);

    const long = agentNameForTask({ id: task.id, title: "a".repeat(200) });
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long.endsWith("-46e044bf")).toBe(true);
    expect(long).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
  });
});

describe("agentKindForHarness", () => {
  it("maps each harness to the Herdr kind, defaulting to pi", () => {
    expect(agentKindForHarness("pi")).toBe("pi");
    expect(agentKindForHarness("claude_code")).toBe("claude");
    expect(agentKindForHarness("cursor")).toBe("cursor");
    expect(agentKindForHarness("agy")).toBe("agy");
    expect(agentKindForHarness(null)).toBe("pi");
  });
});

describe("choosePlacement", () => {
  it("reuses a bare shell pane in the task's folder", () => {
    const target = pane({ paneId: "wR:p7" });
    expect(choosePlacement([pane({ paneId: "wR:p2", cwd: "/tmp/elsewhere" }), target], FOLDER)).toEqual({
      kind: "reuse",
      pane: target,
    });
  });

  it("never reuses a pane that is already running an agent", () => {
    const running = pane({ agent: "pi", agentStatus: "idle" });
    expect(choosePlacement([running], FOLDER)).toEqual({ kind: "new_tab" });
  });

  it("breaks ties on pane id so the choice is reproducible", () => {
    const result = choosePlacement([pane({ paneId: "wR:p9" }), pane({ paneId: "wR:p3" })], FOLDER);
    expect(result.kind).toBe("reuse");
    if (result.kind === "reuse") expect(result.pane.paneId).toBe("wR:p3");
  });

  it("creates a tab when nothing in the workspace matches", () => {
    expect(choosePlacement([], FOLDER)).toEqual({ kind: "new_tab" });
    expect(choosePlacement([pane({ cwd: null })], FOLDER)).toEqual({ kind: "new_tab" });
  });

  it("accepts any bare pane when the project has no folder to match", () => {
    expect(choosePlacement([pane({ cwd: null })], null).kind).toBe("reuse");
  });
});
