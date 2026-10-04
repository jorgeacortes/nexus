import { describe, expect, it } from "vitest";

import { AgentUnreachableError, DEFAULT_UNBLOCK_PROMPT, ResolveTaskUseCase } from "@/application/tasks/resolve-task";
import type { AgentPromptPort } from "@/domain/tasks/agent-prompt";
import { DrizzleTaskRepository } from "@/infrastructure/repositories/tasks/drizzle-task.repository";
import { createTestDb } from "@/test-support/db";

function recordingPrompt(): { port: AgentPromptPort; calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    port: {
      prompt: async (paneId, text) => {
        calls.push([paneId, text]);
      },
    },
  };
}

describe("ResolveTaskUseCase", () => {
  it("prompts a terminal harness, then clears the flag", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({
      title: "blocked",
      assignee: "agent",
      harness: "pi",
      herdrPaneId: "wR:p1",
      needsHuman: true,
      needsHumanReason: "needs a decision",
    });

    const { port, calls } = recordingPrompt();
    const resolved = await new ResolveTaskUseCase(repo, port).execute(task.id);

    expect(calls).toEqual([["wR:p1", DEFAULT_UNBLOCK_PROMPT]]);
    expect(resolved.needsHuman).toBe(false);
    expect(resolved.needsHumanReason).toBeNull();
  });

  it("forwards a custom message", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({
      title: "blocked",
      assignee: "agent",
      harness: "claude_code",
      herdrPaneId: "wK:p1",
      needsHuman: true,
    });

    const { port, calls } = recordingPrompt();
    await new ResolveTaskUseCase(repo, port).execute(task.id, { message: "Use the staging key." });
    expect(calls).toEqual([["wK:p1", "Use the staging key."]]);
  });

  it("clears a Cursor task without prompting", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({
      title: "cursor work",
      assignee: "agent",
      harness: "cursor",
      herdrPaneId: "wS:p1",
      needsHuman: true,
    });

    const { port, calls } = recordingPrompt();
    const resolved = await new ResolveTaskUseCase(repo, port).execute(task.id);
    expect(calls).toEqual([]);
    expect(resolved.needsHuman).toBe(false);
  });

  it("keeps the flag when the agent is unreachable", async () => {
    const repo = new DrizzleTaskRepository(createTestDb());
    const task = await repo.save({
      title: "blocked",
      assignee: "agent",
      harness: "pi",
      herdrPaneId: "wR:p1",
      needsHuman: true,
    });

    const failing: AgentPromptPort = {
      prompt: async () => {
        throw new Error("socket down");
      },
    };

    await expect(new ResolveTaskUseCase(repo, failing).execute(task.id)).rejects.toThrow(AgentUnreachableError);
    expect((await repo.findById(task.id))?.needsHuman).toBe(true);
  });
});
