import { NextResponse } from "next/server";
import { z } from "zod";

import { ClaimTaskUseCase } from "@/application/tasks/claim-task";
import { HARNESSES } from "@/domain/tasks/task";
import { taskRepo } from "@/infrastructure/container";

import { taskErrorResponse } from "../../_lib/errors";

const claimSchema = z.object({
  paneId: z.string().nullable().optional(),
  agentName: z.string().nullable().optional(),
  harness: z.enum(HARNESSES).nullable().optional(),
});

/**
 * Claims a task for an agent: `backlog`/`ready` → `in_progress`. An agent pane
 * always has `$HERDR_PANE_ID` set, so it may omit `paneId`; the web UI sends an
 * explicit value and therefore never picks up the server's own pane.
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
    const paneId = (parsed.data.paneId ?? process.env.HERDR_PANE_ID ?? "").trim() || null;
    const task = await new ClaimTaskUseCase(taskRepo).execute(id, { ...parsed.data, paneId });
    return NextResponse.json({ data: task, error: null });
  } catch (error) {
    return taskErrorResponse(error);
  }
}
