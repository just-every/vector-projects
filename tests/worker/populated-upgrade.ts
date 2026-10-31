import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {expect,inject} from 'vitest';
import {insertHistoricalSample} from './historical-sample-fixture';
import {baseAuth} from '../../src/core/features/auth/base.server';
import {sampleBindings} from './sample-auth-fixture';
import {mailToken,request} from './base-auth-fixture';
import {createVectorArchive} from '../../src/core/features/data/archive-service.mjs';
/** With `schema`, every earlier table, index, trigger and view keeps its exact SQL
 * except the named objects the migrations add, remove or change; `populated`
 * names tables that must hold rows before the upgrade. */
/** Base operator-auth reads these ledgers on every sign-in, so its README has a
 * store apply them before switching to this runtime. 0030 has its own proof;
 * 0038-0042 are proved with `signIn: 'after'`. */
export const authRuntimeMigrations=['0030_dev_sessions.sql','0038_identity_providers.sql','0039_domain_rules_step_up.sql','0040_provider_control.sql','0041_provider_pins.sql','0042_dependency_setup.sql'];
export async function applyAuthRuntimeMigrations(db:D1Database) {
 await applyD1Migrations(db,inject('migrations').filter(row=>authRuntimeMigrations.includes(row.name)));
}
/** `signIn: 'after'` proves the migrations sign-in itself needs: the store holds
 * sessions and a token written at the prior schema, and the owner signs in only
 * once the upgrade is applied. */
