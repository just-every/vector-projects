import {Link} from '@tanstack/react-router';
import './github-rules.css';
import {useState} from 'react';
import {z} from 'zod';
import {ApiError,fetchJson,useApiResource} from '../../../app/api-client';
import {gitRuleSchema as ruleSchema} from '../github/rule-schema';
const teamSchema=z.object({id:z.string(),name:z.string(),statuses:z.array(z.object({id:z.string(),name:z.string()})),rules:z.array(ruleSchema)});
const schema=z.object({teams:z.array(teamSchema)});
const names={draft:'Draft PR opened',review:'Review requested',merged:'PR merged',deploy:'Production deployed'};
function Rule({team,rule,onSaved}:{team:z.infer<typeof teamSchema>;rule:z.infer<typeof ruleSchema>;onSaved:()=>void}){
 const [version,setVersion]=useState(rule.version),[status,setStatus]=useState(rule.statusId??''),[environment,setEnvironment]=useState(rule.environment),[reopen,setReopen]=useState(Boolean(rule.allowReopen)),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function save(){setBusy(true);setMessage('');try{const receipt=await fetchJson('/api/settings/teams/'+team.id,z.object({saved:z.boolean(),rule:ruleSchema}),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({githubAutomation:{trigger:rule.trigger,statusId:status||null,allowReopen:reopen,expectedVersion:version,environment}})});setVersion(receipt.rule.version);setMessage('Rule saved.');onSaved();}catch(e){setMessage(e instanceof ApiError&&e.status===409?'This rule changed. Reload the page before saving again.':e instanceof ApiError&&e.status===403?'You no longer have permission to change this team’s rules.':'Rule could not be saved. Try again.');}finally{setBusy(false);}}
 return <form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy}><legend>{names[rule.trigger]}</legend><label htmlFor={team.id+'-'+rule.trigger}>{team.name} {names[rule.trigger]} status</label><select id={team.id+'-'+rule.trigger} value={status} onChange={e=>setStatus(e.target.value)}><option value="">Do not move</option>{team.statuses.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>{rule.trigger==='deploy'&&<label>{team.name} production environment<input value={environment} required maxLength={200} onChange={e=>setEnvironment(e.target.value)}/></label>}<label className="github-rule-reopen"><input type="checkbox" checked={reopen} onChange={e=>setReopen(e.target.checked)}/>Allow this rule to reopen completed issues</label><button type="submit">Save {names[rule.trigger]} rule</button>{message&&<p role="status">{message}</p>}</fieldset></form>;
}
// The collection belongs to the Teams panel, rather than each removable editor.
export function useGithubRules(){
 return useApiResource('/api/github/automation',schema);
}
export type GithubRulesResource=ReturnType<typeof useGithubRules>;
export function GithubRules(props:{teamId:string;resource:GithubRulesResource}|{teamId?:undefined}){
 return props.teamId?<TeamGithubRules teamId={props.teamId} data={props.resource}/>:<p><Link className="github-rules-teams-link" to="/app/settings/teams">Manage Git automation rules in Teams</Link></p>;
}
function TeamGithubRules({teamId,data}:{teamId:string;data:GithubRulesResource}){
 const team=data.data?.teams.find(team=>team.id===teamId);
 return <section className="github-rules" aria-label="Git automation rules"><h4>Team automation</h4><p>Rules act as Git automation. Completed issues stay completed unless their rule explicitly allows reopening. Production defaults to an environment named production; a team can choose another name below.</p>{data.error&&<p role="alert">{data.error.message}</p>}{team&&<details><summary>{team.name} Git automation</summary>{team.rules.map(rule=><Rule key={rule.trigger} team={team} rule={rule} onSaved={data.reload}/>)}</details>}</section>;
}
