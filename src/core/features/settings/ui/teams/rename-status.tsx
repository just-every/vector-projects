import { useEffect, useRef } from 'react';
import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { FailureLine, SavedMark } from '../fields/field-feedback';
import { useAutosave } from '../fields/use-autosave';
import type { Status } from './workflow-groups';

/** Rename in place: stored on blur or Enter; Escape leaves without a change. */
export function RenameStatus({ team, status, onDone }: { team: Administration['teams'][number]; status: Status; onDone: () => void }) {
  const call = useAdministrationCall();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const field = useAutosave({
    value: status.name, label: `Status name ${status.name}`,
    save: next => call(`/api/settings/teams/${team.id}/statuses/${status.id}`, 'PATCH', { name: next.trim() }),
  });
  async function finish() { if (await field.commit()) onDone(); }
  return <div className="status-rename">
    <input ref={input} type="text" aria-label={`Status name ${status.name}`} value={field.shown} maxLength={120} required autoComplete="off"
      onChange={event => field.edit(event.target.value)} onBlur={() => void finish()}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); void finish(); }
        if (event.key === 'Escape') { event.preventDefault(); onDone(); }
      }} />
    <SavedMark state={field.state} />
    <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
  </div>;
}
