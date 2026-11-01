import { useId, useState, type FormEvent } from 'react';
import { useAdministrationCall } from '../admin/administration';

/** New label, in place at the head of the list, with an explicit Create. */
export function NewLabelForm({ onClose }: { onClose: () => void }) {
  const id = useId();
  const call = useAdministrationCall();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8fa3f0');
  const [projects, setProjects] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function create(event: FormEvent) {
    event.preventDefault();
    setPending(true); setError('');
    try { await call('/api/settings/labels', 'POST', { name: name.trim(), color, projectsEnabled: projects }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The label could not be created.'); }
    finally { setPending(false); }
  }
  return <form className="new-label" aria-label="Create label" onSubmit={create}>
    <div className="new-label-pair">
      <div className="field"><div className="field-head"><label htmlFor={`${id}-name`}>Name</label></div>
        <input id={`${id}-name`} type="text" required maxLength={120} value={name} autoComplete="off" autoFocus onChange={event => setName(event.target.value)} /></div>
      <div className="field field-color"><div className="field-head"><label htmlFor={`${id}-color`}>Colour</label></div>
        <div className="color-row"><input id={`${id}-color`} type="color" value={color} onChange={event => setColor(event.target.value)} /><span className="color-code">{color}</span></div></div>
    </div>
    <div className="field field-switch">
      <label className="switch-row" htmlFor={`${id}-projects`}>
        <input id={`${id}-projects`} type="checkbox" role="switch" checked={projects} onChange={event => setProjects(event.target.checked)} />
        <span className="switch-track" aria-hidden="true" /><span className="switch-label">Use for projects</span>
      </label>
    </div>
    <div className="confirm-actions">
      <button type="submit" className="button-ink" disabled={pending}>Create label</button>
      <button type="button" className="button-text" disabled={pending} onClick={onClose}>Cancel</button>
    </div>
    {error && <p className="confirm-error" role="alert">{error}</p>}
  </form>;
}
