import { useState } from 'react'
import { z } from 'zod'
import { fetchJson,useApiResource } from '../../app/api-client'
import { workspaceOptionsSchema } from '../../shared/workspace-options'
import { MentionTextarea } from '../notifications/ui/mention-textarea'
import { templateSchema,templateListSchema,type TemplateInput,type IssueTemplate } from './schema'
import type { NewIssueDraft } from '../issues/ui/new-issue-draft'
import '../project-templates/templates.css'

// Unmounted controls retire their state while admitted private reads drain.
const url='/api/issue-templates'
const send=(method:string,body:unknown)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
type Defaults=TemplateInput['defaults']
const blank=():TemplateInput=>({name:'',teamId:null,defaults:{},subissues:[]})

export function IssueTemplateSettings() {
  const list=useApiResource(url,templateListSchema,undefined,{abortPendingOnDispose:false}),options=useApiResource('/api/options',workspaceOptionsSchema)
  const [draft,setDraft]=useState<TemplateInput|null>(null),[editing,setEditing]=useState<IssueTemplate|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState(false)
  const reset=()=>{setDraft(null);setEditing(null);setConfirm(false)}
  const act=async(run:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await run();list.reload()}catch(e){setError(e instanceof Error?e.message:'Template change failed.')}finally{setBusy(false)}}
  return <section className="project-template-controls" aria-labelledby="issue-templates-heading">
    <h3 id="issue-templates-heading">Issue templates</h3>
    <p>Save defaults and subissues. Applying defaults keeps fields you have already entered. Deleting a template keeps created issues.</p>
    {(error||list.error||options.error)&&<p role="alert">{error||list.error?.message||options.error?.message}</p>}{notice&&<p role="status">{notice}</p>}
    <ul>{list.data?.templates.map(t=><li key={t.id}>{t.name} · {t.subissues.length} subissues{t.canEdit&&<button type="button" disabled={busy} onClick={()=>{setDraft({name:t.name,teamId:t.teamId,defaults:t.defaults,subissues:t.subissues});setEditing(t);setConfirm(false);setNotice('')}}>Edit {t.name}</button>}</li>)}</ul>
    {(list.data?.workspaceAllowed||list.data?.teams.some(t=>t.canManage))&&!draft&&<button type="button" onClick={()=>{setDraft({...blank(),teamId:list.data!.workspaceAllowed?null:list.data!.teams.find(t=>t.canManage)!.id});setEditing(null)}}>New issue template</button>}
    {draft&&options.data&&<form aria-label="Edit issue template" onSubmit={event=>{event.preventDefault();void act(async()=>{const saved=await fetchJson(url+(editing?'/'+editing.id:''),templateSchema,send(editing?'PUT':'POST',{...draft,...(editing?{expectedVersion:editing.version}:{})}));reset();setNotice('Saved '+saved.name+'.')})}}>
      <fieldset disabled={busy}><legend>{editing?'Edit template':'New template'}</legend>
        <label>Issue template name<input required maxLength={120} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
        <label>Issue template scope<select aria-label="Issue template scope" disabled={!!editing} value={draft.teamId??''} onChange={e=>setDraft({...draft,teamId:e.target.value||null,defaults:{...draft.defaults,statusId:undefined},subissues:draft.subissues.map(s=>({...s,statusId:undefined}))})}>{list.data?.workspaceAllowed&&<option value="">Workspace</option>}{list.data?.teams.filter(t=>t.canManage||t.id===draft.teamId).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <TemplateFields label="Issue defaults" value={draft.defaults} change={defaults=>setDraft({...draft,defaults})} teamId={draft.teamId} options={options.data!}/>
        {draft.subissues.map((child,index)=><fieldset key={index}><legend>Subissue {index+1}</legend><TemplateFields label={'Subissue '+(index+1)} value={child} change={value=>setDraft({...draft,subissues:draft.subissues.map((s,i)=>i===index?{...value,title:value.title??''}:s)})} teamId={draft.teamId} options={options.data!}/><button type="button" onClick={()=>setDraft({...draft,subissues:draft.subissues.filter((_,i)=>i!==index)})}>Remove subissue {index+1}</button></fieldset>)}
        <button type="button" disabled={draft.subissues.length>=50} onClick={()=>setDraft({...draft,subissues:[...draft.subissues,{title:''}]})}>Add subissue</button>
        <button type="submit">Save issue template</button><button type="button" onClick={reset}>Cancel template</button>
        {editing&&<><label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Confirm template deletion</label><button type="button" disabled={!confirm} onClick={()=>void act(async()=>{await fetchJson(url+'/'+editing.id,z.object({deleted:z.boolean()}),send('DELETE',{expectedVersion:editing.version}));reset();setNotice('Template deleted. Created issues are retained.')})}>Delete issue template</button></>}
      </fieldset>
    </form>}
  </section>
}
function TemplateFields({label,value,change,teamId,options}:{label:string;value:Defaults;change:(v:Defaults)=>void;teamId:string|null;options:z.infer<typeof workspaceOptionsSchema>}) {
  const edit=(patch:Partial<Defaults>)=>change({...value,...patch})
  return <div className="template-fields">
    <label>{label} title<input aria-label={label+' title'} maxLength={500} required={label.startsWith('Subissue')} value={value.title??''} onChange={e=>edit({title:e.target.value||undefined})}/></label>
    <label>{label} description<MentionTextarea aria-label={label+' description'} maxLength={100000} value={value.description??''} onValueChange={description=>edit({description})}/></label>
    <details><summary>{label} properties</summary>
      {teamId&&<label>{label} status<select aria-label={label+' status'} value={value.statusId??''} onChange={e=>edit({statusId:e.target.value||undefined})}><option value="">Default for selected team</option>{options.statuses.filter(s=>s.teamId===teamId&&!['intake','duplicate'].includes(s.category)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      <label>{label} priority<select aria-label={label+' priority'} value={value.priority??'none'} onChange={e=>edit({priority:e.target.value as Defaults['priority']})}>{['none','low','medium','high','urgent'].map(p=><option key={p} value={p}>{p}</option>)}</select></label>
      <label>{label} assignee<select aria-label={label+' assignee'} value={value.assigneeOperatorId??''} onChange={e=>edit({assigneeOperatorId:e.target.value||null})}><option value="">Unassigned</option>{options.operators.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label>{label} estimate<input aria-label={label+' estimate'} type="number" min={1} max={100} step={1} value={value.estimate??''} onChange={e=>edit({estimate:e.target.value?Number(e.target.value):null})}/></label>
      <label>{label} project<select aria-label={label+' project'} value={value.projectId??''} onChange={e=>edit({projectId:e.target.value||null})}><option value="">No project</option>{options.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <fieldset><legend>{label} labels</legend>{options.labels.map(l=><label key={l.id}><input type="checkbox" checked={value.labelIds?.includes(l.id)??false} onChange={e=>edit({labelIds:e.target.checked?[...(value.labelIds??[]),l.id]:(value.labelIds??[]).filter(id=>id!==l.id)})}/>{l.name}</label>)}</fieldset>
    </details>
  </div>
}

export function IssueTemplateChoice({values,setValues,onApplied,typed,onBusy}:{values:NewIssueDraft;setValues:React.Dispatch<React.SetStateAction<NewIssueDraft>>;onApplied:(t:IssueTemplate)=>void;typed:ReadonlySet<string>;onBusy:(busy:boolean)=>void}) {
  const list=useApiResource(url,templateListSchema,undefined,{abortPendingOnDispose:false}),[chosen,setChosen]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  return <section className="new-issue-section" aria-label="Issue template">
    <label>Issue template<select aria-label="Issue template" value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">No template</option>{list.data?.templates.filter(t=>!t.teamId||t.teamId===values.teamId).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <button type="button" disabled={!chosen||busy} onClick={async()=>{setBusy(true);onBusy(true);setError('');try{
      const t=await fetchJson(url+'/'+chosen,templateSchema)
      setValues(current=>{
        const result={...current},d=t.defaults
        for(const key of ['title','description','statusId','assigneeOperatorId','projectId'] as const)if(!typed.has(key)&&!current[key]&&d[key])result[key]=d[key]!
        if(!typed.has('priority')&&current.priority==='none'&&d.priority)result.priority=d.priority
        if(!typed.has('estimate')&&!current.estimate&&d.estimate)result.estimate=String(d.estimate)
        if(!typed.has('labelIds')&&!current.labelIds.length&&d.labelIds)result.labelIds=[...d.labelIds]
        return result
      });onApplied(t)
    }catch(e){setError(e instanceof Error?e.message:'Template is unavailable.')}finally{setBusy(false);onBusy(false)}}}>Apply template defaults</button>
    {(error||list.error)&&<p role="alert">{error||list.error?.message}</p>}
  </section>
}
