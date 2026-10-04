"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ProjectDto } from "@/lib/dto";
import { cn } from "@/lib/utils";

import { NO_PROJECT_KEY, type ProjectFilter } from "./board-filter";

const NO_PROJECT_LABEL = "No project";

/**
 * Project filter for the one board: an "All projects" chip plus a chip per
 * project with its task count, so what a filter hides is always visible. The
 * selection itself lives in `?project=` — the caller owns reading and writing it.
 */
export function BoardFilterBar({
  projects,
  counts,
  total,
  visible,
  value,
  onChange,
}: {
  projects: ProjectDto[];
  counts: Map<string, number>;
  total: number;
  visible: number;
  value: ProjectFilter;
  onChange: (filter: ProjectFilter) => void;
}) {
  const noProjectCount = counts.get(NO_PROJECT_KEY) ?? 0;

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:px-6 md:py-2.5">
      <span className="hidden shrink-0 text-xs font-medium text-muted-foreground md:inline">Project</span>
      {/* One scrollable strip on a phone (the board needs the height), a wrapping row on desktop. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5 [scrollbar-width:none] md:flex-wrap md:overflow-x-visible [&::-webkit-scrollbar]:hidden">
        <FilterChip label="All projects" count={total} active={value === null} onClick={() => onChange(null)} />
        {projects.map((project) => (
          <FilterChip
            key={project.id}
            label={project.name}
            count={counts.get(project.id) ?? 0}
            active={value === project.id}
            onClick={() => onChange(value === project.id ? null : project.id)}
          />
        ))}
        {noProjectCount > 0 ? (
          <FilterChip
            label={NO_PROJECT_LABEL}
            count={noProjectCount}
            active={value === NO_PROJECT_KEY}
            onClick={() => onChange(value === NO_PROJECT_KEY ? null : NO_PROJECT_KEY)}
          />
        ) : null}
      </div>
      {value !== null ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
            {visible} of {total} tasks
          </span>
          <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => onChange(null)}>
            <X />
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A toggle chip; clicking the active one again clears the filter. */
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className="gap-1.5"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
      {count > 0 ? (
        <span
          className={cn(
            "rounded-full px-1 text-[10px] tabular-nums",
            active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </Button>
  );
}
