import {z} from 'zod';
import {useState,type FormEvent} from 'react';
import {fetchJson,useApiResource} from '../../../app/api-client';
const channel=z.object({channelId:z.string(),channelName:z.string()});
const configuration=z.object({channels:z.array(channel),current:channel.nullable()});
const receipt=z.object({id:z.string()});
export function ProjectChannel({projectId}:{projectId:string}){
 const path=`/api/projects/${projectId}/slack-channel`,resource=useApiResource(path,configuration);
 const [selected,setSelected]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 async function bind(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setPending(true);setError('');setSaved(false);
  try{await fetchJson(path,receipt,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId:selected})});setSelected('');setSaved(true);resource.reload();}
  catch(cause){setError(cause instanceof Error?cause.message:'The channel could not be bound.');}
  finally{setPending(false);}
 }
 return <details><summary>Project Slack channel</summary>
 <p>Post new issue, triage and status events to a channel an Owner or Admin already bound or allowed.</p>
 {resource.error&&<p role="alert">{resource.error.message}</p>}
 {resource.data&&<><p>{resource.data.current?`Bound to #${resource.data.current.channelName}`:'No Slack channel bound.'}</p>
 <form aria-label="Project Slack channel" onSubmit={bind}><fieldset disabled={pending}><label htmlFor="project-slack-channel">Approved Slack channel</label><select id="project-slack-channel" required value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Choose an approved channel</option>{resource.data.channels.map(channel=><option key={channel.channelId} value={channel.channelId}>#{channel.channelName}</option>)}</select>
 {!resource.data.channels.length&&<p>An Owner or Admin can bind or allow a channel in Settings → Connections.</p>}
 <button disabled={!selected}>Bind project channel</button></fieldset></form></>}
 {pending&&<p role="status">Saving…</p>}{error&&<p role="alert">{error}</p>}{saved&&<p role="status">Project channel bound.</p>}</details>;
}