export async function provePopulatedUpgrade(boundaryName:string,schema?:{added:string[];removed:string[];changed?:string[];until?:string;preserveAfter?:string;signIn?:'after'},populated:string[]=[],populate?:(cookie:string)=>Promise<void>) {
 const migrations=inject('migrations'),boundary=migrations.findIndex(row=>row.name===boundaryName);
 await applyD1Migrations(env.DB,migrations.slice(0,2));
 await insertHistoricalSample(env.DB,new Date('2026-10-01T00:00:00Z'));
 await applyD1Migrations(env.DB,migrations.slice(2,boundary));
 // Base's sign-in reads the dev-session and identity ledgers, so the populated store signs in only once those migrations are in place.
 if(schema?.signIn!=='after')await applyAuthRuntimeMigrations(env.DB);
 const issue=(await env.DB.prepare('SELECT id FROM issues LIMIT 1').first<{id:string}>())!,owner=(await env.DB.prepare('SELECT id FROM operators WHERE lower(email)=?').bind(sampleBindings.FIRST_OWNER_EMAIL).first<{id:string}>())!;
 await env.DB.batch([
  env.DB.prepare('INSERT INTO issue_comments(id,issue_id,actor_operator_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('01K00000000000000000000011',issue.id,owner.id,'Populated upgrade comment','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z'),
  env.DB.prepare('INSERT INTO issue_files(id,issue_id,actor_operator_id,name,content_type,bytes,blob_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('01K00000000000000000000012',issue.id,owner.id,'before.txt','text/plain',3,'upgrade-file','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z'),
 ]);
 await env.FILES.put('upgrade-file','old');
 if(schema?.signIn==='after')await env.DB.batch([
  env.DB.prepare("INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,return_to,created_at,expires_at) SELECT 'upgrade-link','upgrade-link-hash','magic',a.id,a.version,'/app',1,4000000000000 FROM vector_auth_operators m JOIN oa_operators a ON a.id=m.auth_id WHERE m.operator_id=?").bind(owner.id),
  env.DB.prepare("INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,source_token_id,created_at,expires_at) SELECT 'upgrade-session','upgrade-session-hash',a.id,a.version,'native','upgrade-link',1,4000000000000 FROM vector_auth_operators m JOIN oa_operators a ON a.id=m.auth_id WHERE m.operator_id=?").bind(owner.id),
  env.DB.prepare("INSERT INTO integration_tokens(namespace,id,token_hash,name,scopes,created_at) SELECT 'vector:'||workspace_id||':'||id,'upgrade-token','upgrade-token-hash','Upgrade token','[\"issues:read\"]',1 FROM operators WHERE id=?").bind(owner.id),
 ]);
 const signIn=async()=>{
 await baseAuth(sampleBindings).requestMagicLink(new Request(sampleBindings.APP_ORIGIN+'/auth/magic-link',{method:'POST',headers:{host:new URL(sampleBindings.APP_ORIGIN).host,Origin:sampleBindings.APP_ORIGIN}}),{email:sampleBindings.FIRST_OWNER_EMAIL,returnTo:'/app'});
 const confirmed=await baseAuth(sampleBindings).confirmLink(new Request(sampleBindings.APP_ORIGIN+'/auth/confirm',{method:'POST',headers:{host:new URL(sampleBindings.APP_ORIGIN).host,Origin:sampleBindings.APP_ORIGIN}}),{token:await mailToken(sampleBindings.FIRST_OWNER_EMAIL)});
 return confirmed.cookie.split(';')[0];
 };
 let cookie=schema?.signIn==='after'?'':await signIn();
 if(cookie)await populate?.(cookie);
 const tables=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations' ORDER BY name").all<{name:string}>()).results;
 const selectedColumns=new Map<string,string>();
 const read=async(name:string)=>{
  const columns=selectedColumns.get(name)??(await env.DB.prepare('PRAGMA table_info("'+name+'")').all<{name:string}>()).results.map(row=>'"'+row.name+'"').join(',');
  selectedColumns.set(name,columns);
  return (await env.DB.prepare('SELECT '+columns+' FROM "'+name+'" ORDER BY '+columns).all()).results;
 };
 const before=await Promise.all(tables.map(async({name})=>({name,rows:await read(name)})));
 expect(before.find(row=>row.name==='issues')!.rows.length).toBeGreaterThan(0);
 expect(before.find(row=>row.name==='oa_sessions')!.rows.length).toBeGreaterThan(0);
 for(const name of populated)expect(before.find(row=>row.name===name)!.rows.length,name).toBeGreaterThan(0);
 const objects=async()=>new Map((await env.DB.prepare("SELECT type||' '||name AS id,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations'").all<{id:string;sql:string|null}>()).results.map(row=>[row.id,row.sql]));
 const schemaBefore=await objects();
 const until=schema?.until?migrations.findIndex(row=>row.name===schema.until)+1:migrations.length;
 await applyD1Migrations(env.DB,migrations.slice(boundary,until));
 if(schema) {
  const schemaAfter=await objects();
  expect([...schemaAfter.keys()].filter(id=>!schemaBefore.has(id)).sort()).toEqual([...schema.added].sort());
  expect([...schemaBefore.keys()].filter(id=>!schemaAfter.has(id)).sort()).toEqual([...schema.removed].sort());
  for(const [id,sql] of schemaBefore)if(schemaAfter.has(id)&&!schema.changed?.includes(id))expect(schemaAfter.get(id),id).toBe(sql);
  for(const id of schema.changed??[])expect(schemaAfter.get(id),id).not.toBe(schemaBefore.get(id));
 }
 // The same populated installation also crosses the selected previous head.
 // Freeze every column present there before applying the candidate's additions.
 const checkpoint=schema?.preserveAfter?migrations.findIndex(row=>row.name===schema.preserveAfter)+1:until;
 expect(checkpoint).toBeGreaterThanOrEqual(until);
 await applyD1Migrations(env.DB,migrations.slice(until,checkpoint));
 const retained=[] as Array<{name:string;columns:string;rows:unknown[]}>;
 if(schema?.preserveAfter) {
  const current=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations' ORDER BY name").all<{name:string}>()).results;
  for(const {name} of current) {
   const columns=(await env.DB.prepare('PRAGMA table_info("'+name+'")').all<{name:string}>()).results.map(row=>'"'+row.name+'"').join(',');
   const rows=(await env.DB.prepare('SELECT '+columns+' FROM "'+name+'" ORDER BY '+columns).all()).results;
   retained.push({name,columns,rows});
  }
 }
 await applyD1Migrations(env.DB,migrations.slice(checkpoint));
 for(const row of retained)expect((await env.DB.prepare('SELECT '+row.columns+' FROM "'+row.name+'" ORDER BY '+row.columns).all()).results,row.name+' retained from '+schema!.preserveAfter).toEqual(row.rows);
 for(const row of before)expect(await read(row.name),row.name).toEqual(row.rows);
 expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
 if(!cookie)cookie=await signIn();
 expect((await request('/api/session','GET',undefined,cookie,sampleBindings)).status).toBe(200);
 expect((await request('/api/search?q=Flow','GET',undefined,cookie,sampleBindings)).status).toBe(200);
 expect((await env.DB.prepare('SELECT count(*) AS n FROM vector_restore_status').first())?.n).toBe(0);
 const archive=await createVectorArchive({db:env.DB,files:env.FILES}),id=await archive.exports.create();
 while((await archive.exports.advance(id,{maxParts:16})).phase==='building'){}
 expect((await archive.exports.status(id)).phase).toBe('complete');await archive.exports.abort(id);
 expect(await (await env.FILES.get('upgrade-file'))!.text()).toBe('old');
 return {cookie};
}
