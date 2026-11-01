/** Every edited-but-unsaved field registers here, so leaving the page can save first or warn once. */
export type UnsavedEntry = {
  label: string;
  /** Resolves true when the value is stored. `retry` also resubmits a failed save. */
  flush: (retry: boolean) => Promise<boolean>;
  failed: () => boolean;
};

const entries = new Set<UnsavedEntry>();

export function registerUnsaved(entry: UnsavedEntry) {
  entries.add(entry);
  return () => { entries.delete(entry); };
}
export const hasUnsaved = () => entries.size > 0;
export const failedLabels = () => [...entries].filter(entry => entry.failed()).map(entry => entry.label);
/** Saves every pending field; true when nothing is left unsaved. */
export async function flushUnsaved(retry: boolean) {
  const results = await Promise.all([...entries].map(entry => entry.flush(retry)));
  return results.every(Boolean);
}
