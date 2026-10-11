import { Archive, Bot, Columns3, FolderKanban, Inbox, type LucideIcon, Network, Timer } from "lucide-react";

export type NavItem = { href: string; label: string; hint: string; icon: LucideIcon };

/** The app's destinations, shared by the desktop sidebar and the mobile drawer. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/board", label: "Board", hint: "One kanban", icon: Columns3 },
  { href: "/archive", label: "Archive", hint: "After 7 days", icon: Archive },
  { href: "/inbox", label: "Inbox", hint: "Needs you", icon: Inbox },
  { href: "/agents", label: "Agents", hint: "Live status", icon: Bot },
  { href: "/servers", label: "Servers", hint: "Listening ports", icon: Network },
  { href: "/projects", label: "Projects", hint: "Folders", icon: FolderKanban },
  { href: "/jobs", label: "Jobs", hint: "Schedule", icon: Timer },
];

/** The destination whose href is a prefix of `pathname`, if any. */
export function currentNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
