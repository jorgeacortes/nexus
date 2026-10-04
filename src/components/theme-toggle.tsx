"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { applyThemeMode, readThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MODES: Array<{ mode: ThemeMode; icon: typeof Sun; label: string }> = [
  { mode: "light", icon: Sun, label: "Light" },
  { mode: "dark", icon: Moon, label: "Dark" },
  { mode: "system", icon: Laptop, label: "System" },
];

/** Cycles light/dark/system; the boot script prevents a flash on reload. */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    setMode(readThemeMode());
  }, []);

  return (
    <div className="flex items-center gap-1 rounded-lg border border-sidebar-border p-0.5">
      {MODES.map(({ mode: value, icon: Icon, label }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={mode === value}
          className={cn(
            "text-sidebar-foreground/70",
            mode === value && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
          onClick={() => {
            setMode(value);
            applyThemeMode(value);
          }}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}
