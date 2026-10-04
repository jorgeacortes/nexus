import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Kanban task. Status is an open text column (indexed) so boards can define
 * their own columns; the app-level domain type narrows the default board flow.
 */
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("backlog"),
    agentId: text("agent_id"),
    agentName: text("agent_name"),
    projectId: text("project_id"),
    needsHuman: integer("needs_human", { mode: "boolean" }).notNull().default(false),
    blockedReason: text("blocked_reason"),
    herdrPaneId: text("herdr_pane_id"),
    herdrTabId: text("herdr_tab_id"),
    herdrWorkspaceId: text("herdr_workspace_id"),
    dueAt: text("due_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("tasks_status_updated_idx").on(table.status, table.updatedAt),
    index("tasks_agent_idx").on(table.agentId),
    index("tasks_needs_human_idx").on(table.needsHuman),
  ],
);
