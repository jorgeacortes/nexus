import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Kanban task. `status` is the "why has work stopped?" axis; `needs_human` is
 * the orthogonal "whose court is the ball in?" flag. Assignment columns are
 * loose pointers (SQLite owns assignments, Herdr owns live state) — `herdr_pane_id`
 * is never a foreign key.
 */
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("backlog"),
    assignee: text("assignee"),
    agentName: text("agent_name"),
    harness: text("harness"),
    model: text("model"),
    effort: text("effort"),
    herdrPaneId: text("herdr_pane_id"),
    needsHuman: integer("needs_human", { mode: "boolean" }).notNull().default(false),
    needsHumanReason: text("needs_human_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("tasks_status_updated_idx").on(table.status, table.updatedAt),
    index("tasks_project_idx").on(table.projectId),
    index("tasks_needs_human_idx").on(table.needsHuman),
    index("tasks_herdr_pane_idx").on(table.herdrPaneId),
  ],
);
