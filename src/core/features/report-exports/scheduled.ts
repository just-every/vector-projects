import type { WorkerBindings } from '../../app/bindings';
import { createUlid } from '../../shared/ids';
import { restoredEffectsHeld } from '../data/restore-authority';
import { IntegrationError } from '../integrations/errors';
import { openSecret } from '../integrations/secrets';
import { exportScope } from './cursor';
import { bucketConfiguration, bucketCredentials, sheetsConfiguration, sheetsCredentials } from './schedule-schema';
import { sheetSnapshot, refreshSheetsToken, putSheet } from './sheets';
import { putBucket } from './bucket';
import { scheduleIdentity } from './schedules';
import { encodeBucketRows, exportSnapshot } from './snapshot';

type Schedule={id:string;workspace_id:string;owner_id:string;configuration:string;version:number;claim:string;kind:string;last_rows:number;last_columns:number};
type Result={count:number;checkpoints:{resource:string;id:string;digest:string}[];rows?:number;columns?:number};
const activeOwner=`EXISTS(SELECT 1 FROM operators o JOIN vector_auth_operators m ON m.operator_id=o.id JOIN oa_operators a ON a.id=m.auth_id
  WHERE o.id=vector_report_exports.owner_id AND o.workspace_id=vector_report_exports.workspace_id AND o.removed_at IS NULL AND o.role IN('owner','admin') AND a.status='active')`;
const live=`enabled=1 AND ${activeOwner} AND NOT EXISTS(SELECT 1 FROM vector_restore_status WHERE effects_held=1)`;
async function assertCurrent(env:WorkerBindings,row:Schedule) {
  if(!await env.DB.prepare(`SELECT 1 FROM vector_report_exports WHERE id=? AND version=? AND claim=? AND state='running' AND ${live}`)
    .bind(row.id,row.version,row.claim).first())throw new IntegrationError(403,'export_authority_changed');
}

async function exportBucket(env:WorkerBindings,row:Schedule,now:Date):Promise<Result> {
  const config=bucketConfiguration.parse(JSON.parse(row.configuration));
  const encrypted=await env.DB.prepare("SELECT encrypted FROM vector_integration_secret_keys WHERE identity=? AND slot='current'").bind(scheduleIdentity(row.id)).first<string>('encrypted');
  if(!encrypted)throw new IntegrationError(409,'export_credentials_required');
  const credentials=bucketCredentials.parse(JSON.parse(await openSecret(env,scheduleIdentity(row.id),encrypted)));
  const snapshot=await exportSnapshot(env,row.owner_id,config.team);
  const old=(await env.DB.prepare('SELECT resource,row_id,digest FROM vector_report_export_rows WHERE export_id=? ORDER BY resource,row_id').bind(row.id).all<{resource:string;row_id:string;digest:string}>()).results;
  const previous=new Map(old.map(record=>[record.resource+':'+record.row_id,record.digest]));
  const current=new Set(snapshot.map(record=>record.resource+':'+record.id));
  const changes=[...snapshot.filter(record=>previous.get(record.resource+':'+record.id)!==record.digest).map(record=>({resource:record.resource,id:record.id,operation:'upsert',row:record.row as unknown})),
    ...old.filter(record=>!current.has(record.resource+':'+record.row_id)).map(record=>({resource:record.resource,id:record.row_id,operation:'delete',row:null as unknown}))];
  const body=encodeBucketRows(config.format,changes);
  if(new TextEncoder().encode(body).byteLength>1024*1024)throw new IntegrationError(409,'export_capacity_exceeded');
  // Never replay a stored payload. Rebuild current data on every run and check
  // it immediately before dispatch so removal and privacy changes stop it.
  if(await exportScope(snapshot)!==await exportScope(await exportSnapshot(env,row.owner_id,config.team)))throw new IntegrationError(409,'export_data_changed');
  await assertCurrent(env,row);
  await putBucket(config,credentials,config.prefix+'/'+row.id+'/'+row.claim+'.'+config.format,body,now);
  return {count:changes.length,checkpoints:snapshot.map(({resource,id,digest})=>({resource,id,digest}))};
}

async function exportSheet(env:WorkerBindings,row:Schedule,now:Date):Promise<Result> {
  const config=sheetsConfiguration.parse(JSON.parse(row.configuration));
  const encrypted=await env.DB.prepare("SELECT encrypted FROM vector_integration_secret_keys WHERE identity=? AND slot='current'").bind(scheduleIdentity(row.id)).first<string>('encrypted');
  if(!encrypted)throw new IntegrationError(409,'export_credentials_required');
  const credentials=sheetsCredentials.parse(JSON.parse(await openSecret(env,scheduleIdentity(row.id),encrypted)));
  const snapshot=await sheetSnapshot(env,row.owner_id,config.viewId,now);
  await assertCurrent(env,row);
  const token=await refreshSheetsToken(credentials);
  if(await exportScope(snapshot)!==await exportScope(await sheetSnapshot(env,row.owner_id,config.viewId,now)))throw new IntegrationError(409,'export_data_changed');
  await assertCurrent(env,row);
  await putSheet(config,token,snapshot.values,row.last_rows,row.last_columns);
  return {count:snapshot.values.length-1,checkpoints:[],rows:snapshot.values.length,columns:snapshot.values[0].length};
}

