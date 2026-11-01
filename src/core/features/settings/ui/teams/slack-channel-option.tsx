import { useId } from 'react';
import { useApiResource } from '../../../../app/api-client';
import { channelConfiguration } from '../../../integrations/channels/schema';

/** "Create Slack channel": offered only while Slack is connected, unchecked until chosen. Its one line names the effect. */
export function SlackChannelOption({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  const id = useId();
  const config = useApiResource('/api/settings/integrations/channels', channelConfiguration);
  if (config.error) return <p className="confirm-error" role="alert">Slack availability could not be checked. <button type="button" className="field-retry" onClick={config.reload}>Retry</button></p>;
  if (!config.data?.slack.connected) return null;
  return <div className="field field-switch">
    <label className="switch-row" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden="true" /><span className="switch-label">Create Slack channel</span>
    </label>
    <p className="field-hint" id={`${id}-hint`}>A new Slack channel is created for this team when you press Create team.</p>
  </div>;
}
