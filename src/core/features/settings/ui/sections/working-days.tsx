import { useHydrated } from '../../../../app/initial-resources';
import { useId } from 'react';
import { FailureLine, SavedMark } from '../fields/field-feedback';
import { useAutosave } from '../fields/use-autosave';

const days = [['Monday', 'M'], ['Tuesday', 'T'], ['Wednesday', 'W'], ['Thursday', 'T'], ['Friday', 'F'], ['Saturday', 'S'], ['Sunday', 'S']] as const;
const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every(day => b.includes(day));

/** Seven day chips; each toggle stores at once. */
export function WorkingDays({ value, save }: { value: number[]; save: (next: number[]) => Promise<unknown> }) {
  const id = useId();
  const hydrated = useHydrated();
  const field = useAutosave({ value, save, label: 'Working days', same: sameDays });
  return <fieldset className="field field-days">
    <legend className="field-head"><span>Working days</span><SavedMark state={field.state} /></legend>
    <div className="day-chips">
      {days.map(([name, initial], index) => {
        const day = index + 1, on = field.shown.includes(day);
        return <label key={name} htmlFor={`${id}-${day}`}>
          <input id={`${id}-${day}`} type="checkbox" aria-label={name} checked={on} disabled={!hydrated}
            onChange={() => void field.commit(on ? field.shown.filter(item => item !== day) : [...field.shown, day].sort())} />
          <span aria-hidden="true">{initial}</span>
        </label>;
      })}
    </div>
    <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
  </fieldset>;
}
