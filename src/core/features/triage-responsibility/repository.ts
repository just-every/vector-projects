import {rotationPeriod} from './calendar';
import type {RotationView} from './schema';
import {activeRecipient,visibleRecipient} from '../notifications/events';
import {settingsActor,SettingsError} from '../settings/repository';
import {administrationContext,ownedRow,commit,audit,guard} from '../administration/transaction';
import {localTimeToInstant} from '../administration/calendar';
import type {z} from 'zod';
import type {rotationInput} from './schema';
type Rotation={team_id:string;starts_local:string;revision:string;timezone:string};
export const eligible=`${activeRecipient} AND o.role IN('owner','admin','member') AND EXISTS(SELECT 1 FROM team_members member WHERE member.team_id=t.id AND member.operator_id=o.id)`;
export async function loadRotation(db:D1Database,teamId:string,now:Date){
 const row=await db.prepare(`SELECT r.*,w.timezone FROM team_triage_rotations r JOIN teams t ON t.id=r.team_id
  JOIN workspace_settings w ON w.id=t.workspace_id WHERE t.id=? AND t.archived_at IS NULL`).bind(teamId).first<Rotation>();
 if(!row)return null;
 const members=(await db.prepare('SELECT operator_id FROM team_triage_rotation_members WHERE team_id=? ORDER BY position').bind(teamId).all<{operator_id:string|null}>()).results.map(r=>r.operator_id);
 const period=members.length?rotationPeriod(row.starts_local,row.timezone,members.length,now):null;
 return {...row,members,period,recipient:period?members[period.position]:null};
}
export async function rotationProjection(db:D1Database,actor:string,teamId:string,now=new Date()):Promise<RotationView>{
 const person=await settingsActor(db,actor);
 const team=await db.prepare('SELECT id,name FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL').bind(teamId,person.workspace_id).first<{id:string;name:string}>();
 if(!team)throw new SettingsError('not_found','The team is unavailable.',404);
 const rotation=await loadRotation(db,teamId,now);
 const timezone=await db.prepare('SELECT timezone FROM workspace_settings WHERE id=?').bind(person.workspace_id).first<string>('timezone');
 const responsible=rotation?.recipient?await db.prepare(`SELECT o.id,o.name FROM operators o JOIN teams t ON t.workspace_id=o.workspace_id
  WHERE t.id=? AND o.id=? AND ${eligible}`).bind(teamId,rotation.recipient).first<{id:string;name:string}>():null;
 const untouched=(await db.prepare(`SELECT i.identifier,i.title FROM issues i JOIN workflow_statuses s ON s.id=i.status_id
  WHERE i.team_id=? AND s.category='intake' AND i.archived_at IS NULL AND i.deferred_until IS NULL
  AND NOT EXISTS(SELECT 1 FROM intake_decisions d WHERE d.issue_id=i.id) ORDER BY i.created_at,i.id`).bind(teamId).all<{identifier:string;title:string}>()).results;
 await settingsActor(db,actor);
 return {teamId,teamName:team.name,timezone:timezone!,startsLocal:rotation?.starts_local??null,operatorIds:rotation?.members??[],responsible,
  periodStartsAt:rotation?.period?.startsAt??null,nextHandoverAt:rotation?.period?.nextAt??null,untouched};
}
export async function triageProjection(db:D1Database,actor:string,now=new Date()){
 const person=await settingsActor(db,actor);
 const ids=(await db.prepare(`SELECT t.id FROM teams t JOIN team_triage_rotations r ON r.team_id=t.id WHERE t.workspace_id=? AND t.archived_at IS NULL ORDER BY t.name,t.id`).bind(person.workspace_id).all<{id:string}>()).results;
 const teams=await Promise.all(ids.map(row=>rotationProjection(db,actor,row.id,now)));
 return {teams,count:teams.filter(team=>team.responsible?.id===actor).reduce((n,team)=>n+team.untouched.length,0)};
}
export async function saveRotation(db:D1Database,actor:string,teamId:string,input:z.infer<typeof rotationInput>){
 const ctx=await administrationContext(db,actor),team=await ownedRow<{name:string;archived_at:string|null}>(ctx,'teams',teamId);
 if(team.archived_at)throw new SettingsError('team_archived','Unarchive this team first.',409);
 const timezone=(await db.prepare('SELECT timezone FROM workspace_settings WHERE id=?').bind(ctx.workspace).first<string>('timezone'))!;
 try{localTimeToInstant(input.startsLocal,timezone);}catch(error){throw new SettingsError('invalid_handover',(error as Error).message,400);}
 const previous=await loadRotation(db,teamId,new Date(ctx.at));
 const encoded=JSON.stringify(input.operatorIds);
 await commit(ctx,[
  guard(ctx.db,`(SELECT count(*) FROM operators o JOIN teams t ON t.workspace_id=o.workspace_id WHERE t.id=? AND o.id IN(SELECT value FROM json_each(?)) AND ${eligible})=?`,teamId,encoded,input.operatorIds.length),
  ctx.db.prepare(`INSERT INTO team_triage_rotations(team_id,starts_local,revision,updated_at) VALUES(?,?,?,?)
   ON CONFLICT(team_id) DO UPDATE SET starts_local=excluded.starts_local,revision=excluded.revision,updated_at=excluded.updated_at`).bind(teamId,input.startsLocal,crypto.randomUUID(),ctx.at),
  ctx.db.prepare('DELETE FROM team_triage_rotation_members WHERE team_id=?').bind(teamId),
  ...input.operatorIds.map((id,position)=>ctx.db.prepare('INSERT INTO team_triage_rotation_members(team_id,position,operator_id) VALUES(?,?,?)').bind(teamId,position,id)),
  ...audit(ctx,'team.triage_rotation.updated',teamId,team.name,previous?{startsLocal:previous.starts_local,operatorIds:previous.members}:null,input),
 ]);
}
/** Creation and its consumed receipt share the producer's transaction. A mute,
 * absent member or actor consumes this event too; later ticks cannot replay it. */
