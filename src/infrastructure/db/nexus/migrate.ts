import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { NexusDb } from "@/infrastructure/db/nexus/db";

const here = dirname(fileURLToPath(import.meta.url));

/** drizzle-kit output folder, resolved from this module so Docker/tsx agree. */
export const NEXUS_MIGRATIONS_DIR = join(here, "migrations");

/** Applies pending drizzle-kit migrations to a Nexus database. */
export function migrateNexusDatabase(database: NexusDb, migrationsFolder: string = NEXUS_MIGRATIONS_DIR): void {
  migrate(database, { migrationsFolder });
}
