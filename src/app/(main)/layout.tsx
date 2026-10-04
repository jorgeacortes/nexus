import type { ReactNode } from "react";

import { AppSidebar } from "./_components/app-sidebar";

export default function MainLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
