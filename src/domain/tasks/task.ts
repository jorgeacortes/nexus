/**
 * Task domain: the kanban card. A task is an actionable unit owned by exactly
 * one actor — the operator (`me`) or a single agent — and belongs to at most one
 * project (the project is a tag, never a board).
 */

export const TASK_STATUSES = ["backlog", "ready", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ASSIGNEE_TYPES = ["me", "agent"] as const;
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

export const HARNESSES = ["pi", "claude_code", "cursor"] as const;
export type Harness = (typeof HARNESSES)[number];

export const HARNESS_LABELS: Record<Harness, string> = {
  pi: "pi",
  claude_code: "Claude Code",
  cursor: "Cursor",
};

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
 * Efforts a model supports. The model owns its effort vocabulary, so the same
 * model reports the same efforts under every harness.
 */
export function effortsForModel(model: string): readonly Effort[] {
  for (const harness of HARNESSES) {
    const efforts = (KNOWN_MODELS[harness] as Record<string, readonly Effort[]>)[model];
    if (efforts) return efforts;
  }
  return [];
}

export function isKnownModelForHarness(harness: Harness, model: string): boolean {
  return modelsForHarness(harness).includes(model);
}

export function isValidEffort(model: string, effort: string): boolean {
  return effortsForModel(model).includes(effort as Effort);
}

export type Task = {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee: AssigneeType | null;
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
  if (model && effort && !isValidEffort(model, effort)) {
    throw new TaskValidationError(`Effort "${effort}" is not valid for model "${model}".`);
  }

  return {
    assignee,
    agentName: input.agentName ?? null,
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

  return {
    id: crypto.randomUUID(),
    projectId: input.projectId ?? null,
    title: normalizeTitle(input.title),
    description: input.description ?? null,
    status,
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
    agentName: normalizeOptionalText(input.agentName) ?? task.agentName,
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
