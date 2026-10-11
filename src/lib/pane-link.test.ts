import { describe, expect, it } from "vitest";

import { currentTaskByPane, type PaneOwnedTask } from "./pane-link";

function task(overrides: Partial<PaneOwnedTask> & Pick<PaneOwnedTask, "id" | "status">): PaneOwnedTask {
  return { herdrPaneId: "wP:p9", ...overrides };
}

describe("currentTaskByPane", () => {
  it("pairs a pane with its in-progress task and ignores every other status", () => {
    const working = task({ id: "working", status: "in_progress" });
    const done = task({ id: "done", status: "done" });
    const ready = task({ id: "ready", status: "ready", herdrPaneId: "wP:p8" });
    const blocked = task({ id: "blocked", status: "blocked", herdrPaneId: "wP:p8" });

    const current = currentTaskByPane([done, ready, blocked, working]);

    expect(current.get("wP:p9")).toBe(working);
    expect(current.has("wP:p8")).toBe(false);
    expect([...current.keys()]).toEqual(["wP:p9"]);
  });

  it("keeps the in-progress task when a later done task reused the same pane id", () => {
    const working = task({ id: "381c548c", status: "in_progress" });
    const finished = task({ id: "855c4986", status: "done" });

    expect(currentTaskByPane([working, finished]).get("wP:p9")?.id).toBe("381c548c");
  });

  it("lets a later in-progress task replace an earlier one on the same pane", () => {
    const older = task({ id: "older", status: "in_progress" });
    const newer = task({ id: "newer", status: "in_progress" });

    expect(currentTaskByPane([older, newer]).get("wP:p9")?.id).toBe("newer");
  });

  it("skips tasks with no pane", () => {
    const working = task({ id: "working", status: "in_progress", herdrPaneId: null });
    expect(currentTaskByPane([working]).size).toBe(0);
  });
});
