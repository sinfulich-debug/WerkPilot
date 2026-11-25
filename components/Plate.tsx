// German number plate: the one signature detail of the interface. Used wherever a plate is shown.
export default function Plate({ value, className = '' }: { value: string | null | undefined; className?: string }) {
  const text = value?.trim();
  if (!text) return <span className="text-slate-400">–</span>;
  return (
    <span className={`plate ${className}`} title="Kennzeichen">
      <span className="plate-eu" aria-hidden>
        D
      </span>
      <span className="plate-text">{text}</span>
    </span>
  );
}
