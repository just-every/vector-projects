import './event-key.css';
import {useHydrated} from '../../../app/initial-resources';
import {useState,type FormEvent} from 'react';
/** The SendGrid Event Webhook key: a credential saved with an explicit button. Part of the intake's "How this works" fold. */
export function EventWebhookKey({teamId,configured,url,onChanged}:{teamId:string;configured:boolean;url:string;onChanged:()=>void}) {
  const hydrated=useHydrated();
  const [message,setMessage]=useState(''),[pending,setPending]=useState(false);
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=event.currentTarget;const key=String(new FormData(form).get('key')??'').trim();setPending(true);setMessage('');
    try{const response=await fetch(`/api/settings/teams/${teamId}/email-intake/event-key`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});if(!response.ok)throw new Error(`Verification key could not be saved (${response.status}).`);const data=await response.json() as {configured:boolean;url:string};setMessage(data.configured?'Event Webhook settings saved.':'Event Webhook verification removed.');form.reset();onChanged();}
    catch(error){setMessage(error instanceof Error?error.message:'Verification key could not be saved.');}finally{setPending(false);}
  }
  return <form className="sendgrid-event-key" aria-label="Configure SendGrid Event Webhook" onSubmit={save}>
    <p>{configured?'Verification key saved.':'No verification key saved.'}</p>
    <p className="sendgrid-event-url">Event Webhook URL: {url}</p>
    <div className="field"><div className="field-head"><label htmlFor={`event-key-${teamId}`}>SendGrid Event Webhook verification key</label></div>
      <input id={`event-key-${teamId}`} type="text" name="key" maxLength={500} autoComplete="off"/></div>
    <p>Enable signed Event Webhooks in SendGrid and paste its public verification key. Send processed, delivered and bounce events to this team's URL. Clear the key to stop callbacks.</p>
    <div className="confirm-actions"><button type="submit" className="button-quiet" disabled={pending||!hydrated}>Save Event Webhook key</button></div>
    {message&&<p role="status">{message}</p>}
  </form>;
}
