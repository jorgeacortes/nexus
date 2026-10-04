import { describe, expect, it } from "vitest";

import {
  claimTask,
  completeTask,
  createTask,
  effortsForModel,
  HARNESSES,
  harnessFromAgentKind,
  isKnownModelForHarness,
  isTaskPriority,
  isValidEffort,
  KNOWN_MODELS,
  normalizeAssignment,
  TASK_PRIORITIES,
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

  it("keeps a model's effort vocabulary consistent per harness", () => {
    expect(effortsForModel("gemini-3.8-flash", "agy")).toEqual(["low", "medium", "high"]);
    expect(effortsForModel("gemini-3.8-flash", "pi")).toContain("minimal");
    // A shared model name may expose different efforts under different harnesses.
    expect(isValidEffort("gemini-3.8-flash", "minimal", "agy")).toBe(false);
    expect(isValidEffort("gemini-3.8-flash", "minimal", "pi")).toBe(true);
    expect(effortsForModel("gemini-3.1-pro", "agy")).toEqual(["low", "high"]);
    expect(effortsForModel("gpt-oss-120b", "agy")).toEqual(["medium"]);
  });

  it("round-trips every registered harness/model/effort", () => {
    for (const harness of HARNESSES) {
      for (const [model, efforts] of Object.entries(KNOWN_MODELS[harness])) {
        expect(isKnownModelForHarness(harness, model)).toBe(true);
        for (const effort of efforts) {
          expect(isValidEffort(model, effort, harness)).toBe(true);
        }
      }
    }
  });
});

describe("harnessFromAgentKind", () => {
  it("maps the kinds Herdr reports", () => {
    expect(harnessFromAgentKind("pi")).toBe("pi");
    expect(harnessFromAgentKind("claude")).toBe("claude_code");
    expect(harnessFromAgentKind("claude-code")).toBe("claude_code");
    expect(harnessFromAgentKind(" Cursor ")).toBe("cursor");
    expect(harnessFromAgentKind("agy")).toBe("agy");
    expect(harnessFromAgentKind("Antigravity")).toBe("agy");
  });

  it("leaves a kind the registry does not know unlinked", () => {
    expect(harnessFromAgentKind("codex")).toBeNull();
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

  it("accepts a normalised agy model/effort pair and rejects an unsupported effort", () => {
    expect(
      normalizeAssignment({ assignee: "agent", harness: "agy", model: "gemini-3.8-flash", effort: "high" }),
    ).toMatchObject({ harness: "agy", model: "gemini-3.8-flash", effort: "high" });
    expect(() =>
      normalizeAssignment({ assignee: "agent", harness: "agy", model: "gemini-3.8-flash", effort: "minimal" }),
    ).toThrow(TaskValidationError);
    expect(() =>
      normalizeAssignment({ assignee: "agent", harness: "agy", model: "gpt-5.6-luna", effort: "high" }),
    ).toThrow(/not offered/);
  });

  it("keeps an unknown agent kind as the agent name", () => {
    expect(normalizeAssignment({ assignee: "agent", agentName: "codex" }).agentName).toBe("codex");
  });

  it("rejects a Herdr pane/tab id as the agent name", () => {
    expect(() => normalizeAssignment({ assignee: "agent", agentName: "wR:t2" })).toThrow(/pane\/tab id/);
    expect(() => normalizeAssignment({ assignee: "agent", agentName: "wR:p1" })).toThrow(TaskValidationError);
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

  it("records the agy harness when claimed from an agy pane", () => {
    const task = createTask({ title: "t", status: "ready" });
    const claimed = claimTask(task, { paneId: "wA:p1", agentName: "agy", harness: "agy" });
    expect(claimed.agentName).toBe("agy");
    expect(claimed.harness).toBe("agy");
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

describe("task priority", () => {
  it("defaults to normal on creation", () => {
    const task = createTask({ title: "Task with default priority" });
    expect(task.priority).toBe("normal");
  });

  it("accepts all valid priority levels", () => {
    for (const priority of TASK_PRIORITIES) {
      expect(isTaskPriority(priority)).toBe(true);
      const task = createTask({ title: "Task", priority });
      expect(task.priority).toBe(priority);
    }
  });

  it("rejects an invalid priority level on create", () => {
    // @ts-expect-error invalid priority
    expect(() => createTask({ title: "Bad", priority: "critical" })).toThrow(TaskValidationError);
  });

  it("updates priority with updateTask", () => {
    const task = createTask({ title: "Task", priority: "low" });
    const updated = updateTask(task, { priority: "blocker" });
    expect(updated.priority).toBe("blocker");
  });

  it("rejects an invalid priority level on update", () => {
    const task = createTask({ title: "Task" });
    // @ts-expect-error invalid priority
    expect(() => updateTask(task, { priority: "urgent" })).toThrow(TaskValidationError);
  });
});
