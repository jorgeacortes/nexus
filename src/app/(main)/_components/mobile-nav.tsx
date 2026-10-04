"use client";

import { Inbox, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import { currentNavItem } from "./nav-items";
import { NavLinks, SidebarBrand } from "./sidebar-nav";

/**
 * Phone navigation: a compact bar naming the current screen plus a left drawer
 * with the same destinations as the desktop rail. The bar replaces the rail
 * below `md`, where a 240px column would eat the viewport.
 */
export function MobileNav({ inboxCount = 0 }: { inboxCount?: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const current = currentNavItem(pathname);
  const onInbox = current?.href === "/inbox";

  return (
    <header className="flex items-center gap-1.5 border-b border-border bg-sidebar py-1.5 pr-3 pl-1.5 text-sidebar-foreground md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open navigation" className="text-sidebar-foreground/80">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="gap-0 bg-sidebar p-0 text-sidebar-foreground data-[side=left]:w-72"
          aria-label="Navigation"
        >
          <SheetHeader className="gap-0 border-b border-sidebar-border p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Nexus destinations</SheetDescription>
            <SidebarBrand />
          </SheetHeader>
          <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
            <NavLinks inboxCount={inboxCount} itemClassName="py-2.5" onNavigate={() => setOpen(false)} />
          </nav>
          <div className="border-t border-sidebar-border p-3">
            <ThemeToggle />
          </div>
        </SheetContent>
      </Sheet>

      <span className="truncate text-sm font-semibold">{current?.label ?? "Nexus"}</span>

      {inboxCount > 0 && !onInbox ? (
        <Link
          href="/inbox"
          className="ml-auto inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-amber-500/20 px-2 text-[11px] font-medium text-amber-600 dark:text-amber-300"
        >
          <Inbox className="size-3" />
          {inboxCount} need you
        </Link>
      ) : null}
    </header>
  );
}
