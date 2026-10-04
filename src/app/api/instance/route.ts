import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { projectRepo, taskRepo } from "@/infrastructure/container";
import { dataDir, sqlitePath } from "@/infrastructure/db/data-dir";

/**
 * Which board this process is serving: the SQLite file behind it and how much
 * lives there. `nx` reads this to prove which instance it reached, so the
 * deployed container and an empty `./data-dev` that differ only by port cannot
 * be confused (see `src/cli/board-target.ts`).
 */
export async function GET() {
  try {
    const [projects, tasks] = await Promise.all([projectRepo.findAll(), taskRepo.findAll()]);
    return NextResponse.json({
      data: {
        service: "nexus",
        dataDir: resolve(dataDir()),
        database: resolve(sqlitePath("nexus.db")),
        counts: { projects: projects.length, tasks: tasks.length },
      },
      error: null,
    });
  } catch (error) {
    return NextResponse.json(
      { data: null, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
