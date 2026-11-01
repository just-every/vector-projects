import { useId } from 'react';
import { useHydrated } from '../../../../app/initial-resources';
import { FailureLine, SavedMark } from './field-feedback';
import { useAutosave } from './use-autosave';

/** Several lines of text that store when the field is left (Enter adds a line). */
export function TextAreaField({ label, value, save, hint, rows = 4 }: {
  label: string; value: string; save: (next: string) => Promise<unknown>; hint?: string; rows?: number;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const field = useAutosave({ value, save, label });
  return <div className="field">
    <div className="field-head"><label htmlFor={id}>{label}</label><SavedMark state={field.state} /></div>
    <textarea id={id} rows={rows} value={field.shown} disabled={!hydrated} spellCheck={false} aria-describedby={hint ? `${id}-hint` : undefined}
      onChange={event => field.edit(event.target.value)} onBlur={() => void field.commit()} />
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
  </div>;
}
