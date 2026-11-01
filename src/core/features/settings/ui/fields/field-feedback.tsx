import type { SaveState } from './use-autosave';

/** A quiet "Saved" beside the control that changed. It fades by itself and never echoes the value. */
export function SavedMark({ state }: { state: SaveState }) {
  return <span className="field-saved" role="status" aria-live="polite">{state === 'saved' ? 'Saved' : ''}</span>;
}

/** The refused save, under its field: the value stays typed and Retry sends the same value again. */
export function FailureLine({ failed, reason, onRetry }: { failed: boolean; reason: string; onRetry: () => void }) {
  if (!failed) return null;
  return <p className="field-failure" role="alert">
    <span>Couldn’t save&nbsp;·&nbsp;<button type="button" className="field-retry" onClick={onRetry}>Retry</button></span>
    {reason && <span className="field-reason">{reason}</span>}
  </p>;
}
