"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import nexusMark from "@/app/apple-icon.png";
import { cn } from "@/lib/utils";

import { NAV_ITEMS } from "./nav-items";

/** Nexus wordmark; the desktop sidebar and the mobile drawer both start with it. */
export function SidebarBrand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-5">
      {/* The StarCraft Nexus mark (see AGENTS.md → Branding). The art is RGBA with a
          transparent background, so it sits on the sidebar as-is — no tinted plate.
          Width/height are explicit so the brand block cannot shift on load. */}
      <Image src={nexusMark} alt="" width={32} height={32} priority className="size-8 shrink-0 rounded-lg" />
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">Nexus</p>
        <p className="text-xs text-sidebar-foreground/60">agent ops console</p>
      </div>
    </div>
  );
}

/**
 * The nav list itself, so the sidebar and the mobile drawer cannot drift.
 * `itemClassName` carries the only difference between them: the drawer is
 * touch-first, so its rows are taller.
 */
export function NavLinks({
  inboxCount = 0,
  itemClassName,
  onNavigate,
}: {
  inboxCount?: number;
  itemClassName?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {NAV_ITEMS.map(({ href, label, hint, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
              itemClassName,
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
    </>
  );
}
