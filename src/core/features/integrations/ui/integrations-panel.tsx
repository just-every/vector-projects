import {ErrorSettings} from './error-settings';
import {ChannelSettings} from './channel-settings';
import {useState} from 'react';
import {useApiResource} from '../../../app/api-client';
import {configSchema,personalTokensSchema,send,acknowledged,type Secret} from './client';
import {TokenSettings} from './token-settings';
import {SourceSettings} from './source-settings';
import {WebhookSettings} from './webhook-settings';
import {GithubSettings} from './github-settings';
import {OneTimeSecret} from './one-time-secret';
import './integrations.css';
/** Owners and Admins manage the workspace's integrations; every other member
 * sees only their own API tokens (ROLE-008 row "Open Settings pages"). */
/** The Connections page shows the services; the Developers page shows tokens and delivery history. */
export type IntegrationsPart='connections'|'developers';
export function IntegrationsPanel({teams,workspace,part}:{teams:{id:string;name:string;archivedAt:string|null}[];workspace:boolean;part:IntegrationsPart}){
 return workspace?<WorkspaceIntegrations teams={teams} part={part}/>:<PersonalTokens/>;
}
function PersonalTokens(){
 const tokens=useApiResource('/api/settings/integrations/tokens',personalTokensSchema),[secret,setSecret]=useState<Secret|null>(null),[error,setError]=useState('');
 return <section id="integrations" className="integrations-panel" aria-labelledby="integrations-heading"><h2 id="integrations-heading">Integrations</h2><p>Owners and Admins connect the workspace’s integrations. Your personal API tokens are here.</p>{tokens.error&&<p role="alert">{tokens.error.message}</p>}{error&&<p role="alert">{error}</p>}{secret&&<OneTimeSecret key={secret.token} value={secret} onClose={()=>setSecret(null)}/>}{tokens.data&&<TokenSettings tokens={tokens.data.tokens} onSecret={value=>{setError('');setSecret(value);}} onChanged={tokens.reload} onError={cause=>setError(cause instanceof Error?cause.message:'The operation could not complete.')}/>}</section>;
}
function WorkspaceIntegrations({teams,part}:{teams:{id:string;name:string;archivedAt:string|null}[];part:IntegrationsPart}){
 const config=useApiResource('/api/settings/integrations',configSchema),[secret,setSecret]=useState<Secret|null>(null),[error,setError]=useState(''),[resolving,setResolving]=useState<string|null>(null),[evidence,setEvidence]=useState('');
 const fail=(error:unknown)=>setError(error instanceof Error?error.message:'The operation could not complete. Read the retained state before retrying.');
 const reveal=(value:Secret)=>{setError('');setSecret(value);};
 const resolve=async(id:string,kind:'accepted'|'rejected')=>{try{await send('/deliveries/'+encodeURIComponent(id)+'/resolve',acknowledged,{kind,evidenceCode:evidence});setResolving(null);setEvidence('');config.reload();}catch(error){fail(error);}};
 return <section id="integrations" className="integrations-panel" aria-labelledby="integrations-heading"><h2 id="integrations-heading">Integrations</h2>{config.error&&<p role="alert">{config.error.message}</p>}{error&&<p role="alert">{error}</p>}{secret&&secret.kind!=='source'&&<OneTimeSecret key={secret.token??secret.secret} value={secret} onClose={()=>setSecret(null)}/>}{config.data&&part==='connections'&&<><ErrorSettings teams={teams}/><ChannelSettings/><SourceSettings credential={secret?.kind==='source'?secret:undefined} onCloseSecret={()=>setSecret(null)} sources={config.data.sources} teams={teams} onSecret={reveal} onChanged={config.reload} onError={fail}/><WebhookSettings config={config.data} onSecret={reveal} onChanged={config.reload} onError={fail}/><GithubSettings repositories={config.data.github} onSecret={reveal} onChanged={config.reload} onError={fail}/></>}{config.data&&part==='developers'&&<><TokenSettings tokens={config.data.tokens} onSecret={reveal} onChanged={config.reload} onError={fail}/><h3>Delivery history</h3><button type="button" onClick={config.reload}>Refresh delivery history</button><p>Accepted records acknowledge the receiver’s response. Uncertain records need independent receiver evidence; they are not resent automatically.</p><ul>{config.data.deliveries.map(delivery=><li key={delivery.id}><strong>{delivery.event}</strong> → {delivery.destinationName}<p>{delivery.reason}{delivery.httpStatus!==null?` (HTTP ${delivery.httpStatus})`:""}</p><span>{delivery.state}</span>{delivery.erased?' · Payload erased; dispatch disabled':''} · {delivery.attempts} attempts {delivery.state==='uncertain'&&<button type="button" onClick={()=>{setResolving(delivery.id);setEvidence('');}}>Reconcile this delivery</button>}</li>)}</ul>{resolving&&<fieldset><legend>Record receiver evidence</legend><label>Evidence reference<input required pattern={"[A-Za-z0-9_.\\-]+"} maxLength={100} value={evidence} onChange={event=>setEvidence(event.target.value)} placeholder="ticket-or-receiver-record"/></label><button type="button" disabled={!evidence} onClick={()=>void resolve(resolving,'accepted')}>Receiver accepted</button><button type="button" disabled={!evidence} onClick={()=>void resolve(resolving,'rejected')}>Receiver rejected</button><button type="button" onClick={()=>setResolving(null)}>Cancel reconciliation</button></fieldset>}<h3>Issue change events</h3><ul>{config.data.events.map(event=><li key={event.id}>{event.event} · {event.erased?'Erased after issue deletion':event.held?'Held after restore':event.enqueuedAt?'Ready for delivery':'Waiting for delivery setup'}</li>)}</ul></>}</section>;
}
