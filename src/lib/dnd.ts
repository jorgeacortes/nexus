import type { Ref } from "react";

/**
 * react-dnd's connector types predate React 19's ref-cleanup contract (they may
 * return a ReactElement), so they are not assignable to `Ref<T>` directly.
 * This narrows the connector for use as a `ref` on a DOM element.
 */
export function dndRef<T>(connector: unknown): Ref<T> {
  return connector as Ref<T>;
}
