import { ensureDataDir, sqlitePath } from "@/infrastructure/db/data-dir";
import { createNexusDb } from "@/infrastructure/db/nexus/db";
import { migrateNexusDatabase } from "@/infrastructure/db/nexus/migrate";

/**
 * Applies the Nexus migrations to the SQLite file selected by `DATA_DIR`
 * (default `./data`). Run before the server starts — dev, Docker entrypoint, or
 * `pnpm db:migrate`.
 */
ensureDataDir();
const database = createNexusDb({ path: sqlitePath("nexus.db") });
migrateNexusDatabase(database);
console.log(`migrations applied to ${sqlitePath("nexus.db")}`);
