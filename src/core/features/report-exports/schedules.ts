import type { WorkerBindings } from '../../app/bindings';
import { createUlid } from '../../shared/ids';
import { auditStatement } from '../audit/producer';
import { guardedSql, ownerPredicate, type IntegrationOwner } from '../integrations/authority';
import { IntegrationError } from '../integrations/errors';
import { sealSecret } from '../integrations/secrets';
import { bucketEndpoint, type createSchedule, type changeSchedule } from './schedule-schema';
import { getView } from '../views/service';
import { visibleTeam } from '../roles/visibility-sql';
import type { z } from 'zod';

export const scheduleIdentity = (id:string) => 'report-export:'+id;
const allowed = (owner:IntegrationOwner) => ({sql:`(${ownerPredicate(owner).sql}) AND EXISTS(SELECT 1 FROM operators WHERE id=? AND workspace_id=? AND role IN('owner','admin') AND removed_at IS NULL)`,params:[...ownerPredicate(owner).params!,owner.id,owner.workspace]});

export async function listSchedules(env:WorkerBindings,owner:IntegrationOwner) {
  const result=await guardedSql(env.DB,allowed(owner)).batch([
    {sql:`SELECT id,name,kind,configuration,enabled,version,next_at AS nextAt,state,last_error AS lastError,
      NOT EXISTS(SELECT 1 FROM vector_integration_secret_keys k WHERE k.identity='report-export:'||vector_report_exports.id AND k.slot='current') AS requiresReentry
      FROM vector_report_exports WHERE workspace_id=? ORDER BY created_at,id`,params:[owner.workspace]},
    {sql:`SELECT r.id,r.export_id AS exportId,r.started_at AS startedAt,r.finished_at AS finishedAt,r.state,
      CASE WHEN NOT EXISTS(SELECT 1 FROM main.teams hidden JOIN main.operators reader ON reader.id=? AND reader.workspace_id=hidden.workspace_id WHERE hidden.workspace_id=? AND NOT (${visibleTeam('reader','hidden.id')})) THEN r.row_count ELSE NULL END AS rowCount,r.error
      FROM vector_report_export_runs r JOIN vector_report_exports e ON e.id=r.export_id WHERE e.workspace_id=? ORDER BY r.started_at DESC,r.id DESC LIMIT 100`,params:[owner.id,owner.workspace,owner.workspace]},
  ]);
  return {schedules:result[0].map(row=>({...row,configuration:JSON.parse(String(row.configuration)),enabled:Boolean(row.enabled),requiresReentry:Boolean(row.requiresReentry)})),runs:result[1]};
}
export async function createScheduledExport(env:WorkerBindings,owner:IntegrationOwner,input:z.output<typeof createSchedule>) {
  const now=new Date(),at=now.toISOString(),id=createUlid(now);
  const configuration=input.kind==='bucket'?{...input.configuration,endpoint:bucketEndpoint(input.configuration.endpoint)}:input.configuration;
  if(input.kind==='sheets') {
    try{await getView(env.DB,owner.id,input.configuration.viewId);}
    catch{throw new IntegrationError(404,'export_view_unavailable');}
  }
  const encrypted=await sealSecret(env,scheduleIdentity(id),JSON.stringify(input.credentials));
  await guardedSql(env.DB,allowed(owner)).batch([
    {sql:`SELECT CASE WHEN (SELECT count(*) FROM vector_report_exports WHERE workspace_id=?)<20 AND (? IS NULL OR EXISTS(SELECT 1 FROM teams WHERE id=? AND workspace_id=?)) THEN 1 ELSE json('export configuration refused') END`,params:[owner.workspace,'team' in configuration?configuration.team??null:null,'team' in configuration?configuration.team??null:null,owner.workspace]},
    {sql:`INSERT INTO vector_report_exports(id,workspace_id,owner_id,name,kind,configuration,enabled,next_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,params:[id,owner.workspace,owner.id,input.name,input.kind,JSON.stringify(configuration),Number(input.enabled),now.getTime(),at,at]},
    {sql:"INSERT INTO vector_integration_secret_keys(identity,slot,encrypted) VALUES(?,'current',?)",params:[scheduleIdentity(id),encrypted]},
    auditStatement({workspace:owner.workspace,actor:owner.id,action:'report.export_consented',subject:id,at}),
  ]);
  return {id};
}
export async function setScheduleEnabled(env:WorkerBindings,owner:IntegrationOwner,id:string,input:z.output<typeof changeSchedule>) {
  // Explicit re-admission takes custody as the current administrator. A running
  // request cannot be restarted: an interrupted run becomes visibly uncertain.
  const rows=await guardedSql(env.DB,allowed(owner)).batch([
    {sql:`UPDATE vector_report_exports SET enabled=?,owner_id=?,version=version+1,state='idle',last_error=NULL,next_at=?,updated_at=?
      WHERE id=? AND workspace_id=? AND version=? AND (state<>'running' OR ?=0) RETURNING id`,params:[Number(input.enabled),owner.id,Date.now(),new Date().toISOString(),id,owner.workspace,input.expectedVersion,Number(input.enabled)]},
    auditStatement({workspace:owner.workspace,actor:owner.id,action:'report.export_consent_changed',subject:id,condition:{sql:'changes()=1 AND EXISTS(SELECT 1 FROM vector_report_exports WHERE id=? AND workspace_id=? AND version=?)',params:[id,owner.workspace,input.expectedVersion+1]}}),
  ]);
  if(!rows[0].length)throw new IntegrationError(409,'export_version_changed');
  return {id,version:input.expectedVersion+1,enabled:input.enabled};
}
export async function revokeSchedule(env:WorkerBindings,owner:IntegrationOwner,id:string) {
  const at=new Date().toISOString();
  const rows=await guardedSql(env.DB,allowed(owner)).batch([
    {sql:"UPDATE vector_report_exports SET enabled=0,version=version+1,state='held',last_error='export_revoked',updated_at=? WHERE id=? AND workspace_id=? RETURNING id",params:[at,id,owner.workspace]},
    {sql:"DELETE FROM vector_integration_secret_keys WHERE identity=? AND EXISTS(SELECT 1 FROM vector_report_exports WHERE id=? AND workspace_id=?)",params:[scheduleIdentity(id),id,owner.workspace]},
    auditStatement({workspace:owner.workspace,actor:owner.id,action:'report.export_revoked',subject:id,at,condition:{sql:'EXISTS(SELECT 1 FROM vector_report_exports WHERE id=? AND workspace_id=?)',params:[id,owner.workspace]}}),
  ]);
  if(!rows[0].length)throw new IntegrationError(404,'export_unavailable');
  return {revoked:true};
}