/** The ordinary Worker cron owns hourly schedules. Atomic claims serialize
 * concurrent ticks; interrupted transport is held, never automatically replayed. */
export async function runReportExports(env:WorkerBindings,now:Date) {
  if(await restoredEffectsHeld(env.DB))return;
  const at=now.toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE vector_report_export_runs SET state='uncertain',finished_at=?,error='export_interrupted'
      WHERE state='running' AND started_at<?`).bind(at,new Date(now.getTime()-20*60000).toISOString()),
    env.DB.prepare(`UPDATE vector_report_exports SET state='uncertain',last_error='export_interrupted',updated_at=?
      WHERE state='running' AND updated_at<?`).bind(at,new Date(now.getTime()-20*60000).toISOString()),
  ]);
  // A withdrawn sponsor is a visible hold, rather than a silently overdue job.
  const withdrawn=(await env.DB.prepare(`SELECT id FROM vector_report_exports WHERE enabled=1 AND state IN('idle','failed') AND next_at<=? AND NOT (${activeOwner}) LIMIT 20`).bind(now.getTime()).all<{id:string}>()).results;
  for(const {id} of withdrawn) {
    const run=createUlid(now);
    await env.DB.batch([
      env.DB.prepare(`UPDATE vector_report_exports SET state='held',last_error='export_authority_changed',updated_at=? WHERE id=? AND state IN('idle','failed') AND NOT (${activeOwner})`).bind(at,id),
      env.DB.prepare(`INSERT INTO vector_report_export_runs(id,export_id,started_at,finished_at,state,error)
        SELECT ?,id,?,?,'held','export_authority_changed' FROM vector_report_exports WHERE id=? AND state='held' AND last_error='export_authority_changed' AND updated_at=? AND changes()=1`).bind(run,at,at,id,at),
    ]);
  }
  const due=(await env.DB.prepare(`SELECT id FROM vector_report_exports WHERE enabled=1 AND state IN('idle','failed') AND next_at<=? ORDER BY next_at,id LIMIT 5`).bind(now.getTime()).all<{id:string}>()).results;
  for(const {id} of due) {
    const run=createUlid(now);
    const result=await env.DB.batch([
      env.DB.prepare(`UPDATE vector_report_exports SET state='running',claim=?,updated_at=?,last_error=NULL
        WHERE id=? AND next_at<=? AND state IN('idle','failed') AND ${live} RETURNING *`).bind(run,at,id,now.getTime()),
      env.DB.prepare(`INSERT INTO vector_report_export_runs(id,export_id,started_at,state)
        SELECT ?,id,?,'running' FROM vector_report_exports WHERE id=? AND claim=? AND state='running'`).bind(run,at,id,run),
    ]);
    const row=result[0].results[0] as Schedule|undefined;
    if(!row)continue;
    try {
      const exported=row.kind==='bucket'?await exportBucket(env,row,now):await exportSheet(env,row,now);
      const guard=env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM vector_report_exports WHERE id=? AND claim=? AND version=? AND ${live}) THEN 1 ELSE json('export authority changed') END`).bind(id,run,row.version);
      await env.DB.batch([
        guard,
        env.DB.prepare('DELETE FROM vector_report_export_rows WHERE export_id=?').bind(id),
        env.DB.prepare(`INSERT INTO vector_report_export_rows(export_id,resource,row_id,digest)
          SELECT ?,json_extract(value,'$.resource'),json_extract(value,'$.id'),json_extract(value,'$.digest') FROM json_each(?)`).bind(id,JSON.stringify(exported.checkpoints)),
        env.DB.prepare("UPDATE vector_report_export_runs SET state='succeeded',finished_at=?,row_count=? WHERE id=? AND state='running'").bind(at,exported.count,run),
        env.DB.prepare("UPDATE vector_report_exports SET state='idle',claim=NULL,last_rows=?,last_columns=?,next_at=?,updated_at=? WHERE id=? AND claim=?").bind(exported.rows??0,exported.columns??0,now.getTime()+3600000,at,id,run),
      ]);
    } catch(error) {
      const code=error instanceof IntegrationError?error.code:'export_interrupted';
      const state=code==='export_transport_uncertain'||code==='export_interrupted'?'uncertain':code.includes('authority')||code.includes('credentials')?'held':'failed';
      await env.DB.batch([
        env.DB.prepare('UPDATE vector_report_export_runs SET state=?,finished_at=?,error=? WHERE id=? AND state=\'running\'').bind(state,at,code,run),
        env.DB.prepare('UPDATE vector_report_exports SET state=?,last_error=?,next_at=?,updated_at=? WHERE id=? AND claim=? AND version=?').bind(state,code,now.getTime()+3600000,at,id,run,row.version),
      ]);
    }
  }
}