export async function triageCreationStatements(db:D1Database,event:{id:string;issueId:string;actor:string|null;actorName?:string|null;at:string},teamId:string){
 const rotation=await loadRotation(db,teamId,new Date(event.at));
 if(!rotation?.period)return [];
 const {period,recipient}=rotation;
 return [
  guard(db,`EXISTS(SELECT 1 FROM team_triage_rotations r JOIN teams t ON t.id=r.team_id JOIN workspace_settings w ON w.id=t.workspace_id WHERE r.team_id=? AND r.revision=? AND w.timezone=?)`,teamId,rotation.revision,rotation.timezone),
  db.prepare(`INSERT INTO triage_creation_receipts(issue_id,event_id,recipient_id,period_starts_at,created_at)
   SELECT i.id,?,?,?,? FROM issues i JOIN issue_activity a ON a.issue_id=i.id WHERE i.id=? AND a.id=? AND a.kind='issue.created'`).bind(event.id,recipient,period.startsAt,event.at,event.issueId,event.id),
  db.prepare(`INSERT OR IGNORE INTO notification_candidates(event_id,issue_id,recipient_id,kind,actor_id,actor_name,created_at)
   SELECT r.event_id,i.id,o.id,'triage',?,COALESCE((SELECT name FROM operators WHERE id=?),?),? FROM triage_creation_receipts r JOIN issues i ON i.id=r.issue_id
   JOIN teams t ON t.id=i.team_id JOIN operators o ON o.id=r.recipient_id AND o.workspace_id=t.workspace_id
   WHERE r.event_id=? AND ${eligible} AND ${visibleRecipient} AND (o.id<>? OR ? IS NULL)
   AND NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.event_id=r.event_id)
   AND NOT EXISTS(SELECT 1 FROM vector_restore_status WHERE effects_held=1)
   AND NOT EXISTS(SELECT 1 FROM rer_portability_state WHERE applying=1)`).bind(event.actor,event.actor,event.actorName??null,event.at,event.id,event.actor,event.actor),
 ];
}
