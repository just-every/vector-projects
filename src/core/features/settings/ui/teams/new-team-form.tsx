import { useId, useState, type FormEvent } from 'react';
import { useAdministrationCall } from '../admin/administration';
import { SlackChannelOption } from './slack-channel-option';

/** New team, in place at the head of the list: name, prefix, Private and (while Slack is connected) a Slack channel, with an explicit Create. */
export function NewTeamForm({ mayPrivate, onClose }: { mayPrivate: boolean; onClose: () => void }) {
  const id = useId();
  const call = useAdministrationCall();
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [slack, setSlack] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function create(event: FormEvent) {
    event.preventDefault();
    setPending(true); setError('');
    try {
      await call('/api/settings/teams', 'POST', {
        name: name.trim(), identifierPrefix: prefix, createSlackChannel: slack, ...(mayPrivate ? { isPrivate } : {}),
      });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The team could not be created.'); }
    finally { setPending(false); }
  }
  return <form className="new-team" aria-label="Create team" onSubmit={create}>
    <div className="new-team-pair">
      <div className="field"><div className="field-head"><label htmlFor={`${id}-name`}>Team name</label></div>
        <input id={`${id}-name`} type="text" required maxLength={120} value={name} autoComplete="off" autoFocus onChange={event => setName(event.target.value)} /></div>
      <div className="field"><div className="field-head"><label htmlFor={`${id}-prefix`}>Identifier prefix</label></div>
        <input id={`${id}-prefix`} type="text" required pattern="[A-Z]{2,10}" minLength={2} maxLength={10} value={prefix} autoComplete="off" aria-describedby={`${id}-prefix-hint`}
          title="Two to ten uppercase letters" onChange={event => setPrefix(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
        <p className="field-hint" id={`${id}-prefix-hint`}>Two to ten uppercase letters</p></div>
    </div>
    {mayPrivate && <div className="field field-switch">
      <label className="switch-row" htmlFor={`${id}-private`}>
        <input id={`${id}-private`} type="checkbox" role="switch" checked={isPrivate} onChange={event => setPrivate(event.target.checked)} />
        <span className="switch-track" aria-hidden="true" /><span className="switch-label">Private team</span>
      </label>
    </div>}
    {mayPrivate && <SlackChannelOption checked={slack} onChange={setSlack} />}
    <div className="confirm-actions">
      <button type="submit" className="button-ink" disabled={pending}>Create team</button>
      <button type="button" className="button-text" disabled={pending} onClick={onClose}>Cancel</button>
    </div>
    {error && <p className="confirm-error" role="alert">{error}</p>}
  </form>;
}
