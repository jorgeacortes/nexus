import { NextResponse } from "next/server";
import { z } from "zod";

import { dispatchTask } from "@/infrastructure/container";

import { dispatchErrorResponse } from "./_lib/errors";

const dispatchSchema = z.object({ taskId: z.string().min(1) });

/**
 * The one-shot actuator: lease the task, ensure its workspace, place and start
 * an agent, and push the brief. Thin on purpose — validate, call the use case,
 * return JSON. `nx dispatch <task>` is the only caller today; a future
 * `nx job tick` calls the same use case.
 */
export async function POST(request: Request) {
  try {
    const parsed = dispatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues.map((issue) => issue.message).join(", ") },
        { status: 400 },
      );
    }
    return NextResponse.json({ data: await dispatchTask.execute(parsed.data.taskId), error: null });
  } catch (error) {
    return dispatchErrorResponse(error);
  }
}
