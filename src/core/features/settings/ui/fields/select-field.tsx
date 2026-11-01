import { useHydrated } from '../../../../app/initial-resources';
import { useId } from 'react';
import { FailureLine, SavedMark } from './field-feedback';
import { useAutosave } from './use-autosave';

export type Option<T extends string> = { value: T; label: string };

/** A select that stores its choice as it changes. */
export function SelectField<T extends string>({ label, value, options, save, hint, className }: {
  label: string; value: T; options: readonly Option<T>[]; save: (next: T) => Promise<unknown>; hint?: string; className?: string;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const field = useAutosave({ value, save, label });
  return <div className={`field ${className ?? ''}`}>
    <div className="field-head"><label htmlFor={id}>{label}</label><SavedMark state={field.state} /></div>
    <select id={id} value={field.shown} disabled={!hydrated} aria-describedby={hint ? `${id}-hint` : undefined} onChange={event => void field.commit(event.target.value as T)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
  </div>;
}
