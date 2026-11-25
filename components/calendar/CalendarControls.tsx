'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export const CALENDAR_VIEWS = [
  { id: 'liste', label: 'Liste' },
  { id: 'woche', label: 'Woche' },
  { id: 'tag', label: 'Tag' },
] as const;

export type CalendarView = (typeof CALENDAR_VIEWS)[number]['id'];

export function ViewSwitch({ view, onChange }: { view: CalendarView; onChange: (view: CalendarView) => void }) {
  return (
    <div className="inline-flex rounded-2xl bg-slate-200/70 p-1" role="group" aria-label="Ansicht">
      {CALENDAR_VIEWS.map((option) => {
        const selected = view === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition ${selected ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type CalendarToolbarProps = {
  weekNumber: number;
  label: string;
  anchorDate: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onDateChange: (date: string) => void;
};

export function CalendarToolbar({
  weekNumber,
  label,
  anchorDate,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  onToday,
  onDateChange,
}: CalendarToolbarProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-[13px] font-medium text-slate-500">KW {weekNumber}</p>
        <h2 className="text-lg font-medium leading-tight text-slate-900">{label}</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          aria-label={previousLabel}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Heute
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label={nextLabel}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          Datum
          <input
            type="date"
            value={anchorDate}
            onChange={(event) => {
              if (event.target.value) onDateChange(event.target.value);
            }}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
          />
        </label>
      </div>
    </div>
  );
}
