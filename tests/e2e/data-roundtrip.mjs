import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm,stat,copyFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {populateIntegrationHistory,verifyIntegrationCategories,verifyRestoredIntegrations} from './data-integration-history.mjs';
import {dataInstallation} from './data-installation.mjs';
import {assertArchiveHistory} from './archive-audit-history.mjs';
import {populateRoundtrip,verifyRoundtripCategories} from './data-roundtrip-fixture.mjs';
import {readArchive} from '@runeditrun/rer/modules/portability';
import {chromium,expect} from '@playwright/test';
import {openAuthenticatedPage} from './ui-runtime-auth.mjs';
import {createRestoreReviewPerson,restoreAccessJourney} from './restore-ui-journey.mjs';
const work=await mkdtemp(join(tmpdir(),'vector-roundtrip-')),evidence=resolve(process.env.RESTORE_EVIDENCE_DIR??'evidence/data');let source,destination,browser;
const proof={passed:false,independentInstallations:true,commands:[],categories:[],rows:0,objects:0,equality:false,heldAfterCron:false,privateViews:false};
const records=async path=>{const result=[];for await(const row of readArchive(new Response(await readFile(path)).body))result.push(row);return result;};
try{
 await mkdir(evidence,{recursive:true});source=await dataInstallation(work,'source');destination=await dataInstallation(work,'destination');await source.configure(true);
 await unlink(join(source.root,'node_modules'));await source.installDependencies();await source.start();const cookie=await source.signIn();
 browser=await chromium.launch({headless:true,args:["--use-mock-keychain","--password-store=basic"]});const ordinary=await openAuthenticatedPage(browser,cookie,source.origin);
 await ordinary.goto(source.origin+'/app/settings/restore');const ordinaryLine=ordinary.getByText('No restore is waiting for review.');
 // On an installation that was never restored the page is one quiet line, and Restore is not in the section list.
 await expect(ordinaryLine).toBeVisible();await expect(ordinary.getByRole('region',{name:'After a restore'})).toHaveCount(0);await expect(ordinary.getByRole('button',{name:/Allow .* to sign in|Turn on future effects/})).toHaveCount(0);
 await ordinary.goto(source.origin+'/app/settings');await expect(ordinary.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:/^Restore( |$)/})).toHaveCount(0);
 for(const width of [1440,390]){await ordinary.setViewportSize({width,height:1000});await ordinary.screenshot({path:join(evidence,'settings-ordinary-'+width+'.png')});}
 await ordinary.context().close();
 const fixture=await populateRoundtrip(source,cookie),reviewPerson=await createRestoreReviewPerson(source,cookie);const integrations=await populateIntegrationHistory(source,cookie,fixture.identifier);const oauth=await seedOAuthArchive(source,cookie);await source.stop();
 // rer keeps archives in the unserved exports/ folder.
 const first=join(source.root,'exports/first.jsonl'),repeat=join(source.root,'exports/repeat.jsonl'),input=join(destination.root,'input.jsonl'),second=join(destination.root,'exports/second.jsonl');
 await source.run('Export source archive',['export','--','--target','local','--output','exports/first.jsonl','--non-interactive']);proof.commands.push('pnpm run export -- --target local');
 assert.equal((await stat(first)).mode&0o777,0o600);await source.run('Repeat export without changing product',['export','--','--target','local','--output','exports/repeat.jsonl','--non-interactive']);const repeated=await records(repeat),original=await records(first);assertArchiveHistory(original,repeated,['archive.export.completed','archive.export.started']);
 await copyFile(first,input);assert.equal((await stat(input)).mode&0o777,0o600);
 await destination.run('Import into independent empty installation',['import','--','--target','local','--input','input.jsonl','--yes','--non-interactive']);proof.commands.push('pnpm run import -- --target local');
 await destination.run('Export independent restored archive',['export','--','--target','local','--output','exports/second.jsonl','--non-interactive']);proof.commands.push('pnpm run export -- --target local');
 const before=await records(first),after=await records(second);assertArchiveHistory(before,after,['archive.import.completed']);
 proof.categories=[...verifyRoundtripCategories(before),...verifyIntegrationCategories(before)];proof.rows=before[0].tables.reduce((sum,row)=>sum+row.count,0);proof.objects=before[0].objects.length;assert.equal(proof.objects,2);proof.equality=true;
 assert.deepEqual(destination.sql('PRAGMA foreign_key_check'),[]);await destination.configure();
 await unlink(join(destination.root,'node_modules'));await destination.installDependencies();
 await destination.start();const restored=await destination.signIn();
 assert.equal((await destination.req('/api/issues/'+fixture.identifier,'GET',undefined,restored)).status,200);
 const references=await destination.req('/api/issues/'+fixture.referenceSource+'/references','GET',undefined,restored);assert.equal(references.status,200);assert.equal((await references.json()).references.some(row=>row.identifier===fixture.referenceTarget),true);
 console.log('ISSUE-027 portable archive restores reference subjects through native public doors.');
 const search=await destination.req('/api/search?q=searchable','GET',undefined,restored);assert.equal(search.status,200);assert((await search.json()).issues.some(row=>row.identifier===fixture.identifier),'Restored comments resolve to their native issue');
 const exact=await destination.req('/api/search?q='+encodeURIComponent(fixture.identifier),'GET',undefined,restored);assert.equal(exact.status,200);assert((await exact.json()).issues.some(row=>row.identifier===fixture.identifier),'Restored immutable identifiers remain searchable');
 assert.equal((await destination.req('/auth/request','POST',{email:'maya@vector.test'})).status,409);
 const page=await openAuthenticatedPage(browser,restored,destination.origin);
 const reviewEffects=await restoreAccessJourney({page,installation:destination,cookie:restored,peer:fixture.peer,reviewPerson,evidence});const peer=await destination.signIn('maya@vector.test');
 assert.equal((await destination.req('/api/views/'+fixture.privateView,'GET',undefined,peer)).status,404);assert.equal((await destination.req('/api/views/'+fixture.sharedView,'GET',undefined,peer)).status,200);proof.privateViews=true;
 assert.equal((await destination.req('/cdn-cgi/local/scheduled')).status,404);
 const runCron=()=>destination.scheduledRun();
 const history=destination.sql('SELECT * FROM notification_deliveries ORDER BY id'),attempts=destination.sql('SELECT * FROM notification_delivery_attempts ORDER BY id');
 await runCron();assert.deepEqual(destination.sql('SELECT * FROM notification_deliveries ORDER BY id'),history);assert.deepEqual(destination.sql('SELECT * FROM notification_delivery_attempts ORDER BY id'),attempts);
 await verifyRestoredIntegrations(destination,restored,integrations,fixture.identifier,reviewEffects);await verifyOAuthArchive(destination,restored,oauth,before);await runCron();assert.deepEqual(destination.sql('SELECT * FROM notification_deliveries ORDER BY id'),history);assert.deepEqual(destination.sql('SELECT * FROM notification_delivery_attempts ORDER BY id'),attempts);proof.heldAfterCron=true;
 proof.restoreSettings={widths:[1440,390],initialProjection:true,pending:true,refusal:true,refreshedAdmission:true,refreshedEffects:true,historicalDeliveriesQuarantined:true};
 await destination.stop();proof.passed=true;
}finally{await browser?.close();await source?.close();await destination?.close();await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'roundtrip-proof.json'),JSON.stringify(proof,null,2)+'\n');await rm(work,{recursive:true,force:true});}
console.log('Independent native installations: complete public archive command equality, restored privacy and no historical Cron replay passed.');

