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
    expect(isValidEffort("claude-sonnet-5-5", "max")).toBe(true);
  });

  it("rejects an effort the model does not support", () => {
    expect(isValidEffort("gpt-5.6-luna", "minimal")).toBe(false);
    expect(isValidEffort("gemini-3.8-flash", "xhigh")).toBe(false);
  });

  it("keeps a model's effort vocabulary consistent per harness", () => {
    // The same model name may expose different efforts under different harnesses.
    expect(effortsForModel("claude-opus-5-5", "claude_code")).toContain("max");
    expect(effortsForModel("claude-opus-5-5", "agy")).toEqual(["low", "medium", "high"]);
    expect(isValidEffort("claude-opus-5-5", "max", "agy")).toBe(false);
    expect(isValidEffort("claude-opus-5-5", "max", "claude_code")).toBe(true);
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
    expect(() => normalizeAssignment({ assignee: "agent", model: "gpt-5.6-luna", effort: "minimal" })).toThrow(
      TaskValidationError,
    );
  });

  it("rejects a model the harness does not offer", () => {
    expect(() => normalizeAssignment({ assignee: "agent", harness: "cursor", model: "deepseek-v4.1-flash" })).toThrow(
      /not offered/,
    );
  });

  it("normalises a harness display label into a registry id", () => {
    expect(
      normalizeAssignment({ assignee: "agent", harness: "claude_code", model: "Claude/Sonnet 5.5", effort: "high" }),
    ).toMatchObject({ harness: "claude_code", model: "claude-sonnet-5-5", effort: "high" });
    expect(
      normalizeAssignment({ assignee: "agent", harness: "pi", model: "opencode-go/deepseek-v4.1-flash" }),
    ).toMatchObject({ harness: "pi", model: "deepseek-v4.1-flash" });
  });

  it("accepts an observed model the registry does not know, without an effort check", () => {
    // Ground truth: a harness release must never make a claim or a card fail.
    expect(
      normalizeAssignment({ assignee: "agent", harness: "pi", model: "qwen3.8-flash", effort: "medium" }, "observed"),
    ).toMatchObject({ model: "qwen3.8-flash", effort: "medium" });
    // An observed effort with no model has nothing to render against.
    expect(normalizeAssignment({ assignee: "agent", effort: "high" }, "observed")).toMatchObject({
      model: null,
      effort: null,
    });
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
      model: "grok-4.6",
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

  it("records the pane's observed model, normalised, over the stored one", () => {
    const task = createTask({ title: "t", status: "ready" });
    const claimed = claimTask(task, {
      paneId: "wR:p1",
      agentName: "pi",
      harness: "pi",
      model: "opencode-go/deepseek-v4.1-flash",
      effort: "high",
    });
    expect(claimed.model).toBe("deepseek-v4.1-flash");
    expect(claimed.effort).toBe("high");
  });

  it("records an observed model the registry does not know", () => {
    const claimed = claimTask(createTask({ title: "t", status: "ready" }), {
      paneId: "wR:p1",
      harness: "cursor",
      model: "grok-4.7",
      effort: "high",
    });
    expect(claimed.model).toBe("grok-4.7");
  });

  it("drops an effort that belonged to a different stored model", () => {
    const task = createTask({ title: "t", status: "ready", assignee: "agent", model: "gpt-5.6-luna", effort: "max" });
    const claimed = claimTask(task, { paneId: "wR:p1", harness: "pi", model: "deepseek-v4.1-flash" });
    expect(claimed.model).toBe("deepseek-v4.1-flash");
    expect(claimed.effort).toBeNull();
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

  it("backfills the observed model on a repeat same-pane claim", () => {
    const task = claimTask(createTask({ title: "t" }), { paneId: "wR:p1", agentName: "pi", harness: "pi" });
    expect(task.model).toBeNull();
    const refreshed = claimTask(task, {
      paneId: "wR:p1",
      agentName: "pi",
      harness: "pi",
      model: "deepseek-v4.1-flash",
      effort: "high",
    });
    expect(refreshed.model).toBe("deepseek-v4.1-flash");
    expect(refreshed.effort).toBe("high");
    expect(refreshed.claimedAt).toEqual(task.claimedAt);
    expect(refreshed.status).toBe("in_progress");
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
