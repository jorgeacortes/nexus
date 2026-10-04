import { formatDistanceToNow } from "date-fns";

/** "12 minutes ago" for an ISO timestamp, or null when absent. */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}
