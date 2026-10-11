import { NextResponse } from "next/server";

import { unarchiveTask } from "@/infrastructure/container";

import { taskErrorResponse } from "../../_lib/errors";

/** Returns an archived task to the board as `ready`. */
export async function POST(_request: Request, context: RouteContext<"/api/tasks/[id]/unarchive">) {
  const { id } = await context.params;
  try {
    const task = await unarchiveTask.execute(id);
    return NextResponse.json({ data: task, error: null });
  } catch (error) {
    return taskErrorResponse(error);
  }
}
