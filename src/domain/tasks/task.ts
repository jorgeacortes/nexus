/**
 * Task domain: the kanban card. A task is an actionable unit owned by exactly
 * one actor — the operator (`me`) or a single agent — and belongs to at most one
 * project (the project is a tag, never a board).
 */

export const TASK_STATUSES = ["backlog", "ready", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["blocker", "high", "normal", "low", "someday"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  blocker: "Blocker",
  high: "High",
  normal: "Normal",
  low: "Low",
  someday: "Someday",
};

export const TASK_PRIORITY_ORDER: Record<TaskPriority, number> = {
  blocker: 0,
  high: 1,
  normal: 2,
  low: 3,
  someday: 4,
};

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export const ASSIGNEE_TYPES = ["me", "agent"] as const;
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

export const HARNESSES = ["pi", "claude_code", "cursor", "agy"] as const;
export type Harness = (typeof HARNESSES)[number];

export const HARNESS_LABELS: Record<Harness, string> = {
  pi: "pi",
  claude_code: "Claude Code",
  cursor: "Cursor",
  agy: "Agy",
};

/**
 * Harnesses Nexus can talk to over the Herdr socket (`agent.prompt`). Cursor is
 * a GUI and is resolved by hand. Shared by the resolve use case and the Inbox so
 * the two never disagree about who can be prompted.
 */
export const PROMPTABLE_HARNESSES: readonly Harness[] = ["pi", "claude_code", "agy"];

/**
 * Maps a Herdr agent kind to a Nexus harness. Herdr reports more kinds than the
 * registry knows (`codex`, `gemini`, `aider`, `opencode`); those stay unlinked
 * and are carried by `agentName` alone.
 */
export function harnessFromAgentKind(kind: string): Harness | null {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "pi") return "pi";
  if (normalized === "claude" || normalized === "claude_code" || normalized === "claude-code") return "claude_code";
  if (normalized === "cursor") return "cursor";
  if (normalized === "agy" || normalized === "antigravity") return "agy";
  return null;
}

export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/**
 * The hand-maintained model registry: `harness → model → supported efforts`.
 * Effort vocabulary belongs to the model, not the harness — the harness only
 * constrains which models it offers. Adding a model means editing this constant.
 */
export const KNOWN_MODELS = {
  pi: {
    "claude-sonnet-5.5": ["low", "medium", "high", "max"],
    "claude-opus-5.5": ["low", "medium", "high", "max"],
    "gpt-5.6-luna": ["low", "medium", "high", "xhigh"],
    "gemini-3.8-flash": ["minimal", "low", "medium", "high"],
    "grok-4.6": ["low", "medium", "high"],
  },
  claude_code: {
    "claude-sonnet-5.5": ["low", "medium", "high", "max"],
    "claude-opus-5.5": ["low", "medium", "high", "max"],
  },
  cursor: {
    "claude-sonnet-5.5": ["low", "medium", "high", "max"],
    "gpt-5.6-luna": ["low", "medium", "high", "xhigh"],
    "gemini-3.8-flash": ["minimal", "low", "medium", "high"],
    "grok-4.6": ["low", "medium", "high"],
  },
  // antigravity (`agy`) hands out models with the effort baked into the id it
  // prints (`agy models` lists `gemini-3.8-flash-high`), but the CLI accepts the
  // base model plus `--effort`. The registry stores the normalised pair, so the
  // effort vocabulary is verified per model (agy's flash has no `minimal`,
  // unlike pi's entry of the same name).
  agy: {
    "gemini-3.8-flash": ["low", "medium", "high"],
    "gemini-3.7-flash": ["low", "medium", "high"],
    "gemini-3.6-flash": ["low", "medium", "high"],
    "gemini-3.1-pro": ["low", "high"],
    "claude-opus-5-5": ["low", "medium", "high"],
    "claude-sonnet-5-5": ["low", "medium", "high"],
    "gpt-oss-120b": ["medium"],
  },
} as const satisfies Record<Harness, Record<string, readonly Effort[]>>;

export type KnownModel = keyof (typeof KNOWN_MODELS)["pi"];

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskValidationError";
  }
}

/** Raised when a second pane tries to claim a task another pane already holds. */
export class TaskAlreadyClaimedError extends Error {
  constructor(id: string, paneId: string | null = null) {
    super(paneId ? `Task ${id} is already claimed by pane ${paneId}.` : `Task ${id} is already claimed.`);
    this.name = "TaskAlreadyClaimedError";
  }
}

/** Raised when a claim/complete is attempted from a status that forbids it. */
export class TaskTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskTransitionError";
  }
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isAssigneeType(value: unknown): value is AssigneeType {
  return typeof value === "string" && (ASSIGNEE_TYPES as readonly string[]).includes(value);
}

export function isHarness(value: unknown): value is Harness {
  return typeof value === "string" && (HARNESSES as readonly string[]).includes(value);
}

/** Models the harness is allowed to offer, in registry order. */
export function modelsForHarness(harness: Harness): readonly string[] {
  return Object.keys(KNOWN_MODELS[harness]);
}

