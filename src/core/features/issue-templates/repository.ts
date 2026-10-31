import { createUlid } from '../../shared/ids'
import { administrationContext,commit,guard,audit,SettingsError } from '../administration/transaction'
import { browseActor } from '../issues/browse-access'
import { managementFence,templateVisibility } from './authority'
import { templateInputSchema,type TemplateInput,type IssueTemplate } from './schema'

type Row={id:string;team_id:string|null;name:string;defaults_json:string;subissues_json:string;version:number}
export async function readTemplate(db:D1Database,actor:string,id:string):Promise<IssueTemplate> {
  await browseActor(db,actor)
  const row=await db.prepare(`SELECT t.* FROM issue_templates t JOIN operators o ON o.workspace_id=t.workspace_id AND o.id=? AND o.removed_at IS NULL WHERE t.id=? AND ${templateVisibility}`).bind(actor,id).first<Row>()
  if(!row)throw new SettingsError('not_found','Template is unavailable.',404)
  let canEdit=false
  try {await managementFence(db,actor,row.team_id);canEdit=true} catch(e) {if(!(e instanceof SettingsError))throw e}
  return {...templateInputSchema.parse({name:row.name,teamId:row.team_id,defaults:JSON.parse(row.defaults_json),subissues:JSON.parse(row.subissues_json)}),id:row.id,version:row.version,canEdit}
}
export async function listTemplates(db:D1Database,actor:string) {
  const a=await browseActor(db,actor)
  const rows=(await db.prepare(`SELECT t.id FROM issue_templates t JOIN operators o ON o.workspace_id=t.workspace_id AND o.id=? AND o.removed_at IS NULL WHERE ${templateVisibility} ORDER BY t.name,t.id`).bind(actor).all<{id:string}>()).results
  const teams=(await db.prepare('SELECT id,name FROM teams WHERE workspace_id=? AND archived_at IS NULL ORDER BY name,id').bind(a.workspace_id).all<{id:string;name:string}>()).results
  return {templates:await Promise.all(rows.map(r=>readTemplate(db,actor,r.id))),teams:await Promise.all(teams.map(async t=>{let canManage=false;try{await managementFence(db,actor,t.id);canManage=true}catch(e){if(!(e instanceof SettingsError))throw e}return {...t,canManage}})),workspaceAllowed:['owner','admin'].includes(a.role)}
}
export async function saveTemplate(db:D1Database,actor:string,input:TemplateInput,id?:string,version?:number) {
  const old=id?await readTemplate(db,actor,id):null
  if(old&&old.teamId!==input.teamId)throw new SettingsError('invalid_request','Save a new template to change its scope.',400)
  const fence=await managementFence(db,actor,input.teamId),ctx=await administrationContext(db,actor)
  id??=createUlid(new Date(ctx.at))
  const writes=[guard(ctx.db,fence.sql,...fence.values)]
  if(old)writes.push(guard(ctx.db,'EXISTS(SELECT 1 FROM issue_templates WHERE id=? AND version=?)',id,version!),ctx.db.prepare('UPDATE issue_templates SET name=?,defaults_json=?,subissues_json=?,version=version+1,updated_at=? WHERE id=?').bind(input.name,JSON.stringify(input.defaults),JSON.stringify(input.subissues),ctx.at,id))
  else writes.push(ctx.db.prepare('INSERT INTO issue_templates(id,workspace_id,team_id,name,defaults_json,subissues_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,ctx.workspace,input.teamId,input.name,JSON.stringify(input.defaults),JSON.stringify(input.subissues),ctx.at,ctx.at))
  writes.push(...audit(ctx,old?'issue_template.updated':'issue_template.created',id,input.name,old?{version:old.version}:null,{version:old?old.version+1:1}))
  await commit(ctx,writes)
  return readTemplate(db,actor,id)
}
export async function deleteTemplate(db:D1Database,actor:string,id:string,version:number) {
  const old=await readTemplate(db,actor,id),fence=await managementFence(db,actor,old.teamId),ctx=await administrationContext(db,actor)
  await commit(ctx,[guard(ctx.db,fence.sql,...fence.values),guard(ctx.db,'EXISTS(SELECT 1 FROM issue_templates WHERE id=? AND version=?)',id,version),ctx.db.prepare('DELETE FROM issue_templates WHERE id=?').bind(id),...audit(ctx,'issue_template.deleted',id,old.name,{version},null)])
  return {deleted:true}
}
