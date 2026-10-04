"use client";

import { Ban, Bot, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  type AssigneeType,
  type Effort,
  effortsForModel,
  HARNESS_LABELS,
  HARNESSES,
  type Harness,
  modelsForHarness,
} from "@/domain/tasks/task";
import { cn } from "@/lib/utils";

export type AssignmentValue = {
  assignee: AssigneeType | null;
  harness: Harness | null;
  model: string | null;
  effort: string | null;
};

export const EMPTY_ASSIGNMENT_VALUE: AssignmentValue = {
  assignee: null,
  harness: null,
  model: null,
  effort: null,
};

/** Sensible starting point for a new agent assignment: pi with its first model. */
export function defaultAgentAssignment(): AssignmentValue {
  const harness: Harness = "pi";
  return { assignee: "agent", harness, model: modelsForHarness(harness)[0] ?? null, effort: null };
}

const ASSIGNEE_OPTIONS: Array<{ value: AssigneeType | null; label: string; icon: typeof Ban }> = [
  { value: null, label: "Unassigned", icon: Ban },
  { value: "me", label: "You", icon: UserRound },
  { value: "agent", label: "Agent", icon: Bot },
];

/**
 * Assignee picker: operator vs one agent, then harness → model → effort. The
 * model owns the effort vocabulary; the harness only narrows the model list.
 */
export function AssignmentFields({
  value,
  onChange,
}: {
  value: AssignmentValue;
  onChange: (next: AssignmentValue) => void;
}) {
  const models = value.harness ? modelsForHarness(value.harness) : [];
  const efforts = value.model ? effortsForModel(value.model) : [];

  function setHarness(harness: Harness) {
    onChange({ assignee: "agent", harness, model: modelsForHarness(harness)[0] ?? null, effort: null });
  }

  function setModel(model: string) {
    const nextEfforts = effortsForModel(model);
    const effort = value.effort && nextEfforts.includes(value.effort as Effort) ? value.effort : null;
    onChange({ ...value, model, effort });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Assignee</Label>
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {ASSIGNEE_OPTIONS.map(({ value: option, label, icon: Icon }) => (
            <Button
              key={label}
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={value.assignee === option}
              className={cn(
                "flex-1 text-muted-foreground",
                value.assignee === option && "bg-secondary text-secondary-foreground",
              )}
              onClick={() => {
                if (option === "agent") {
                  onChange(defaultAgentAssignment());
                } else {
                  onChange({ ...EMPTY_ASSIGNMENT_VALUE, assignee: option });
                }
              }}
            >
              <Icon className="size-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      {value.assignee === "agent" ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="assignment-harness">Harness</Label>
            <NativeSelect
              id="assignment-harness"
              className="w-full"
              value={value.harness ?? ""}
              onChange={(event) => setHarness(event.target.value as Harness)}
            >
              {HARNESSES.map((harness) => (
                <NativeSelectOption key={harness} value={harness}>
                  {HARNESS_LABELS[harness]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assignment-model">Model</Label>
            <NativeSelect
              id="assignment-model"
              className="w-full"
              value={value.model ?? ""}
              onChange={(event) => setModel(event.target.value)}
            >
              <NativeSelectOption value="">—</NativeSelectOption>
              {models.map((model) => (
                <NativeSelectOption key={model} value={model}>
                  {model}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assignment-effort">Effort</Label>
            <NativeSelect
              id="assignment-effort"
              className="w-full"
              value={value.effort ?? ""}
              onChange={(event) => onChange({ ...value, effort: event.target.value || null })}
            >
              <NativeSelectOption value="">—</NativeSelectOption>
              {efforts.map((effort) => (
                <NativeSelectOption key={effort} value={effort}>
                  {effort}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
      ) : null}
    </div>
  );
}
