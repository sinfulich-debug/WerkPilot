import type { AppointmentStatus, AppointmentTone } from '../lib/appointments';

// Status as a small dot and quiet text, not a colored pill.
export default function StatusBadge({ status, tone }: { status: AppointmentStatus; tone: AppointmentTone }) {
  const dot: Record<AppointmentTone, string> = {
    success: 'bg-emerald-600',
    warning: 'bg-amber-500',
    neutral: 'bg-slate-400',
  };

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-slate-700">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
      {status}
    </span>
  );
}
