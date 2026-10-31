import { loadAuthority, authorityFence } from '../roles/authority'
import { decide, decisionInputs, type Question } from '../roles/policy'
import { SettingsError } from '../settings/repository'
import { browseActor } from '../issues/browse-access'

export async function managementFence(db:D1Database,actor:string,teamId:string|null) {
  const authority=await loadAuthority(db,actor,teamId?[teamId]:[])
  const question:Question=teamId?{row:'issue-templates.team',teams:[teamId]}:{row:'issue-templates.workspace'}
  if(!authority||decide(authority,question)!=='allow')throw new SettingsError('forbidden','Your current role cannot manage this template.',403)
  if(teamId&&!await db.prepare('SELECT id FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL').bind(teamId,authority.workspace!).first())throw new SettingsError('not_found','Team is unavailable.',404)
  return authorityFence(actor,authority,decisionInputs(authority,question))
}
export async function applicationFence(db:D1Database,actor:string,teamId:string) {
  const authority=await loadAuthority(db,actor,[teamId]),question:Question={row:'issues.write',teams:[teamId]}
  if(!authority||decide(authority,question)!=='allow')throw new SettingsError('forbidden','Your current role cannot create this issue.',403)
  const a=await browseActor(db,actor)
  if(!JSON.parse(a.teamScope).includes(teamId))throw new SettingsError('not_found','Team is unavailable.',404)
  return authorityFence(actor,authority,decisionInputs(authority,question))
}
// Team-scoped content follows current team visibility. Guests never read workspace templates.
export const templateVisibility = `((t.team_id IS NULL AND o.role<>'guest') OR (t.team_id IS NOT NULL AND EXISTS(SELECT 1 FROM teams available WHERE available.id=t.team_id)))`
