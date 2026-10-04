"use client";

import { Bot, Columns3, FolderKanban, Inbox, type LucideIcon, Network } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; hint: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { href: "/board", label: "Board", hint: "One kanban", icon: Columns3 },
  { href: "/inbox", label: "Inbox", hint: "Needs you", icon: Inbox },
  { href: "/agents", label: "Agents", hint: "Live status", icon: Bot },
  { href: "/servers", label: "Servers", hint: "Listening ports", icon: Network },
  { href: "/projects", label: "Projects", hint: "Folders", icon: FolderKanban },
];

export function AppSidebar({ inboxCount = 0 }: { inboxCount?: number }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-svh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Columns3 className="size-4" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Nexus</p>
          <p className="text-xs text-sidebar-foreground/60">agent ops console</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {NAV_ITEMS.map(({ href, label, hint, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="flex-1 font-medium">{label}</span>
              {href === "/inbox" && inboxCount > 0 ? (
                <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                  {inboxCount}
                </span>
              ) : (
                <span className="text-[11px] text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60">
                  {hint}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}