/** Seed and check the same archive door without retaining credentials in evidence. */
export async function seedOAuthArchive(installation,cookie){
 const call=async(path,body,status)=>{const r=await installation.req(path,'POST',body,cookie);assert.equal(r.status,status);return r.json();};
 const redirect=installation.origin+'/oauth-test-client/callback';
 const client=await call('/api/settings/oauth-apps',{name:'synthetic-vector-4551',redirectUris:[redirect],scopes:['issues:read']},201);
 const request={response_type:'code',client_id:client.id,redirect_uri:redirect,scope:'issues:read',state:'synthetic-vector-4552'};
 const member=await installation.signIn('maya@vector.test');
 const approval=await installation.req('/api/oauth/consent','POST',{request,decision:'approve'},member);assert.equal(approval.status,200);const consent=await approval.json();
 const token=await call('/api/oauth/token',{grant_type:'authorization_code',client_id:client.id,client_secret:client.secret,code:new URL(consent.redirect).searchParams.get('code'),redirect_uri:redirect},200);
 assert.equal((await installation.req('/api/v1/issues','GET',undefined,'',{Authorization:'Bearer '+token.access_token})).status,200);
 assert.equal(installation.sql('SELECT COUNT(*) AS n FROM vector_oauth_apps')[0].n,1);assert.equal(installation.sql('SELECT COUNT(*) AS n FROM vector_oauth_grants')[0].n,1);
 const namespace=installation.sql('SELECT namespace FROM vector_oauth_grants')[0].namespace;
 const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
 const rows=query=>installation.sql(query).map(row=>row.id??row.token_id);
 const history={
  vector_integration_tokens:rows('SELECT * FROM vector_integration_tokens WHERE namespace='+quote(namespace)),
  integration_token_usage:rows('SELECT * FROM integration_token_usage WHERE namespace='+quote(namespace)+' ORDER BY id'),
  audit_records:rows('SELECT * FROM audit_records WHERE subject_id IN ('+quote(client.id)+','+quote(token.grant_id)+') ORDER BY id'),
 };
 assert.equal(history.vector_integration_tokens.length,1);assert.equal(history.integration_token_usage.length,1);
 assert.ok(history.audit_records.length);
 return {token:token.access_token,history};
}
export async function verifyOAuthArchive(installation,cookie,fixture,records){
 assert.equal((await installation.req('/api/v1/issues','GET',undefined,'',{Authorization:'Bearer '+fixture.token})).status,401,'The restored installation refuses the pre-restore OAuth token');
 for(const table of ['vector_oauth_apps','vector_oauth_codes','vector_oauth_grants','integration_tokens']){
  assert.equal(records[0].tables.some(row=>row.name===table),false,'OAuth credential tables are excluded');assert.equal(installation.sql('SELECT COUNT(*) AS n FROM '+table)[0].n,0);
 }
 const rows=records.filter(row=>row.kind==='part').flatMap(part=>part.items).filter(item=>item.kind==='row');
 for(const [table,ids] of Object.entries(fixture.history)){
  assert.ok(ids.every(id=>rows.some(item=>item.table===table&&(item.row.id??item.row.token_id)===id)),'Archive retains safe OAuth history: '+table);
  const restored=installation.sql('SELECT '+(table==='vector_integration_tokens'?'token_id':'id')+' FROM '+table);
  assert.ok(ids.every(id=>restored.some(row=>(row.id??row.token_id)===id)),'Restore retains safe OAuth history: '+table);
 }
 // A restored member must authorize a freshly registered app before new authority exists.
 const redirect=installation.origin+'/oauth-test-client/callback';
 const registered=await installation.req('/api/settings/oauth-apps','POST',{name:'synthetic-vector-4553',redirectUris:[redirect],scopes:['issues:read']},cookie);assert.equal(registered.status,201,'Fresh registration after restore');const client=await registered.json();
 const member=await installation.signIn('maya@vector.test'),request={response_type:'code',client_id:client.id,redirect_uri:redirect,scope:'issues:read',state:'synthetic-vector-4554'};
 const screen=await installation.req('/api/oauth/consent?'+new URLSearchParams(request),'GET',undefined,member);assert.equal(screen.status,200);assert.deepEqual((await screen.json()).scopes,['issues:read']);
 const approved=await installation.req('/api/oauth/consent','POST',{request,decision:'approve'},member);assert.equal(approved.status,200,'Fresh member consent after restore');const consent=await approved.json();
 const exchanged=await installation.req('/api/oauth/token','POST',{grant_type:'authorization_code',client_id:client.id,client_secret:client.secret,code:new URL(consent.redirect).searchParams.get('code'),redirect_uri:redirect});assert.equal(exchanged.status,200);const token=await exchanged.json();assert.equal(token.scope,'issues:read');
 const session=await installation.req('/api/session','GET',undefined,member);assert.equal(session.status,200);const identity=await session.json();
 const grant=installation.sql("SELECT operator_id FROM vector_oauth_grants WHERE id='"+token.grant_id.replaceAll("'","''")+"'")[0];assert.equal(grant.operator_id,identity.operatorId,'Fresh restored consent belongs to the consenting member');
 assert.equal((await installation.req('/api/v1/issues','GET',undefined,'',{Authorization:'Bearer '+token.access_token})).status,200,'Fresh restored OAuth grant reads through the public API');
 assert.equal((await installation.req('/api/v1/issues','GET',undefined,'',{Authorization:'Bearer '+fixture.token})).status,401,'Fresh consent never revives the old token');
 console.log('API-004 archive door excludes registration, codes and grants; specific OAuth history survives, the old token is refused and fresh member consent restores access.');
}
