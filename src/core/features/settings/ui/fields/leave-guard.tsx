import { useBlocker } from '@tanstack/react-router';
import { failedLabels, flushUnsaved, hasUnsaved } from './unsaved';

/**
 * Leaving a Settings page saves any pending edit first. When a save is refused the person is held on the page with
 * one line and a choice, so an edit is never lost silently.
 */
export function LeaveGuard() {
  const blocker = useBlocker({
    withResolver: true,
    shouldBlockFn: async () => !(await flushUnsaved(false)) && hasUnsaved(),
    enableBeforeUnload: () => hasUnsaved(),
  });
  if (blocker.status !== 'blocked') return null;
  const labels = failedLabels();
  return <div className="leave-guard" role="alert">
    <p>{labels.length ? `Couldn’t save ${labels.join(', ')}.` : 'A change is not saved yet.'}</p>
    <div className="leave-actions">
      <button type="button" onClick={async () => { if (await flushUnsaved(true)) blocker.proceed(); }}>Retry and leave</button>
      <button type="button" onClick={blocker.reset}>Stay</button>
      <button type="button" onClick={blocker.proceed}>Leave without saving</button>
    </div>
  </div>;
}
