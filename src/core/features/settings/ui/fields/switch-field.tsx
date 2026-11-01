import { useHydrated } from '../../../../app/initial-resources';
import { useId } from 'react';
import { FailureLine, SavedMark } from './field-feedback';
import { useAutosave } from './use-autosave';

/** An on/off switch that stores as it flips; the whole labelled row is the target. */
export function SwitchField({ label, value, save, hint }: {
  label: string; value: boolean; save: (next: boolean) => Promise<unknown>; hint?: string;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const field = useAutosave({ value, save, label });
  return <div className="field field-switch">
    <label htmlFor={id} className="switch-row">
      <input id={id} type="checkbox" role="switch" checked={field.shown} disabled={!hydrated} aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={event => void field.commit(event.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-label">{label}</span>
      <SavedMark state={field.state} />
    </label>
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
  </div>;
}
