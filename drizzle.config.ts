import { defineConfig } from "drizzle-kit";

import { dataDir } from "./src/infrastructure/db/data-dir";

export default defineConfig({
  schema: "./src/infrastructure/db/nexus/schema/index.ts",
  out: "./src/infrastructure/db/nexus/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `${dataDir()}/nexus.db`,
  },
});
