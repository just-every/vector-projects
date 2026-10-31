import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {expect,inject} from 'vitest';
import {insertHistoricalSample} from './historical-sample-fixture';
import {createVectorArchive} from '../../src/core/features/data/archive-service.mjs';

/** Cross the actual 0095 head with populated roles, grants, children and native credentials. */
export async function proveViewerRoleUpgrade(){
 const db=env.ARCHIVE_TARGET_DB,migrations=inject('migrations'),boundary=migrations.findIndex(m=>m.name==='0096_private_teams.sql');
 await applyD1Migrations(db,migrations.slice(0,boundary));
 await insertHistoricalSample(db,new Date('2026-10-01T00:00:00Z'));
 const workspace=(await db.prepare('SELECT id FROM workspace_settings').first<{id:string}>())!.id;
 const team=(await db.prepare('SELECT id FROM teams LIMIT 1').first<{id:string}>())!.id;
 for(const [index,role] of ['owner','admin','member','guest'].entries())await db.prepare('INSERT INTO operators(id,workspace_id,name,email,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
  .bind('synthetic-vector-'+(1710+index),workspace,'synthetic-vector-'+(1710+index),'synthetic-vector-'+(1710+index)+'@vector.test',role,'2026-10-01','2026-10-01').run();
 const owner='synthetic-vector-1710',guest='synthetic-vector-1713';
 await db.prepare("INSERT INTO team_members(team_id,operator_id,role,created_at,updated_at) VALUES(?,?,'member','2026-10-01','2026-10-01')").bind(team,guest).run();
 const native=(await db.prepare('SELECT auth_id id FROM vector_auth_operators WHERE operator_id=?').bind(owner).first<{id:string}>())!.id;
 await db.batch([
  db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES('synthetic-vector-1740','synthetic-vector-1740@vector.test','synthetic-vector-1740','owner','invited',1,1)"),
  db.prepare("INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,issuer_id,issuer_version,return_to,created_at,expires_at) VALUES('synthetic-vector-1714','synthetic-vector-1715','invite',?,1,?,1,'/app',1,4000000000000)").bind('synthetic-vector-1740',native),
  db.prepare("INSERT INTO vector_invitation_roles(token_id,role,inviter_operator_id,created_at,team_ids_json) VALUES('synthetic-vector-1714','guest',?,'2026-10-01',?)").bind(owner,JSON.stringify([team])),
  db.prepare("INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,return_to,created_at,expires_at) VALUES('synthetic-vector-1716','synthetic-vector-1717','magic',?,1,'/app',1,4000000000000)").bind(native),
  db.prepare("INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,source_token_id,created_at,expires_at) VALUES('synthetic-vector-1718','synthetic-vector-1719',?,1,'native','synthetic-vector-1716',1,4000000000000)").bind(native),
 ]);
 const retained=[] as {name:string;columns:string;rows:unknown[]}[];
 for(const {name} of (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name").all<{name:string}>()).results){
  const columns=(await db.prepare('PRAGMA table_info("'+name+'")').all<{name:string}>()).results.map(c=>'"'+c.name+'"').join(',');
  retained.push({name,columns,rows:(await db.prepare('SELECT '+columns+' FROM "'+name+'" ORDER BY '+columns).all()).results});
 }
 const reportBoundary=migrations.findIndex(m=>m.name==='0123_report_export_schedules.sql');
 await applyD1Migrations(db,migrations.slice(boundary,reportBoundary));
 const previousHead=[] as {name:string;columns:string;rows:unknown[]}[];
 for(const {name} of (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name").all<{name:string}>()).results) {
  const columns=(await db.prepare('PRAGMA table_info("'+name+'")').all<{name:string}>()).results.map(c=>'"'+c.name+'"').join(',');
  previousHead.push({name,columns,rows:(await db.prepare('SELECT '+columns+' FROM "'+name+'" ORDER BY '+columns).all()).results});
 }
 await applyD1Migrations(db,migrations.slice(reportBoundary));
 for(const row of previousHead)expect((await db.prepare('SELECT '+row.columns+' FROM "'+row.name+'" ORDER BY '+row.columns).all()).results,row.name+' retained across report schedules').toEqual(row.rows);
 for(const row of retained)expect((await db.prepare('SELECT '+row.columns+' FROM "'+row.name+'" ORDER BY '+row.columns).all()).results,row.name+' retained at 0095').toEqual(row.rows);
 expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
 await db.prepare("UPDATE operators SET role='viewer' WHERE id='synthetic-vector-1712'").run();
 expect(await db.prepare("SELECT role FROM operators WHERE id='synthetic-vector-1712'").first('role')).toBe('viewer');
 await db.prepare("UPDATE vector_invitation_roles SET role='viewer' WHERE token_id='synthetic-vector-1714'").run();
 expect(await db.prepare("SELECT role FROM vector_invitation_roles WHERE token_id='synthetic-vector-1714'").first('role')).toBe('viewer');
 const archive=await createVectorArchive({db,files:env.ARCHIVE_TARGET_FILES}),id=await archive.exports.create();
 while((await archive.exports.advance(id,{maxParts:16})).phase==='building'){}
 expect((await archive.exports.status(id)).phase).toBe('complete');await archive.exports.abort(id);
}
