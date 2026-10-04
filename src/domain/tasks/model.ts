/**
 * Model ids as the harnesses print them, and the one canonical form Nexus
 * stores. Every model the app reads or renders passes through here, because the
 * three harnesses spell the same model differently:
 *
 *   pi          `opencode-go/deepseek-v4.1-flash`  (provider-prefixed id)
 *   Claude Code `claude-sonnet-5-5`                (assistant `message.model`)
 *   Cursor      `grok-4.7`                         (per-session `lastUsedModel`)
 *   Herdr label `Claude/Sonnet 5.5`                (display name + provider)
 *
 * The canonical id is the model id with the provider prefix removed, lowercased,
 * spaces turned into dashes, plus an explicit alias table for display names.
 * `KNOWN_MODELS` in `task.ts` is keyed by these ids, and the UI renders
 * `modelLabel()` instead of the raw id.
 */

/**
 * Display names and one-off spellings that mechanical normalisation cannot
 * derive. Keys are the normalised (lowercase, spaces → dashes) form; values are
 * canonical registry ids. Keep this list short and evidence-driven: anything the
 * harnesses print as an id already normalises without an entry.
 */
const MODEL_ALIASES: Record<string, string> = {
  // Herdr's status-line label for Claude Code, with the provider stripped.
  "sonnet-5.5": "claude-sonnet-5-5",
  "opus-5.5": "claude-opus-5-5",
  "fable-5": "claude-fable-5",
  "fable-5.1": "claude-fable-5-1",
  // Historical dotted ids: the registry spelled Claude models this way before
  // the live values (which use dashes) were verified. Rows already in SQLite
  // keep resolving.
  "claude-sonnet-5.5": "claude-sonnet-5-5",
  "claude-opus-5.5": "claude-opus-5-5",
  // Cursor's `displayName` appends the context window and effort to the id.
  "grok-4.7-256k-high": "grok-4.7",
};

/** Readable labels for the ids the registry knows; `modelLabel` falls back to the id. */
export const MODEL_LABELS: Record<string, string> = {
  "deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "glm-5.3-flash": "GLM-5.3 Flash",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "grok-4.6": "Grok 4.6",
  "grok-4.7": "Grok 4.7",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-fable-5": "Claude Fable 5",
  "claude-fable-5-1": "Claude Fable 5.1",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.7-flash": "Gemini 3.7 Flash",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-3.1-pro": "Gemini 3.1 Pro",
  "gpt-oss-120b": "GPT-OSS 120B",
};

/**
 * Normalises anything a harness or Herdr prints into the canonical id: drop the
 * provider prefix (`opencode-go/`, `Claude/`), lowercase, spaces → dashes, then
 * look the result up in the alias table. Unknown values pass through unchanged —
 * an observed model is ground truth and must never be rejected because the
 * hand-maintained registry is stale.
 */
export function normalizeModelId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const withoutProvider = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  const normalized = withoutProvider.toLowerCase().replace(/\s+/g, "-");
  return MODEL_ALIASES[normalized] ?? normalized;
}

/** Display label for a canonical id (`claude-sonnet-5-5` → "Claude Sonnet 5.5"). */
export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

/**
 * Reasoning-effort values the harnesses print, mapped onto the registry's
 * vocabulary. `off`/`none` mean "no reasoning" and are reported as null rather
 * than as an effort the card would have to render.
 */
const EFFORT_ALIASES: Record<string, string> = {
  "x-high": "xhigh",
  "extra-high": "xhigh",
  none: "",
  off: "",
};

/** Normalises a harness-reported effort; returns null for unknown/absent values. */
export function normalizeEffort(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return null;
  const mapped = EFFORT_ALIASES[normalized] ?? normalized;
  return mapped === "" ? null : mapped;
}
