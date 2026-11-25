'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ProcessFillFieldProps = {
  fieldKey: string;
  label: string;
  hint?: string;
  initialValue: string;
};

type Status = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const MAX_LENGTH = 4000;
const AUTOSAVE_DELAY_MS = 800;
const ENDPOINT = '/einstellungen/verfahrensdokumentation/api';

/**
 * A fill-in field of the Verfahrensdokumentation. It saves by itself a moment after the user stops typing
 * and when the field loses focus, so nothing is lost when the page is closed. When printed, it shows the text
 * (or an empty box to write into by hand).
 */
export default function ProcessFillField({ fieldKey, label, hint, initialValue }: ProcessFillFieldProps) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<Status>('idle');
  const [errorText, setErrorText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | null>(null);
  const latestRef = useRef(initialValue);
  const savedRef = useRef(initialValue);
  const savingRef = useRef(false);

  // grow with the text so that nothing is hidden behind a scrollbar (also when printed)
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  const save = useCallback(async () => {
    if (savingRef.current) return; // the running save picks up the newest text when it is done
    savingRef.current = true;
    try {
      while (latestRef.current !== savedRef.current) {
        const sending = latestRef.current;
        setStatus('saving');
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: fieldKey, answer: sending }),
        });
        let result: unknown = null;
        try {
          result = await response.json();
        } catch {
          // handled below
        }
        const ok = response.ok && typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === true;
        if (!ok) {
          const message = typeof result === 'object' && result !== null ? (result as { error?: unknown }).error : undefined;
          throw new Error(typeof message === 'string' ? message : 'Die Antwort konnte nicht gespeichert werden.');
        }
        savedRef.current = sending;
      }
      setStatus('saved');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Die Antwort konnte nicht gespeichert werden.');
      setStatus('error');
    } finally {
      savingRef.current = false;
    }
  }, [fieldKey]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleChange = (next: string) => {
    setValue(next);
    latestRef.current = next;
    setStatus('dirty');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  };

  const handleBlur = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (latestRef.current !== savedRef.current) void save();
  };

  const inputId = `fill-${fieldKey}`;
  return (
    <div className="mt-3 break-inside-avoid rounded-xl border border-dashed border-amber-400 bg-amber-50 p-3 print:border-slate-400 print:bg-white">
      <p className="text-[13px] font-medium text-amber-800 print:hidden">Bitte ausfüllen</p>
      <label htmlFor={inputId} className="mt-1 block text-sm font-medium text-slate-900">
        {label}
      </label>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
      <textarea
        id={inputId}
        ref={textareaRef}
        value={value}
        maxLength={MAX_LENGTH}
        rows={2}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={handleBlur}
        aria-describedby={`${inputId}-status`}
        className="mt-2 block min-h-[3.5rem] w-full resize-none overflow-hidden rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-accent-600 print:border-slate-400"
      />
      <p
        id={`${inputId}-status`}
        role={status === 'error' ? 'alert' : 'status'}
        className={`mt-1 min-h-[1rem] text-xs print:hidden ${status === 'error' ? 'text-rose-700' : status === 'saved' ? 'text-emerald-700' : 'text-slate-500'}`}
      >
        {status === 'dirty' && 'Noch nicht gespeichert …'}
        {status === 'saving' && 'Wird gespeichert …'}
        {status === 'saved' && 'Gespeichert'}
        {status === 'error' && errorText}
      </p>
    </div>
  );
}
