import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Project = the stable container that tags tasks. Folder and Herdr workspace are both optional. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  folderPath: text("folder_path"),
  herdrWorkspaceId: text("herdr_workspace_id"),
  createdAt: text("created_at").notNull(),
});
