import { createIssueInputSchema } from '../issues/input'
import { createIssue } from '../issues/mutations'
import { creationError } from '../issues/create-guard'
import { isMutationAccessError } from '../auth/mutation-database'
import { planIssueRecord } from '../issues/repository'
import { getIssueDetail } from '../issues/service'
import { mutationDatabase } from '../auth/mutation-database'
import { guard, SettingsError } from '../administration/transaction'
import { reconcileParent } from '../subissues/reconcile'
import { createUlid } from '../../shared/ids'
import { readTemplate } from './repository'
import { applicationFence,templateVisibility } from './authority'
import { templateCreateSchema } from './schema'

/** Explicit fields win, including an explicit empty description, empty labels or null.
 * The browser applies defaults only to controls that are still empty. */
export async function createIssueFromRequest(db:D1Database,actor:string,raw:unknown,now=new Date(),onCommitted?:()=>Promise<unknown>) {
  if(!raw||typeof raw!=='object'||!('templateId' in raw))return createIssue(db,actor,createIssueInputSchema.parse(raw),now,onCommitted)
  const {templateId,templateVersion,...typed}=templateCreateSchema.parse(raw)
  const template=await readTemplate(db,actor,templateId)
  if(template.version!==templateVersion)throw new SettingsError('stale_template','Template changed. Choose it again before creating.',409)
  if(template.teamId&&template.teamId!==typed.teamId)throw new SettingsError('invalid_request','Choose the template’s team.',400)
  const fence=await applicationFence(db,actor,typed.teamId)
  db=mutationDatabase(db,actor)
  const inputs=[createIssueInputSchema.parse({...template.defaults,...typed}),...template.subissues.map(child=>createIssueInputSchema.parse({...child,teamId:typed.teamId}))]
  const plans=[]
  for(const input of inputs)plans.push(await planIssueRecord(db,{actorOperatorId:actor,input,now}))
  const writes=[guard(db,fence.sql,...fence.values),guard(db,`EXISTS(SELECT 1 FROM issue_templates t JOIN operators o ON o.workspace_id=t.workspace_id AND o.id=? AND o.removed_at IS NULL WHERE t.id=? AND t.version=? AND ${templateVisibility})`,actor,templateId,templateVersion),...plans.flatMap(plan=>plan.writes)]
  const at=now.toISOString(),parent=plans[0]
  for(const [position,child] of plans.slice(1).entries())writes.push(
    db.prepare('INSERT INTO issue_parents(issue_id,parent_issue_id,created_at,position) VALUES(?,?,?,?)').bind(child.issueId,parent.issueId,at,position+1),
    db.prepare("INSERT INTO issue_activity(id,issue_id,actor_operator_id,kind,next_value_json,created_at,updated_at) VALUES(?,?,?,'issue.parent_changed',?,?,?)").bind(createUlid(now),child.issueId,actor,JSON.stringify({parentIdentifier:parent.identifier}),at,at),
  )
  writes.push(db.prepare("INSERT INTO issue_activity(id,issue_id,actor_operator_id,kind,next_value_json,created_at,updated_at) VALUES(?,?,?,'issue.template_applied',?,?,?)").bind(createUlid(now),parent.issueId,actor,JSON.stringify({templateId,templateVersion}),at,at))
  if(plans.length>1)writes.push(reconcileParent(db,parent.issueId,at))
  try { await db.batch(writes) } catch(error) {
    if(isMutationAccessError(error))throw error
    const current=await readTemplate(db,actor,templateId)
    if(current.version!==templateVersion)throw new SettingsError('stale_template','Template changed. Choose it again before creating.',409)
    return creationError(db,typed.teamId,error)
  }
  const [issue]=await Promise.all([getIssueDetail(db,parent.identifier,now),onCommitted?.()])
  if(!issue)throw new Error('Created issue is unavailable.')
  return issue
}
