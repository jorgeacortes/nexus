import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TaskDto } from "@/lib/dto";
import type { LiveAgent } from "@/lib/herdr";
import type { LinkedPaneState } from "@/lib/pane-link";

import { TaskCard } from "./task-card";

vi.mock("react-dnd", () => ({
  useDrag: () => [{ isDragging: false }, () => undefined],
}));

const DOT = "size-1.5 rounded-full";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "855c4986-0000-4000-8000-000000000000",
    projectId: null,
    title: "already done",
    description: null,
    status: "done",
    priority: "normal",
    assignee: "agent",
    agentName: "cursor",
    harness: "cursor",
    model: "grok-4.7",
    effort: "max",
    herdrPaneId: "wP:p9",
    needsHuman: false,
    needsHumanReason: null,
    claimedAt: null,
    completedAt: null,
    reviewedAt: null,
    archivedAt: null,
    completionNotes: null,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    ...overrides,
  };
}

function live(overrides: Partial<LiveAgent> = {}): LiveAgent {
  return {
    paneId: "wP:p9",
    tabId: "wP:t1",
    workspaceId: "wP",
    workspaceLabel: "nexus",
    tabLabel: "1",
    agentKind: "cursor",
    harness: "cursor",
    status: "working",
    cwd: "/tmp",
    terminalTitle: "",
    model: "claude-sonnet-5-5",
    effort: "high",
    topic: null,
    focused: false,
    ...overrides,
  };
}

function html(
  paneState: LinkedPaneState,
  overrides: Partial<TaskDto> = {},
  agent?: LiveAgent,
  compact = false,
): string {
  return renderToStaticMarkup(
    <TaskCard
      task={task(overrides)}
      liveAgent={agent}
      paneState={paneState}
      onSelect={() => undefined}
      compact={compact}
    />,
  );
}

describe("TaskCard pane status", () => {
  it("shows the live dot, label, and model only while the task is the pane's current one", () => {
    const markup = html("current", { status: "in_progress", title: "the live one" }, live());

    expect(markup).toContain("Working");
    expect(markup).toContain(DOT);
    expect(markup).toContain("Claude Sonnet 5.5");
    expect(markup).toContain("high");
    expect(markup).not.toContain("Grok 4.7");
    expect(markup).not.toContain("pane reused");
    expect(markup).not.toContain("pane offline");
  });

  it("renders a muted pane-reused line and the stored model when the pane moved on", () => {
    const markup = html("reused", {}, live());

    expect(markup).toContain("pane reused");
    expect(markup).toContain("Grok 4.7");
    expect(markup).toContain("max");
    expect(markup).not.toContain("Working");
    expect(markup).not.toContain(DOT);
    expect(markup).not.toContain("Claude Sonnet 5.5");
    expect(markup).not.toContain("pane offline");
  });

  it("drops the dot on the phone card too when the pane was reused", () => {
    const markup = html("reused", {}, live(), true);

    expect(markup).toContain("pane reused");
    expect(markup).not.toContain("Working");
    expect(markup).not.toContain(DOT);
    expect(markup).not.toContain("Grok 4.7");
  });

  it("says the pane is offline when the id is still stored but the pane is gone", () => {
    const markup = html("offline");

    expect(markup).toContain("pane offline");
    expect(markup).toContain("Grok 4.7");
    expect(markup).not.toContain("Working");
    expect(markup).not.toContain(DOT);
    expect(markup).not.toContain("pane reused");
  });

  it("renders no pane line when the task was never linked", () => {
    const markup = html("none", {
      herdrPaneId: null,
      assignee: null,
      agentName: null,
      harness: null,
      model: null,
      effort: null,
    });

    expect(markup).not.toContain("pane reused");
    expect(markup).not.toContain("pane offline");
    expect(markup).not.toContain("Working");
    expect(markup).not.toContain(DOT);
  });
});
