import { useId, useState, type FormEvent } from 'react';
import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { categories, categoryNames, type Status } from './workflow-groups';

/** "+ Add status": opens a short form in place with an explicit Add status. */
export function AddStatus({ team }: { team: Administration['teams'][number] }) {
  const id = useId();
  const call = useAdministrationCall();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Status['category']>('started');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function add(event: FormEvent) {
    event.preventDefault();
    setPending(true); setError('');
    try { await call(`/api/settings/teams/${team.id}/statuses`, 'POST', { name: name.trim(), category }); setName(''); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The status could not be added.'); }
    finally { setPending(false); }
  }
  if (!open) return <button type="button" className="link-button" onClick={() => setOpen(true)}><span aria-hidden="true">+</span> Add status</button>;
  return <form className="add-status" aria-label={`Add status to ${team.name}`} onSubmit={add}>
    <div className="add-status-pair">
      <div className="field"><div className="field-head"><label htmlFor={`${id}-name`}>Name</label></div>
        <input id={`${id}-name`} type="text" required maxLength={120} value={name} autoComplete="off" autoFocus onChange={event => setName(event.target.value)} /></div>
      <div className="field"><div className="field-head"><label htmlFor={`${id}-category`}>Category</label></div>
        <select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value as Status['category'])}>
          {categories.map(choice => <option key={choice} value={choice}>{categoryNames[choice]}</option>)}
        </select></div>
    </div>
    <div className="confirm-actions">
      <button type="submit" className="button-ink" disabled={pending}>Add status</button>
      <button type="button" className="button-text" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
    </div>
    {error && <p className="confirm-error" role="alert">{error}</p>}
  </form>;
}