/**
 * Efforts a model supports. Effort is a property of the model, but the harness
 * declares which of them it exposes for that model — `agy`'s `gemini-3.8-flash`
 * has no `minimal`, while pi's entry of the same name does — so pass the harness
 * whenever it is known. Without one, the first registry hit wins.
 */
export function effortsForModel(model: string, harness?: Harness | null): readonly Effort[] {
  if (harness) {
    const efforts = (KNOWN_MODELS[harness] as Record<string, readonly Effort[]>)[model];
    if (efforts) return efforts;
  }
  for (const candidate of HARNESSES) {
    const efforts = (KNOWN_MODELS[candidate] as Record<string, readonly Effort[]>)[model];
    if (efforts) return efforts;
  }
  return [];
}

export function isKnownModelForHarness(harness: Harness, model: string): boolean {
  return modelsForHarness(harness).includes(model);
}

export function isValidEffort(model: string, effort: string, harness?: Harness | null): boolean {
  return effortsForModel(model, harness).includes(effort as Effort);
}

export type Task = {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: AssigneeType | null;
  /**
   * The live Herdr agent kind behind the task (`pi`, `claude_code`, `cursor`,
   * `agy`, or a kind Nexus does not map yet — `codex`, `aider`). Written only by
   * the pane identity resolver from a live snapshot: never a Herdr tab/pane id, never
   * free text. Null when the pane is not a live agent.
   */
  agentName: string | null;
  harness: Harness | null;
  model: string | null;
  effort: string | null;
  herdrPaneId: string | null;
  needsHuman: boolean;
  needsHumanReason: string | null;
  claimedAt: Date | null;
  completedAt: Date | null;
  completionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The assignment half of a task, validated as a unit. */
export type TaskAssignment = Pick<Task, "assignee" | "agentName" | "harness" | "model" | "effort" | "herdrPaneId">;

export type CreateTaskInput = {
  projectId?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: AssigneeType | null;
  agentName?: string | null;
  harness?: Harness | null;
  model?: string | null;
  effort?: string | null;
  herdrPaneId?: string | null;
  needsHuman?: boolean;
  needsHumanReason?: string | null;
};

export type UpdateTaskInput = {
  projectId?: string | null;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: AssigneeType | null;
  agentName?: string | null;
  harness?: Harness | null;
  model?: string | null;
  effort?: string | null;
  herdrPaneId?: string | null;
  needsHuman?: boolean;
  needsHumanReason?: string | null;
};

/** Statuses a task can be claimed from. */
export const CLAIMABLE_STATUSES: readonly TaskStatus[] = ["backlog", "ready"];

/** Statuses a task can be completed from; `blocked` force-closes it. */
export const COMPLETABLE_STATUSES: readonly TaskStatus[] = ["in_progress", "blocked"];

export type ClaimTaskInput = {
  paneId?: string | null;
  agentName?: string | null;
  harness?: Harness | null;
};

export type CompleteTaskInput = { notes?: string | null };

/** Short, human-friendly handle for a task id (`#a1b2c3d4`). */
export function shortTaskId(id: string): string {
  return id.slice(0, 8);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Herdr ids look like `wR:t2` / `wR:p1` — never an agent kind. */
const HERDR_ID_PATTERN = /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;

/**
 * `agentName` carries an agent kind, so a Herdr pane/tab id is rejected here —
 * the exact value the tab-id fallback used to leak into this column.
 */
function normalizeAgentName(value: string | null | undefined): string | null {
  const name = normalizeOptionalText(value);
  if (name === null) return null;
  if (HERDR_ID_PATTERN.test(name)) {
    throw new TaskValidationError(`"${name}" is a Herdr pane/tab id, not an agent kind.`);
  }
  return name;
}

const EMPTY_ASSIGNMENT: TaskAssignment = {
  assignee: null,
  agentName: null,
  harness: null,
  model: null,
  effort: null,
  herdrPaneId: null,
};

/**
 * Validates and normalizes an assignment. The `(model, effort)` pair is checked
 * against the registry; a harness may only carry models it offers. Assigning a
 * task to `me` (or nobody) clears every agent field.
 */
export function normalizeAssignment(input: {
  assignee?: AssigneeType | null;
  agentName?: string | null;
  harness?: Harness | null;
  model?: string | null;
  effort?: string | null;
  herdrPaneId?: string | null;
}): TaskAssignment {
  const assignee = input.assignee ?? null;
  if (assignee !== "agent") {
    return { ...EMPTY_ASSIGNMENT, assignee };
  }

  const harness = input.harness ?? null;
  const model = input.model ?? null;
  const effort = input.effort ?? null;

  if (harness && model && !isKnownModelForHarness(harness, model)) {
    throw new TaskValidationError(`Model "${model}" is not offered by harness "${harness}".`);
  }
  if (effort && !model) {
    throw new TaskValidationError("An effort requires a model.");
  }
  if (model && effort && !isValidEffort(model, effort, harness)) {
    throw new TaskValidationError(`Effort "${effort}" is not valid for model "${model}".`);
  }

  return {
    assignee,
    agentName: normalizeAgentName(input.agentName),
    harness,
    model,
    effort,
    herdrPaneId: input.herdrPaneId ?? null,
  };
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "") {
    throw new TaskValidationError("A task needs a title.");
  }
  return trimmed;
}

export function createTask(input: CreateTaskInput): Task {
  const now = new Date();
  const status = input.status ?? "backlog";
  if (!isTaskStatus(status)) {
    throw new TaskValidationError(`Unknown status "${status}".`);
  }
  const priority = input.priority ?? "normal";
  if (!isTaskPriority(priority)) {
    throw new TaskValidationError(`Unknown priority "${priority}".`);
  }

  return {
    id: crypto.randomUUID(),
    projectId: input.projectId ?? null,
    title: normalizeTitle(input.title),
    description: input.description ?? null,
    status,
    priority,
    ...normalizeAssignment(input),
    needsHuman: input.needsHuman ?? false,
    needsHumanReason: input.needsHuman ? (input.needsHumanReason ?? null) : null,
    claimedAt: null,
    completedAt: null,
    completionNotes: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Claims a task for an agent pane: `backlog`/`ready` → `in_progress`. A claim
 * from the same pane that already holds the task is idempotent (returns the task
 * unchanged); a claim from any other pane is rejected. Existing model/effort and
 * a pre-recorded pane are preserved.
 */
export function claimTask(task: Task, input: ClaimTaskInput = {}): Task {
  const now = new Date();
  const paneId = normalizeOptionalText(input.paneId);

  if (task.status === "in_progress") {
    if (paneId !== null && task.herdrPaneId === paneId) {
      return task;
    }
    throw new TaskAlreadyClaimedError(task.id, task.herdrPaneId);
  }
  if (!CLAIMABLE_STATUSES.includes(task.status)) {
    throw new TaskTransitionError(`A task in "${task.status}" cannot be claimed.`);
  }

  const assignment = normalizeAssignment({
    assignee: "agent",
    agentName: normalizeAgentName(input.agentName) ?? task.agentName,
    harness: input.harness !== undefined ? input.harness : task.harness,
    model: task.model,
    effort: task.effort,
    herdrPaneId: paneId ?? task.herdrPaneId,
  });

  return {
    ...task,
    status: "in_progress",
    ...assignment,
    claimedAt: now,
    completedAt: null,
    completionNotes: null,
    updatedAt: now,
  };
}

/**
 * Completes a task: `in_progress` (or `blocked`, force-closing it) → `done`.
 * Clears the needs-human flag, stamps `completedAt`, and keeps the notes passed in.
 */
export function completeTask(task: Task, input: CompleteTaskInput = {}): Task {
  const now = new Date();
  if (!COMPLETABLE_STATUSES.includes(task.status)) {
    throw new TaskTransitionError(`A task in "${task.status}" cannot be completed.`);
  }

  return {
    ...task,
    status: "done",
    needsHuman: false,
    needsHumanReason: null,
    completedAt: now,
    completionNotes: normalizeOptionalText(input.notes) ?? task.completionNotes,
    updatedAt: now,
  };
}

/** Applies a partial update, re-validating the assignment when any of its fields change. */
export function updateTask(task: Task, input: UpdateTaskInput): Task {
  const status = input.status ?? task.status;
  if (!isTaskStatus(status)) {
    throw new TaskValidationError(`Unknown status "${status}".`);
  }
  const priority = input.priority !== undefined ? input.priority : task.priority;
  if (!isTaskPriority(priority)) {
    throw new TaskValidationError(`Unknown priority "${priority}".`);
  }

  const assignmentTouched =
    input.assignee !== undefined ||
    input.agentName !== undefined ||
    input.harness !== undefined ||
    input.model !== undefined ||
    input.effort !== undefined ||
    input.herdrPaneId !== undefined;

  const assignment = assignmentTouched
    ? normalizeAssignment({
        assignee: input.assignee !== undefined ? input.assignee : task.assignee,
        agentName: input.agentName !== undefined ? input.agentName : task.agentName,
        harness: input.harness !== undefined ? input.harness : task.harness,
        model: input.model !== undefined ? input.model : task.model,
        effort: input.effort !== undefined ? input.effort : task.effort,
        herdrPaneId: input.herdrPaneId !== undefined ? input.herdrPaneId : task.herdrPaneId,
      })
    : null;

  const needsHuman = input.needsHuman ?? task.needsHuman;

  return {
    ...task,
    projectId: input.projectId !== undefined ? input.projectId : task.projectId,
    title: input.title !== undefined ? normalizeTitle(input.title) : task.title,
    description: input.description !== undefined ? input.description : task.description,
    status,
    priority,
    ...(assignment ?? {
      assignee: task.assignee,
      agentName: task.agentName,
      harness: task.harness,
      model: task.model,
      effort: task.effort,
      herdrPaneId: task.herdrPaneId,
    }),
    needsHuman,
    needsHumanReason: needsHuman
      ? input.needsHumanReason !== undefined
        ? input.needsHumanReason
        : task.needsHumanReason
      : null,
    updatedAt: new Date(),
  };
}
