import { createNexusDb, type NexusDb } from "@/infrastructure/db/nexus/db";
import { migrateNexusDatabase } from "@/infrastructure/db/nexus/migrate";

/** In-memory SQLite with the real migrations applied — used by repository tests. */
export function createTestDb(): NexusDb {
  const database = createNexusDb({ path: ":memory:" });
  migrateNexusDatabase(database);
  return database;
}
