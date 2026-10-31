import { SettingsError } from '../settings/repository'
import { guard } from '../administration/transaction'
import type { TemplateInput } from './schema'

/** Validate references without resolving private titles. Recheck the same conditions
 * in the template write so a management request never grants property authority. */
export async function propertyGuards(db:D1Database,input:TemplateInput,workspace:string) {
  const guards:D1PreparedStatement[]=[]
  for(const defaults of [input.defaults,...input.subissues]) {
    const conditions:string[]=[],values:(string|number|null)[]=[]
    if(defaults.statusId) {
      conditions.push(`EXISTS(SELECT 1 FROM workflow_statuses s JOIN teams t ON t.id=s.team_id WHERE s.id=? AND t.workspace_id=? AND (? IS NULL OR s.team_id=?) AND s.category NOT IN ('intake','duplicate'))`)
      values.push(defaults.statusId,workspace,input.teamId,input.teamId)
    }
    if(defaults.projectId){conditions.push('EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL)');values.push(defaults.projectId,workspace)}
    if(defaults.assigneeOperatorId){conditions.push('EXISTS(SELECT 1 FROM operators WHERE id=? AND workspace_id=? AND removed_at IS NULL)');values.push(defaults.assigneeOperatorId,workspace)}
    for(const id of defaults.labelIds??[]){conditions.push('EXISTS(SELECT 1 FROM labels WHERE id=? AND workspace_id=?)');values.push(id,workspace)}
    if(conditions.length) {
      const condition=conditions.join(' AND ')
      if(!await db.prepare('SELECT ('+condition+') available').bind(...values).first<number>('available'))throw new SettingsError('invalid_request','A template property is unavailable. Choose current properties you can access.',400)
      guards.push(guard(db,condition,...values))
    }
  }
  return guards
}
