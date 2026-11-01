import { useId } from 'react';
import { useHydrated } from '../../../../app/initial-resources';
import { FailureLine, SavedMark } from './field-feedback';
import { Refusal, useAutosave } from './use-autosave';

/** A whole number (or empty, meaning off) that stores on blur or Enter. */
export function NumberField({ label, value, min, max, save, placeholder = 'Off', suffix }: {
  label: string; value: number | null; min: number; max: number; placeholder?: string; suffix?: string;
  save: (next: number | null) => Promise<unknown>;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const field = useAutosave<string>({
    value: value === null ? '' : String(value), label,
    save: async text => {
      const trimmed = text.trim();
      if (trimmed === '') return save(null);
      const next = Number(trimmed);
      if (!Number.isInteger(next) || next < min || next > max) throw new Refusal(`Use a whole number from ${min} to ${max}, or leave it empty to turn this off.`);
      return save(next);
    },
  });
  return <div className="field field-number">
    <div className="field-head"><label htmlFor={id}>{label}</label><SavedMark state={field.state} /></div>
    <div className="number-row">
      <input id={id} type="text" inputMode="numeric" value={field.shown} placeholder={placeholder} disabled={!hydrated} autoComplete="off"
        onChange={event => field.edit(event.target.value)} onBlur={() => void field.commit()}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void field.commit(); } }} />
      {suffix && <span className="number-suffix">{suffix}</span>}
    </div>
    <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
  </div>;
}
