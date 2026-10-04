"use client";

import { ThemeToggle } from "@/components/theme-toggle";

import { NavLinks, SidebarBrand } from "./sidebar-nav";

/** Desktop navigation rail. Below `md` the mobile drawer in `MobileNav` replaces it. */
export function AppSidebar({ inboxCount = 0 }: { inboxCount?: number }) {
  return (
    <aside className="hidden h-svh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <SidebarBrand />

      <nav className="flex-1 space-y-1 px-2">
        <NavLinks inboxCount={inboxCount} />
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}
