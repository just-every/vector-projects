import { Refusal } from '../fields/use-autosave';

/** Time options every half hour, plus the stored value when it is a time between them. */
export function timeOptions(current: string) {
  const times = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);
  if (current && !times.includes(current)) times.push(current), times.sort();
  return times.map(value => ({ value, label: value }));
}

let zones: string[] | null = null;
/** The browser's own zone names, offered as suggestions while the field stays a typed value. */
export function timeZones(): string[] {
  zones ??= typeof Intl.supportedValuesOf === 'function' ? ['UTC', ...Intl.supportedValuesOf('timeZone').filter(zone => zone !== 'UTC')] : ['UTC'];
  return zones;
}

export function checkZone(value: string, allowEmpty: boolean) {
  if (!value) {
    if (allowEmpty) return;
    throw new Refusal('Use a name such as America/New_York.');
  }
  try { new Intl.DateTimeFormat(undefined, { timeZone: value }); }
  catch { throw new Refusal(`Use a name such as America/New_York${allowEmpty ? ', or leave it empty for the workspace zone' : ''}.`); }
}
