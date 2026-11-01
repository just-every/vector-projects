import { auditAction, auditActor, actorLabels } from "./audit-labels";
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { ApiError, useApiResource } from '../../../app/api-client';
import { useViewerTime } from '../../../app/viewer-time';
import { actorKinds, auditSchema, auditSearch, type AuditQuery } from '../schema';
import '../../settings/ui/settings.css';
import './audit.css';

type Filters = Partial<Record<keyof AuditQuery, string>>;
export function AuditPanel() {
  const { formatInstant } = useViewerTime();
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const resource = useApiResource('/api/settings/audit?' + auditSearch(filters), auditSchema);
  const update = (key: keyof AuditQuery, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters({ ...draft, from: draft.from ? new Date(draft.from).toISOString() : '', to: draft.to ? new Date(draft.to).toISOString() : '' });
  };
  const entries = resource.data?.entries;
  const [choices, setChoices] = useState({ actors: [] as Array<{ value: string; label: string }>, actions: [] as string[] });
  useEffect(() => {
    if (!entries || Object.values(filters).some(Boolean)) return;
    setChoices({
      actors: [...new Map(entries.map(entry => [entry.actorRef, { value: entry.actorRef, label: auditActor(entry) }])).values()],
      actions: [...new Set(entries.map(entry => entry.action))],
    });
  }, [entries, filters]);
  // Only Owners and Admins browse the audit log: anyone else gets one plain line and a way on, never the server's JSON.
  if (resource.error instanceof ApiError && resource.error.status === 403)
    return <p role="status">You can’t open this page. <Link to="/app/settings/profile">Go to Profile</Link></p>;
  return <section id="audit" className="audit-panel" aria-labelledby="audit-heading">
    <div className="audit-heading"><div><h2 id="audit-heading">Audit log</h2><p>Who changed things in this workspace. Deleted people’s names are removed.</p></div>
      {resource.data && <a className="audit-export" href={'/api/settings/audit.csv?' + auditSearch({ ...filters, through: String(resource.data.through) })}>Export filtered CSV</a>}
    </div>
    <form className="audit-filters" onSubmit={apply}>
      <label>Person or service<select name="actor" value={draft.actor ?? ''} onChange={e => update('actor', e.target.value)}><option value="">Anyone</option>{choices.actors.map(actor => <option key={actor.value} value={actor.value}>{actor.label}</option>)}</select></label>
      <label>Activity by<select name="kind" value={draft.kind ?? ''} onChange={e => update('kind', e.target.value)}><option value="">Anyone</option>{actorKinds.map(kind => <option key={kind} value={kind}>{actorLabels[kind]}</option>)}</select></label>
      <label>Activity<select name="action" value={draft.action ?? ''} onChange={e => update('action', e.target.value)}><option value="">All activity</option>{choices.actions.map(action => <option key={action} value={action}>{auditAction(action)}</option>)}</select></label>
      <label>Item reference<input name="subject" placeholder="Copy from an entry’s details" value={draft.subject ?? ''} onChange={e => update('subject', e.target.value)} /></label>
      <label>From (your local time)<input name="from" type="datetime-local" value={draft.from ?? ''} onChange={e => update('from', e.target.value)} /></label>
      <label>To (your local time)<input name="to" type="datetime-local" value={draft.to ?? ''} min={draft.from || undefined} onChange={e => update('to', e.target.value)} /></label>
      <div className="audit-filter-actions"><button type="submit">Apply filters</button><button type="button" onClick={() => { setDraft({}); setFilters({}); resource.reload(); }}>Clear filters</button><button type="button" onClick={resource.reload}>Refresh</button></div>
    </form>
    {resource.loading && <p role="status">Loading audit log…</p>}
    {resource.error && <p role="alert">{resource.error.message} <button type="button" onClick={resource.reload}>Retry</button></p>}
    {entries && <><p role="status">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</p>
      {entries.length ? <div className="audit-table-scroll"><table><thead><tr><th scope="col">Time</th><th scope="col">Person or service</th><th scope="col">Activity</th><th scope="col">Item</th></tr></thead>
        <tbody>{entries.map(entry => <tr key={entry.id}><td data-label="Time"><time dateTime={entry.at}>{formatInstant(entry.at)}</time></td>
          <td data-label="Person or service">{auditActor(entry)}</td><td data-label="Activity"><span>{auditAction(entry.action)}</span></td><td data-label="Item"><details><summary>Record details</summary><code>{entry.subjectRef}</code></details></td></tr>)}</tbody></table></div> : <p>No audit entries match these filters.</p>}
    </>}
  </section>;
}

export function AuditPage() {
  return <main className="settings-page"><header><p className="settings-eyebrow">Workspace</p><h1>Audit log</h1><a href="/app/settings">Back to Settings</a></header><AuditPanel /></main>;
}
