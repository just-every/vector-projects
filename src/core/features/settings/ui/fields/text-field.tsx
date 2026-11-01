import { useHydrated } from '../../../../app/initial-resources';
import { useId, type HTMLInputTypeAttribute } from 'react';
import { FailureLine, SavedMark } from './field-feedback';
import { useAutosave } from './use-autosave';

/** A text entry that stores on blur or Enter. Typed text stays through a refused save and a background refresh. */
export function TextField({ label, value, save, placeholder, suggestions, type = 'text', hint, className }: {
  label: string; value: string; save: (next: string) => Promise<unknown>; placeholder?: string;
  suggestions?: readonly string[]; type?: HTMLInputTypeAttribute; hint?: string; className?: string;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const field = useAutosave({ value, save, label });
  return <div className={`field ${className ?? ''}`}>
    <div className="field-head"><label htmlFor={id}>{label}</label><SavedMark state={field.state} /></div>
    <input id={id} type={type} value={field.shown} disabled={!hydrated} placeholder={placeholder} maxLength={100} autoComplete="off" spellCheck={false}
      list={suggestions ? `${id}-list` : undefined} aria-describedby={hint ? `${id}-hint` : undefined}
      onChange={event => field.edit(event.target.value)}
      onBlur={() => void field.commit()}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void field.commit(); } }} />
    {suggestions && <datalist id={`${id}-list`}>{suggestions.map(item => <option key={item} value={item} />)}</datalist>}
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
  </div>;
}
