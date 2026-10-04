import { NextResponse } from "next/server";
import { z } from "zod";

import { ClaimTaskUseCase } from "@/application/tasks/claim-task";
import { liveAgents, taskRepo } from "@/infrastructure/container";

import { taskErrorResponse } from "../../_lib/errors";

const claimSchema = z.object({
  paneId: z.string().nullable().optional(),
});

/**
 * Claims a task for an agent pane: `backlog`/`ready` → `in_progress`. The caller
 * states which pane claims it (the `nx` CLI sends `$HERDR_PANE_ID`); the agent
 * identity (kind + harness) is resolved server-side from the live Herdr snapshot,
 * so a client cannot record its own pane/tab id as the agent name. The server's
 * own `$HERDR_PANE_ID` is never used — a dev server running inside a pane must
 * not attribute claims to itself.
 */
export async function POST(request: Request, context: RouteContext<"/api/tasks/[id]/claim">) {
  const { id } = await context.params;
  try {
    const parsed = claimSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues.map((issue) => issue.message).join(", ") },
        { status: 400 },
      );
    }
    const paneId = (parsed.data.paneId ?? "").trim() || null;
    const task = await new ClaimTaskUseCase(taskRepo, liveAgents).execute(id, { paneId });
    return NextResponse.json({ data: task, error: null });
  } catch (error) {
    return taskErrorResponse(error);
  }
}
