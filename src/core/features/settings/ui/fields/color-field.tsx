import { useEffect, useId, useRef } from 'react';
import { useHydrated } from '../../../../app/initial-resources';
import { FailureLine, SavedMark } from './field-feedback';
import { useAutosave } from './use-autosave';

/** The native colour input: its swatch opens the picker. A pick is stored when the picker closes (or the field is left). */
export function ColorField({ label, value, save }: { label: string; value: string; save: (next: string) => Promise<unknown> }) {
  const id = useId();
  const hydrated = useHydrated();
  const input = useRef<HTMLInputElement>(null);
  const field = useAutosave({ value: value.toLowerCase(), save, label });
  const commit = useRef(field.commit);
  commit.current = field.commit;
  // React's onChange follows every drag in the picker; the native change event is the picker closing.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const closed = () => void commit.current(element.value);
    element.addEventListener('change', closed);
    return () => element.removeEventListener('change', closed);
  }, []);
  return <div className="field field-color">
    <div className="field-head"><label htmlFor={id}>{label}</label><SavedMark state={field.state} /></div>
    <div className="color-row">
      <input ref={input} id={id} type="color" value={field.shown} disabled={!hydrated}
        onChange={event => field.edit(event.target.value)} onBlur={() => void field.commit()} />
      <span className="color-code">{field.shown}</span>
    </div>
    <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
  </div>;
}
