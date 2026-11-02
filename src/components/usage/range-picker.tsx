"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { addDays, customRange, PRESET_LABELS, presetRange, type DateRange, type RangePreset } from "@/lib/date-ranges";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";

const PRESETS: Exclude<RangePreset, "custom">[] = [
  "today",
  "this_week",
  "this_month",
  "last_month",
  "last_7",
  "last_30",
  "last_90",
  "ytd",
  "all",
];

export type RangeValue = { preset: RangePreset; range: DateRange };

export function describeRange(v: RangeValue): string {
  if (v.preset !== "custom") return PRESET_LABELS[v.preset];
  const { from, to } = v.range;
  if (!from || !to) return "Custom";
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(from)} – ${fmt(addDays(to, -1))}`;
}

export function RangePicker({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const [open, setOpen] = useState(false);
  const wide = useMediaQuery("(min-width: 640px)");
  const [draft, setDraft] = useState<DayPickerRange | undefined>(
    value.range.from && value.range.to ? { from: value.range.from, to: addDays(value.range.to, -1) } : undefined,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 gap-2">
          <CalendarDays className="size-4" />
          {describeRange(value)}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="flex max-h-[calc(100dvh-6rem)] w-auto max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-y-auto p-0 sm:flex-row"
      >
        <div className="grid grid-cols-3 gap-1 border-b p-2 sm:flex sm:w-40 sm:flex-col sm:border-r sm:border-b-0">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onChange({ preset: p, range: presetRange(p) });
                setOpen(false);
              }}
              className={cn(
                "rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted sm:px-2.5 sm:text-sm",
                value.preset === p && "bg-muted font-medium",
              )}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="p-2">
          <Calendar
            mode="range"
            numberOfMonths={wide ? 2 : 1}
            selected={draft}
            onSelect={setDraft}
            disabled={{ after: new Date() }}
            defaultMonth={draft?.from ?? addDays(new Date(), -30)}
          />
          <div className="flex items-center justify-end gap-2 border-t px-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draft?.from}
              onClick={() => {
                if (!draft?.from) return;
                onChange({ preset: "custom", range: customRange(draft.from, draft.to ?? draft.from) });
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
