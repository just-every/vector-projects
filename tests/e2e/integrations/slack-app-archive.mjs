import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {readArchive} from '@runeditrun/rer/modules/portability';
import {confirmLink} from '../outbox-session.mjs';
import {openAuthenticatedPage} from '../ui-runtime-auth.mjs';
const require=createRequire(import.meta.url);
/** The installed app is exported and restored through the real archive HTTP
 * doors into an independent runtime; no browser or credential state is copied. */
export async function exerciseSlackAppArchive({page,runtime,cookie,width,evidence,fixture}){
 const headers={Cookie:cookie,Origin:runtime.base,'Content-Type':'application/json'};
 const api=(path,method='GET',body)=>runtime.req('/api'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
 const created=await api('/portability/exports','POST',{});assert.equal(created.status,201);const {id}=await created.json();let phase='building';
 while(phase==='building'){const advanced=await api('/portability/exports/'+id+'/advance','POST',{maxParts:16});assert.equal(advanced.status,200);phase=(await advanced.json()).phase;}
 const download=await api('/portability/exports/'+id+'/download');assert.equal(download.status,200);const records=[];for await(const record of readArchive(download.body))records.push(record);
 assert.equal((await api('/portability/exports/'+id+'/abort','POST',{})).status,200);
 const bytes=JSON.stringify(records),sealed=runtime.sql("SELECT encrypted FROM vector_integration_secret_keys WHERE identity LIKE 'slack%'");assert.ok(sealed.length>0);
 for(const value of [fixture.clientSecret,fixture.signingSecret,fixture.botToken,...sealed.map(row=>row.encrypted)])assert.ok(!bytes.includes(value),'Slack credential excluded from archive');
 // A separate module instance allocates a separate free port and persistence root.
 const {createUiRuntime}=await import('../ui-runtime-support.mjs?slackArchive='+width+'-'+crypto.randomUUID());
 const target=createUiRuntime({sampleData:false,bindings:{FIRST_OWNER_NAME:'synthetic-vector-33040',WORKSPACE_TIMEZONE:'UTC',DEFAULT_TEAM_NAME:'synthetic-vector-33041',DEFAULT_TEAM_PREFIX:'SYNARC'}});let context;
 try{
  target.initialize();target.start();await target.ready();
  // Sign in through the target's own door without completing setup: restore
  // admission requires its untouched bootstrap graph.
  const email=target.sql('SELECT email FROM operators ORDER BY created_at LIMIT 1')[0].email;
  const authenticate=async()=>{
   const requested=await target.req('/auth/request',{method:'POST',headers:{Origin:target.base,'Content-Type':'application/json'},body:JSON.stringify({email,returnTo:'/app'})});assert.equal(requested.status,202,await requested.clone().text());
   const url=target.sql("SELECT json_extract(message,'$.text') AS text FROM rer_mail_development_outbox ORDER BY sequence DESC LIMIT 1")[0].text.match(/https?:\/\/[^\s]+/)[0];
   const confirmed=await confirmLink(url);assert.equal(confirmed.status,303);return {cookie:confirmed.headers.get('set-cookie').split(';')[0]};
  };
  let authenticated=await authenticate();
  const targetApi=(path,method='GET',body)=>target.req('/api'+path,{method,headers:{Cookie:authenticated.cookie,Origin:target.base,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const staged=await targetApi('/portability/imports','POST',{confirmed:true,manifest:records[0]});assert.equal(staged.status,201,await staged.clone().text());const job=(await staged.json()).id;
  for(const part of records.filter(row=>row.kind==='part'))assert.equal((await targetApi('/portability/imports/'+job+'/parts/'+part.index,'PUT',part)).status,200);
  const closing=records.at(-1),finalized=await targetApi('/portability/imports/'+job+'/finalize','POST',{contentHash:closing.contentHash,archiveHash:closing.archiveHash});assert.equal(finalized.status,200,await finalized.clone().text());
  const initialized=await target.req('/health');assert.equal(initialized.status,200);await initialized.body.cancel();
  authenticated=await authenticate();
  const review=await targetApi('/setup');assert.equal(review.status,200);const setup=await review.json();
  if(setup.owner&&!setup.completed)assert.equal((await targetApi('/setup/complete','POST',{confirmed:true})).status,200);
  const app=await targetApi('/settings/integrations/slack/app');assert.equal(app.status,200);assert.equal((await app.json()).app,null);
  const channels=await targetApi('/settings/integrations/channels');assert.equal(channels.status,200);const slack=(await channels.json()).slack;assert.equal(slack.connected,false);assert.equal(slack.needsAttention,true);assert.equal(slack.signingSecret,false);
  assert.equal((await targetApi('/settings/integrations/slack/app/install','POST',{})).status,409);
  assert.deepEqual(target.sql('SELECT * FROM vector_slack_event_receipts ORDER BY event_key'),runtime.sql('SELECT * FROM vector_slack_event_receipts ORDER BY event_key'));
  const restored=await openAuthenticatedPage(page.context().browser(),authenticated.cookie,target.base);context=restored.context();await restored.setViewportSize({width,height:900});const errors=[];restored.on('pageerror',error=>errors.push(error.message));restored.on('console',message=>{if(message.type()==='error'&&/hydrat/i.test(message.text()))errors.push(message.text());});
  await restored.goto(target.base+'/app/settings/connections');const panel=restored.getByRole('region',{name:'Slack app installation',exact:true});await panel.getByRole('heading',{name:'Slack app installation',exact:true}).waitFor();
  await panel.getByText('Use Slack’s prefilled page',{exact:true}).click();const form=panel.getByRole('form',{name:'Slack app credentials',exact:true});
  for(const label of ['App client secret','App signing secret'])assert.equal(await form.getByLabel(label,{exact:true}).inputValue(),'');
  assert.equal(await panel.getByRole('button',{name:'Install Slack app',exact:true}).count(),0);assert.ok(await restored.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await restored.addScriptTag({path:require.resolve('axe-core/axe.min.js')});const findings=await restored.evaluate(async()=>{const result=await axe.run();return result.violations.filter(v=>['serious','critical'].includes(v.impact));});assert.deepEqual(findings,[]);assert.deepEqual(errors,[]);
  await panel.screenshot({path:resolve(evidence,'slack-app-restored-reentry-'+width+'.png')});
 }finally{await context?.close();await target.stop();}
}
