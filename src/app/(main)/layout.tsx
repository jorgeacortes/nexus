import type { ReactNode } from "react";

import { taskRepo } from "@/infrastructure/container";

import { AppSidebar } from "./_components/app-sidebar";
import { MobileNav } from "./_components/mobile-nav";

export default async function MainLayout({ children }: Readonly<{ children: ReactNode }>) {
  const tasks = await taskRepo.findAll();
  const inboxCount = tasks.filter((task) => task.needsHuman).length;

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      <AppSidebar inboxCount={inboxCount} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileNav inboxCount={inboxCount} />
        {children}
      </div>
    </div>
  );
}
