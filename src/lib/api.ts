/** Shape every Nexus REST route returns. */
export type ApiEnvelope<T> = { data: T; error: null } | { data: null; error: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Calls a Nexus route and unwraps the `{ data, error }` envelope, throwing on a
 * non-null error so client components can catch and toast it.
 */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (payload.error !== null || !response.ok) {
    throw new ApiError(payload.error ?? `Request failed with ${response.status}`, response.status);
  }
  return payload.data;
}
