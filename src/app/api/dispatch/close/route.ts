import { NextResponse } from "next/server";
import { z } from "zod";

import { closeHarness } from "@/infrastructure/container";

import { dispatchErrorResponse } from "../_lib/errors";

const closeSchema = z.object({ tabId: z.string().trim().min(1) });

/**
 * The guarded teardown of DESIGN-dispatch.md: `nx dispatch close <tab>`.
 * Thin on purpose — validate, call the use case, return JSON. A protected tab
 * yields 409 and **no action**; the tab is still open.
 */
export async function POST(request: Request) {
  try {
    const parsed = closeSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues.map((issue) => issue.message).join(", ") },
        { status: 400 },
      );
    }
    return NextResponse.json({ data: await closeHarness.execute(parsed.data.tabId), error: null });
  } catch (error) {
    return dispatchErrorResponse(error);
  }
}
