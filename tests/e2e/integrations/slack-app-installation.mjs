import {exerciseSlackAppArchive} from './slack-app-archive.mjs';
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {slackAppFixture as fixture} from './channel-provider-edge.mjs';
const require=createRequire(import.meta.url);
/** SLACK-001's existing installation registration also reaches the real Settings UI. */
export async function exerciseSlackAppInstallation({page,runtime,cookie,team,width,evidence}){
 await mkdir(evidence,{recursive:true});await page.setViewportSize({width,height:900});
 const errors=[];const onError=error=>errors.push(error.message),onConsole=message=>{if(message.type()==='error'&&/hydrat/i.test(message.text()))errors.push(message.text());};
 page.on('pageerror',onError);page.on('console',onConsole);
 const panel=page.getByRole('region',{name:'Slack app installation',exact:true});
 const inspectManifest=manifest=>{
  const at=path=>runtime.base+'/api/integrations/slack/'+path;
  assert.deepEqual(manifest.oauth_config.redirect_urls,[at('oauth/callback')]);
  assert.equal(manifest.settings.event_subscriptions.request_url,at('events'));
  for(const event of ['app_mention','message.channels','link_shared'])assert.ok(manifest.settings.event_subscriptions.bot_events.includes(event));
  assert.equal(manifest.settings.interactivity.request_url,at('interactive'));
  assert.ok(manifest.features.slash_commands.some(command=>command.command==='/vector'&&command.url===at('commands')&&command.should_escape));
  assert.ok(manifest.features.unfurl_domains.includes(new URL(runtime.base).hostname));
  for(const scope of ['app_mentions:read','channels:history','commands','links:read','links:write'])assert.ok(manifest.oauth_config.scopes.bot.includes(scope));
 };
 const calls=async()=>(await readFile(process.env.VECTOR_CHANNEL_EDGE,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 const inspect=async name=>{
  await panel.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  const findings=await page.evaluate(async()=>{const result=await axe.run();return result.violations.filter(v=>['serious','critical'].includes(v.impact));});
  assert.deepEqual(findings,[]);
  // Match the existing role proof: a tall region capture must not stitch fixed
  // navigation over the form. This changes only the screenshot, not the UI.
  await panel.evaluate(root=>{for(const element of document.querySelectorAll('body *'))if(['fixed','sticky'].includes(getComputedStyle(element).position)&&!root.contains(element)&&!element.contains(root))element.setAttribute('data-capture-hidden','');});
  try{await panel.screenshot({path:resolve(evidence,'slack-app-'+name+'-'+width+'.png'),style:'[data-capture-hidden] { visibility: hidden !important; }'});}
  finally{await page.evaluate(()=>document.querySelectorAll('[data-capture-hidden]').forEach(element=>element.removeAttribute('data-capture-hidden')));}
 };
 const provider=async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='api.slack.com')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Synthetic Slack setup</title><body><main><h1>App created from the prefilled manifest</h1></main></body></html>'});
  assert.equal(url.origin,'https://slack.com');assert.equal(url.pathname,'/oauth/v2/authorize');assert.equal(url.searchParams.get('client_id'),fixture.clientId);
  const callback=new URL(url.searchParams.get('redirect_uri'));assert.equal(callback.href,runtime.base+'/api/integrations/slack/oauth/callback');
  callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic-vector-32017');
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Synthetic Slack consent</title><body><main><h1>Install Vector</h1><a href="'+callback.href.replaceAll('&','&amp;')+'">Approve fixture installation</a></main></body></html>'});
 };
 await page.context().route('https://slack.com/oauth/v2/authorize**',provider);
 await page.context().route('https://api.slack.com/apps**',provider);
 const receive=async(path,action,status=200)=>{const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/integrations'+path&&r.request().method()==='POST');await action();const response=await pending;assert.equal(response.status(),status);return response;};
 let eventNumber=0;
 const exerciseMappingAndIntake=async()=>{
  const mappings=panel.getByRole('form',{name:'Map Slack member',exact:true});
  const owner=runtime.sql("SELECT id,name FROM operators WHERE role='owner' AND removed_at IS NULL ORDER BY created_at LIMIT 1")[0];
  await mappings.getByLabel('Vector member').selectOption(owner.id);
  await mappings.getByLabel('Slack workspace ID',{exact:true}).fill(fixture.teamId);
  await mappings.getByLabel('Slack member ID',{exact:true}).fill(fixture.memberId);
  await receive('/slack/app/members',()=>mappings.getByRole('button',{name:'Map Slack member',exact:true}).click());
  await panel.getByRole('button',{name:'Remove mapping for '+owner.name,exact:true}).waitFor();await inspect('member-mapped');
  const binding=page.getByRole('form',{name:'Bind notification channel',exact:true});
  await binding.getByLabel('Team, project, saved view or initiative').selectOption('team:'+team.id);
  await binding.getByLabel('Channel service').selectOption('slack');
  await binding.getByLabel('Channel display name',{exact:true}).fill('synthetic-vector-33010');
  await binding.getByLabel('Slack channel ID').fill(fixture.intakeChannel);
  await receive('/channels',()=>binding.getByRole('button',{name:'Save channel binding',exact:true}).click(),201);
  const title='synthetic-vector-33011-'+width+'-'+(++eventNumber),payload={type:'event_callback',team_id:fixture.teamId,event_id:'synthetic-vector-33012-'+width+'-'+eventNumber,event:{type:'app_mention',user:fixture.memberId,channel:fixture.intakeChannel,text:'<@'+fixture.botId+'> '+title}};
  const body=JSON.stringify(payload),timestamp=String(Math.floor(Date.now()/1000));
  const headers={'Content-Type':'application/json','x-slack-request-timestamp':timestamp,'x-slack-signature':'v0='+createHmac('sha256',fixture.signingSecret).update('v0:'+timestamp+':'+body).digest('hex')};
  const created=await runtime.req('/api/integrations/slack/events',{method:'POST',headers,body});assert.equal(created.status,200);const issue=await created.json();
  assert.equal((await runtime.req('/api/integrations/slack/events',{method:'POST',headers,body})).status,409);
  await page.goto(runtime.base+'/app/issues/'+issue.identifier);await page.getByRole('heading',{name:title,exact:true}).waitFor();
  const recorded=runtime.sql("SELECT a.actor_operator_id FROM issue_activity a JOIN issues i ON i.id=a.issue_id WHERE i.identifier='"+issue.identifier+"' AND a.kind='issue.created'");assert.deepEqual(recorded.map(row=>row.actor_operator_id),[owner.id]);
  await page.goto(runtime.base+'/app/settings/connections');await panel.getByRole('button',{name:'Remove mapping for '+owner.name,exact:true}).waitFor();
  const removing=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/integrations/slack/app/members/'+owner.id&&r.request().method()==='DELETE');
  await panel.getByRole('button',{name:'Remove mapping for '+owner.name,exact:true}).click();assert.equal((await removing).status(),200);await panel.getByRole('button',{name:'Remove mapping for '+owner.name,exact:true}).waitFor({state:'hidden'});await inspect('member-unmapped');
  const changed=JSON.stringify({...payload,event_id:payload.event_id+'-unmapped'}),changedHeaders={...headers,'x-slack-signature':'v0='+createHmac('sha256',fixture.signingSecret).update('v0:'+timestamp+':'+changed).digest('hex')};
  assert.equal((await runtime.req('/api/integrations/slack/events',{method:'POST',headers:changedHeaders,body:changed})).status,403);
  const channels=await(await runtime.req('/api/settings/integrations/channels',{headers:{Cookie:cookie}})).json(),saved=channels.bindings.find(row=>row.scope==='team'&&row.objectId===team.id);
  assert.equal((await runtime.req('/api/settings/integrations/channels/'+saved.id,{method:'DELETE',headers:{Cookie:cookie,Origin:runtime.base}})).status,200);
 };
 const install=async()=>{
  await panel.getByRole('button',{name:'Install Slack app',exact:true}).click();await page.getByRole('link',{name:'Approve fixture installation',exact:true}).click();
  await page.waitForURL(runtime.base+'/app/settings/connections');await panel.getByText('App '+fixture.appId+' is configured. Stored secrets are never shown again.',{exact:true}).waitFor();
  await page.getByText('Slack connected to Delivery workspace',{exact:true}).waitFor();await inspect('installed');await exerciseMappingAndIntake();
 };
 const remove=async(withinApp=true)=>{
  const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/integrations/slack/app'&&r.request().method()==='GET');
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/integrations/slack'&&r.request().method()==='DELETE');
  await (withinApp?panel.getByRole('button',{name:'Remove Slack app',exact:true}):page.getByRole('button',{name:'Remove Slack connection',exact:true})).click();assert.equal((await pending).status(),200);assert.equal((await(await refreshed).json()).app,null);
  if(withinApp)await panel.getByText('Slack app removed. Members must link again after reconnecting.',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'Install Slack app',exact:true}).waitFor({state:'hidden'});await page.getByText('Slack is not connected.',{exact:true}).waitFor();
 };
 try{
  await page.goto(runtime.base+'/app/settings/connections');await panel.getByRole('heading',{name:'Slack app installation',exact:true}).waitFor();
  await panel.getByText('Create an app automatically',{exact:true}).click();const automatic=panel.getByRole('form',{name:'Generate Slack app',exact:true});await inspect('automatic');
  await automatic.getByLabel('App configuration token',{exact:true}).fill('synthetic-vector-32016');await receive('/slack/app/create',()=>automatic.getByRole('button',{name:'Create Slack app',exact:true}).click(),400);
  await panel.getByRole('alert').filter({hasText:'invalid_auth'}).waitFor();assert.equal(await panel.getByRole('button',{name:'Install Slack app',exact:true}).count(),0);
  const before=(await calls()).filter(row=>row.method==='apps.manifest.create').length;
  await automatic.getByLabel('App configuration token',{exact:true}).fill('synthetic-vector-32015');await receive('/slack/app/create',()=>automatic.getByRole('button',{name:'Create Slack app',exact:true}).click());
  await panel.getByRole('button',{name:'Install Slack app',exact:true}).waitFor();assert.equal(await automatic.getByLabel('App configuration token',{exact:true}).inputValue(),'');
  const generated=(await calls()).filter(row=>row.method==='apps.manifest.create');assert.equal(generated.length,before+1);inspectManifest(JSON.parse(generated.at(-1).body.manifest));await install();await remove(false);
  await panel.getByText('Use Slack’s prefilled page',{exact:true}).click();const manual=panel.getByRole('form',{name:'Slack app credentials',exact:true});await inspect('manual');
  const popupPromise=page.waitForEvent('popup');await panel.getByRole('link',{name:'Open Slack app setup',exact:true}).click();const popup=await popupPromise;await popup.waitForURL('https://api.slack.com/apps**');
  const manifest=JSON.parse(new URL(popup.url()).searchParams.get('manifest_json'));inspectManifest(manifest);await popup.close();
  for(const [label,value] of [['App ID',fixture.appId],['App client ID',fixture.clientId],['App client secret',fixture.clientSecret],['App signing secret',fixture.signingSecret]])await manual.getByLabel(label,{exact:true}).fill(value);
  await receive('/slack/app',()=>manual.getByRole('button',{name:'Save Slack app credentials',exact:true}).click());await panel.getByRole('button',{name:'Install Slack app',exact:true}).waitFor();
  for(const label of ['App client secret','App signing secret'])assert.equal(await manual.getByLabel(label,{exact:true}).inputValue(),'');
  const oauthBefore=(await calls()).filter(row=>row.method==='oauth.v2.access').length;await install();assert.equal((await calls()).filter(row=>row.method==='oauth.v2.access').length,oauthBefore+1);
  await exerciseSlackAppArchive({page,runtime,cookie,width,evidence,fixture});await remove();
  // A fresh installation is then retired by a signed provider lifecycle event.
  await panel.getByText('Use Slack’s prefilled page',{exact:true}).click();
  for(const [label,value] of [['App ID',fixture.appId],['App client ID',fixture.clientId],['App client secret',fixture.clientSecret],['App signing secret',fixture.signingSecret]])await manual.getByLabel(label,{exact:true}).fill(value);
  await receive('/slack/app',()=>manual.getByRole('button',{name:'Save Slack app credentials',exact:true}).click());await install();
  const lifecycle=JSON.stringify({type:'event_callback',event_id:'synthetic-vector-33030-'+width,event:{type:width===1440?'app_uninstalled':'tokens_revoked'}}),timestamp=String(Math.floor(Date.now()/1000)),beforeUninstall=(await calls()).length;
  const retired=await runtime.req('/api/integrations/slack/events',{method:'POST',headers:{'Content-Type':'application/json','x-slack-request-timestamp':timestamp,'x-slack-signature':'v0='+createHmac('sha256',fixture.signingSecret).update('v0:'+timestamp+':'+lifecycle).digest('hex')},body:lifecycle});assert.equal(retired.status,200);assert.equal((await calls()).length,beforeUninstall);
  const slackCalls=rows=>rows.filter(row=>!['sendgrid','discord'].includes(row.method)).length,beforeTick=slackCalls(await calls());
  const tick=await page.request.get(runtime.base+'/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *'));assert.equal(tick.status(),200);await tick.body();assert.equal(slackCalls(await calls()),beforeTick);
  await page.reload();await panel.getByRole('heading',{name:'Slack app installation',exact:true}).waitFor();await page.getByText('Slack is not connected.',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Install Slack app',exact:true}).count(),0);await inspect('provider-uninstalled');
  const reloaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/integrations/slack/app'&&r.request().method()==='GET');await page.reload();assert.equal((await(await reloaded).json()).app,null);await panel.getByRole('heading',{name:'Slack app installation',exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Install Slack app',exact:true}).count(),0);assert.deepEqual(errors,[]);
 }finally{await page.context().unroute('https://slack.com/oauth/v2/authorize**',provider);await page.context().unroute('https://api.slack.com/apps**',provider);page.off('pageerror',onError);page.off('console',onConsole);}
}
