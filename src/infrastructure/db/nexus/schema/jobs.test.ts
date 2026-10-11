import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

import type { NexusDb } from "@/infrastructure/db/nexus/db";
import { migrateNexusDatabase } from "@/infrastructure/db/nexus/migrate";

describe("jobs migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-jobs-"));
  const sqlite = new Database(join(dir, "nexus.db"));
  sqlite.pragma("foreign_keys = ON");

  afterAll(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies to a scratch database and passes integrity_check", () => {
    migrateNexusDatabase(drizzle(sqlite) as NexusDb);

    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");

    const tables = sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name in ('jobs', 'job_runs', 'jobs_meta') order by name",
      )
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual(["job_runs", "jobs", "jobs_meta"]);

    const columns = sqlite.prepare("pragma table_info(jobs)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "name",
      "kind",
      "schedule",
      "interval_seconds",
      "timezone",
      "prompt",
      "project_id",
      "target_pane_id",
      "target_mode",
      "harness",
      "model",
      "effort",
      "enabled",
      "state",
      "next_run_at",
      "last_run_at",
      "last_status",
      "last_error",
      "retry_count",
      "max_retries",
      "timeout_seconds",
      "run_count",
      "lease_owner",
      "lease_until",
      "created_at",
      "updated_at",
    ]);

    sqlite
      .prepare(
        "insert into jobs (id, name, prompt, created_at, updated_at) values ('j1', 'morning', 'check', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z')",
      )
      .run();
    const row = sqlite.prepare("select kind, target_mode, state, enabled, retry_count from jobs").get() as {
      kind: string;
      target_mode: string;
      state: string;
      enabled: number;
      retry_count: number;
    };
    expect(row).toEqual({ kind: "schedule", target_mode: "reuse", state: "active", enabled: 1, retry_count: 0 });

    expect(() => sqlite.prepare("insert into jobs_meta (id, last_tick_at) values (2, null)").run()).toThrow(/CHECK/);
    sqlite.prepare("insert into jobs_meta (id, last_tick_at) values (1, null)").run();
  });
});
