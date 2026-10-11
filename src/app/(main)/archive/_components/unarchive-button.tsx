"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

/** Puts an archived task back on the board as Ready. The next sweep cannot re-archive it. */
export function UnarchiveButton({ taskId, title }: { taskId: string; title: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function unarchive() {
    setPending(true);
    try {
      await apiFetch(`/api/tasks/${taskId}/unarchive`, { method: "POST" });
      toast.success(`"${title}" is back on the board as Ready`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unarchive the task");
      setPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={unarchive} disabled={pending}>
      {pending ? "Unarchiving..." : "Unarchive"}
    </Button>
  );
}
