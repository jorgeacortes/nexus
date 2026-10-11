import { NextResponse } from "next/server";

import { archiveTasks } from "@/infrastructure/container";

/**
 * One-shot archive sweep. `nx archive sweep` is the command; the board and
 * task-list reads call the same use case. This route does not schedule anything.
 */
export async function POST() {
  try {
    const result = await archiveTasks.execute();
    return NextResponse.json({ data: result, error: null });
  } catch (error) {
    return NextResponse.json(
      { data: null, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
