import { useHydrated } from '../../../../app/initial-resources';
import { useId } from 'react';
import { FailureLine, SavedMark } from './field-feedback';
import type { Option } from './select-field';
import { useAutosave } from './use-autosave';

/** A few exclusive choices drawn as one segmented control; each pick stores at once. */
export function ChoiceField<T extends string>({ label, value, options, save }: {
  label: string; value: T; options: readonly Option<T>[]; save: (next: T) => Promise<unknown>;
}) {
  const name = useId();
  const hydrated = useHydrated();
  const field = useAutosave({ value, save, label });
  return <fieldset className="field field-choice">
    <legend className="field-head"><span>{label}</span><SavedMark state={field.state} /></legend>
    <div className="choice-segments">
      {options.map(option => <label key={option.value}>
        <input type="radio" name={name} value={option.value} disabled={!hydrated} checked={field.shown === option.value} onChange={() => void field.commit(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>
    <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
  </fieldset>;
}
