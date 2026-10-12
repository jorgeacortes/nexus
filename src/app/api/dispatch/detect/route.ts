import { NextResponse } from "next/server";

import { detectLostAgents } from "@/infrastructure/container";

import { dispatchErrorResponse } from "../_lib/errors";

/**
 * The one-shot lost-agent sweep of DESIGN-dispatch.md: `nx dispatch detect`.
 * Thin on purpose — call the use case once and return JSON. It is a POST because
 * it writes (it ends a dispatch and flags a task); `GET /api/herdr/snapshot`
 * stays read-only and **never** calls detection. Nothing here runs on a timer.
 */
export async function POST() {
  try {
    return NextResponse.json({ data: await detectLostAgents.execute(), error: null });
  } catch (error) {
    return dispatchErrorResponse(error);
  }
}
