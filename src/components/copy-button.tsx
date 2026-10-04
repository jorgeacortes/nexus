"use client";

import type { VariantProps } from "class-variance-authority";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, type buttonVariants } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

const COPIED_MS = 1600;

/**
 * Copies `value` to the clipboard and confirms it in place (icon flips to a
 * check) and with a toast. Without `label` it is an icon-only button named by
 * `title`, which is how the task rows use it; the task sheet passes `label` so
 * the whole uuid row reads as copyable.
 */
export function CopyButton({
  value,
  label,
  title = "Copy to clipboard",
  toastMessage = "Copied to clipboard",
  variant = "ghost",
  size,
  className,
}: {
  value: string;
  label?: string;
  title?: string;
  toastMessage?: string;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy() {
    const ok = await copyText(value);
    if (!ok) {
      toast.error("Could not copy to the clipboard");
      return;
    }
    setCopied(true);
    toast.success(toastMessage);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  const Icon = copied ? Check : Copy;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(label ? undefined : "text-muted-foreground", className)}
      title={copied ? "Copied" : title}
      aria-label={label ? undefined : title}
      onClick={copy}
    >
      <Icon className={cn(copied && "text-emerald-600 dark:text-emerald-400")} />
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </Button>
  );
}
