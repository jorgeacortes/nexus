import { describe, expect, it } from "vitest";

import {
  claimTask,
  completeTask,
  createTask,
  effortsForModel,
  HARNESSES,
  isValidEffort,
  KNOWN_MODELS,
  normalizeAssignment,
  TaskAlreadyClaimedError,
  TaskTransitionError,
  TaskValidationError,
  updateTask,
} from "@/domain/tasks/task";

describe("effort validation", () => {
  it("accepts an effort the model supports", () => {
    expect(isValidEffort("gpt-5.6-luna", "xhigh")).toBe(true);
    expect(isValidEffort("claude-sonnet-5.5", "max")).toBe(true);
  });

  it("rejects an effort the model does not support", () => {
    expect(isValidEffort("gpt-5.6-luna", "max")).toBe(false);
    expect(isValidEffort("gemini-3.8-flash", "xhigh")).toBe(false);
  });

  it("keeps a model's effort vocabulary identical across harnesses", () => {
    for (const model of Object.keys(KNOWN_MODELS.pi)) {
      const efforts = effortsForModel(model);
      for (const harness of HARNESSES) {
        const harnessEfforts = (KNOWN_MODELS[harness] as Record<string, readonly string[]>)[model];
        if (harnessEfforts) {
          expect(harnessEfforts).toEqual(efforts);
        }
      }
    }
  });
});

describe("normalizeAssignment", () => {
  it("clears agent fields when the assignee is not an agent", () => {
    expect(normalizeAssignment({ assignee: "me", harness: "pi", model: "gpt-5.6-luna", effort: "high" })).toEqual({
      assignee: "me",
      agentName: null,
      harness: null,
      model: null,
      effort: null,
      herdrPaneId: null,
    });
  });

  it("rejects an effort that does not belong to the model", () => {
    expect(() => normalizeAssignment({ assignee: "agent", model: "gpt-5.6-luna", effort: "max" })).toThrow(
      TaskValidationError,
    );
  });

  it("rejects a model the harness does not offer", () => {
    expect(() => normalizeAssignment({ assignee: "agent", harness: "cursor", model: "claude-opus-5.5" })).toThrow(
      /not offered/,
    );
  });

  it("requires a model when an effort is given", () => {
    expect(() => normalizeAssignment({ assignee: "agent", effort: "high" })).toThrow(/requires a model/);
  });
});

describe("createTask / updateTask", () => {
  it("trims the title and defaults to backlog", () => {
    const task = createTask({ title: "  ship it  " });
    expect(task.title).toBe("ship it");
    expect(task.status).toBe("backlog");
    expect(task.needsHuman).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(() => createTask({ title: "   " })).toThrow(TaskValidationError);
  });

  it("drops the reason when the flag is cleared", () => {
    const task = createTask({ title: "t", needsHuman: true, needsHumanReason: "waiting on key" });
    const cleared = updateTask(task, { needsHuman: false });
    expect(cleared.needsHuman).toBe(false);
    expect(cleared.needsHumanReason).toBeNull();
  });

  it("re-validates the pair when only the effort changes", () => {
    const task = createTask({
      title: "t",
      assignee: "agent",
      harness: "pi",
      model: "gpt-5.6-luna",
      effort: "high",
    });
    expect(() => updateTask(task, { effort: "max" })).toThrow(TaskValidationError);
    expect(updateTask(task, { effort: "xhigh" }).effort).toBe("xhigh");
  });

  it("starts with empty claim/completion fields", () => {
    const task = createTask({ title: "t" });
    expect(task.claimedAt).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.completionNotes).toBeNull();
  });
});

describe("claimTask", () => {
  it("claims a ready task for a pane and stamps the claim", () => {
    const task = createTask({ title: "t", status: "ready" });
    const claimed = claimTask(task, { paneId: "wR:p1", agentName: "pi", harness: "pi" });
    expect(claimed.status).toBe("in_progress");
    expect(claimed.assignee).toBe("agent");
    expect(claimed.harness).toBe("pi");
    expect(claimed.herdrPaneId).toBe("wR:p1");
    expect(claimed.claimedAt).toBeInstanceOf(Date);
  });

  it("keeps a pre-recorded model/effort pair when claiming", () => {
    const task = createTask({ title: "t", assignee: "agent", model: "gpt-5.6-luna", effort: "xhigh" });
    const claimed = claimTask(task, { paneId: "wR:p1" });
    expect(claimed.model).toBe("gpt-5.6-luna");
    expect(claimed.effort).toBe("xhigh");
  });

  it("is idempotent for the same pane", () => {
    const task = claimTask(createTask({ title: "t" }), { paneId: "wR:p1" });
    expect(claimTask(task, { paneId: "wR:p1" })).toBe(task);
  });

  it("rejects a second pane", () => {
    const task = claimTask(createTask({ title: "t" }), { paneId: "wR:p1" });
    expect(() => claimTask(task, { paneId: "wP:p4" })).toThrow(TaskAlreadyClaimedError);
  });

  it("rejects claiming a done task", () => {
    const task = completeTask(claimTask(createTask({ title: "t" }), { paneId: "wR:p1" }));
    expect(() => claimTask(task, { paneId: "wR:p1" })).toThrow(TaskTransitionError);
  });
});

describe("completeTask", () => {
  it("completes an in-progress task and records notes", () => {
    const claimed = claimTask(createTask({ title: "t", needsHuman: true, needsHumanReason: "x" }), {
      paneId: "wR:p1",
    });
    const done = completeTask(claimed, { notes: "commit abc123" });
    expect(done.status).toBe("done");
    expect(done.needsHuman).toBe(false);
    expect(done.needsHumanReason).toBeNull();
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.completionNotes).toBe("commit abc123");
  });

  it("force-closes a blocked task", () => {
    const blocked = updateTask(createTask({ title: "t" }), { status: "blocked" });
    expect(completeTask(blocked).status).toBe("done");
  });

  it("rejects completing a ready task", () => {
    expect(() => completeTask(createTask({ title: "t", status: "ready" }))).toThrow(TaskTransitionError);
  });
});
