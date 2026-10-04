import { defineConfig } from "drizzle-kit";

import { dataDir } from "./src/infrastructure/db/data-dir";

export default defineConfig({
  schema: "./src/infrastructure/db/tasks/schema/index.ts",
  out: "./src/infrastructure/db/tasks/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `${dataDir()}/nexus.db`,
  },
});
