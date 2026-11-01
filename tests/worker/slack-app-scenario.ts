import {slackUnfurlScenario} from './slack-unfurl-scenario';
import {slackAppArchive,slackProviderUninstall} from './slack-app-recovery-scenario';
import {setupSlackIntake,slackEventIntake,slackIntakeFixture,slackMemberMapping} from './slack-events-scenario';
import {env} from 'cloudflare:workers';
import {reset} from 'cloudflare:test';
import {expect,vi} from 'vitest';
import {setupIntegrations} from './integration-fixture';
import {invite,request,bindings,actor} from './base-auth-fixture';
export async function slackAppScenario(phase:'installation'|'mapping'|'events'|'archive'|'uninstall'|'unfurl'){
 // Each registration owns fresh bindings, identities and public-door setup.
 await reset();
 const f=await setupIntegrations(),secret='synthetic-vector-'+crypto.randomUUID(),clientSecret='synthetic-vector-'+crypto.randomUUID(),configToken='synthetic-vector-'+crypto.randomUUID(),botToken='synthetic-vector-'+crypto.randomUUID();
 const manifestForInstallation=(manifest:any)=>{
  const at=(path:string)=>bindings.APP_ORIGIN+'/api/integrations/slack/'+path;
  expect(manifest.oauth_config.redirect_urls).toEqual([at('oauth/callback')]);
  expect(manifest.settings.interactivity).toMatchObject({is_enabled:true,request_url:at('interactive')});
  expect(manifest.settings.event_subscriptions.request_url).toBe(at('events'));
  expect(manifest.settings.event_subscriptions.bot_events).toEqual(expect.arrayContaining(['app_mention','message.channels','link_shared']));
  expect(manifest.features.slash_commands).toEqual(expect.arrayContaining([expect.objectContaining({command:'/vector',url:at('commands'),should_escape:true})]));
  expect(manifest.features.unfurl_domains).toContain(new URL(bindings.APP_ORIGIN).hostname);
  expect(manifest.oauth_config.scopes.bot).toEqual(expect.arrayContaining(['app_mentions:read','channels:history','commands','links:read','links:write']));
  expect(manifest.oauth_config.scopes.bot).not.toContain('admin');
 };
 const calls:{method:string;body:any}[]=[];
 let denied=false,grant:'valid'|'wrong-app'|'missing-scope'|'user'='valid';
 const edge=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const url=new URL(String(input));expect(url.origin).toBe('https://slack.com');expect(init?.redirect).toBe('manual');
  const method=url.pathname.slice(5),form=new Headers(init?.headers).get('content-type')?.startsWith('application/x-www-form-urlencoded');
  const body=init?.method==='GET'?Object.fromEntries(url.searchParams):form?Object.fromEntries(new URLSearchParams(String(init?.body))):JSON.parse(String(init?.body??'{}'));calls.push({method,body});
  if(method==='apps.manifest.create'){
   expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer '+configToken);
   if(denied)return Response.json({ok:false,error:'invalid_auth'});
   const manifest=JSON.parse(body.manifest);manifestForInstallation(manifest);
   expect(manifest.oauth_config.scopes.bot).toContain('chat:write');
   return Response.json({ok:true,app_id:'synthetic-vector-2000',credentials:{client_id:'synthetic-vector-2001',client_secret:clientSecret,signing_secret:secret}});
  }
  if(method==='oauth.v2.access'){expect(body.client_secret).toBe(clientSecret);expect(body.redirect_uri).toBe(bindings.APP_ORIGIN+'/api/integrations/slack/oauth/callback');return Response.json({ok:true,token_type:grant==='user'?'user':'bot',app_id:grant==='wrong-app'?'synthetic-vector-2099':'synthetic-vector-2000',scope:grant==='missing-scope'?'chat:write':'chat:write,channels:manage,channels:read,im:write,users:read.email,app_mentions:read,channels:history,commands,links:read,links:write',access_token:botToken});}
  if(method==='auth.test'){expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer '+botToken);return Response.json({ok:true,team:'synthetic-vector-2002',team_id:slackIntakeFixture.team});}
  if(method==='users.lookupByEmail')return Response.json({ok:true,user:{id:slackIntakeFixture.user,team_id:slackIntakeFixture.team,real_name:'Synthetic member'}});
  if(method==='conversations.info')return Response.json({ok:true,channel:{id:body.channel,name:'synthetic-vector-33001',is_channel:true,is_member:true,is_archived:false,is_shared:false,is_ext_shared:false,is_org_shared:false,is_pending_ext_shared:false}});
  if(method==='chat.unfurl'){expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer '+botToken);return Response.json({ok:true});}
  if(method==='auth.revoke')return Response.json({ok:true,revoked:true});
  throw Error('Unexpected Slack installation edge '+method);
 });
 const read=async(response:Response,status=200)=>{expect(response.status,await response.clone().text()).toBe(status);return response.json() as Promise<any>;};
 const callback=(state:string,cookie=f.cookie)=>request('/api/integrations/slack/oauth/callback?state='+encodeURIComponent(state)+'&code=synthetic-vector-2003','GET',undefined,cookie);
 const begin=async(cookie=f.cookie)=>new URL((await read(await request('/api/settings/integrations/slack/app/install','POST',{},cookie))).url).searchParams.get('state')!;
 try{
  // This file also exercises the legacy paste path in an earlier registration.
  // Begin this independent installation journey through its public removal door.
  await read(await f.call('/settings/integrations/slack','DELETE'));calls.length=0;
  if(phase==='installation'){
  // A Member cannot create, inspect credentials, or start an installation.
  const member=await invite('synthetic-vector-2004@vector.test',f.cookie),admin=await invite('synthetic-vector-2005@vector.test',f.cookie,'admin');
  for(const [path,method] of [['/slack/app','GET'],['/slack/app','POST'],['/slack/app/create','POST'],['/slack/app/install','POST']])expect((await request('/api/settings/integrations'+path,method,method==='GET'?undefined:{},member)).status).toBe(403);
  expect(calls).toHaveLength(0);
  await read(await f.call('/settings/integrations/slack/app/members','POST',{operatorId:f.owner,slackTeamId:slackIntakeFixture.team,slackUserId:slackIntakeFixture.user}),409);
  const preview=await read(await f.call('/settings/integrations/slack/app'));
  expect(JSON.parse(new URL(preview.createUrl).searchParams.get('manifest_json')!)).toEqual(preview.manifest);
  manifestForInstallation(JSON.parse(new URL(preview.createUrl).searchParams.get('manifest_json')!));
  expect(preview.app).toBeNull();
  await read(await f.call('/settings/integrations/slack/app/create','POST',{configurationToken:configToken}));
  const configured=await read(await f.call('/settings/integrations/slack/app'));
  expect(configured.app).toEqual({appId:'synthetic-vector-2000',clientId:'synthetic-vector-2001'});
  const stored=(await env.DB.prepare("SELECT encrypted FROM vector_integration_secret_keys WHERE identity LIKE 'slack-app:%'").all()).results;
  expect(stored).toHaveLength(1);expect(JSON.stringify(stored)).not.toContain(clientSecret);expect(JSON.stringify(stored)).not.toContain(secret);expect(JSON.stringify(stored)).not.toContain(configToken);
  denied=true;await read(await f.call('/settings/integrations/slack/app/create','POST',{configurationToken:configToken}),400);denied=false;
  expect((await env.DB.prepare("SELECT encrypted FROM vector_integration_secret_keys WHERE identity LIKE 'slack-app:%'").all()).results).toEqual(stored);
  const discarded=await begin(),current=await begin();
  expect((await callback(discarded)).status).toBe(403);
  expect((await callback(current,member)).status).toBe(403);
  expect((await callback(current,admin)).status).toBe(403);
  expect(calls.filter(c=>c.method==='oauth.v2.access')).toHaveLength(0);
  const installed=await callback(current);expect(installed.status,await installed.clone().text()).toBe(303);
  expect(installed.headers.get('Location')).toBe('/app/settings/connections');
  expect((await read(await f.call('/settings/integrations/channels'))).slack).toMatchObject({connected:true,signingSecret:true});
  expect((await callback(current)).status).toBe(403);expect(calls.filter(c=>c.method==='oauth.v2.access')).toHaveLength(1);
  const all=(await env.DB.prepare("SELECT encrypted FROM vector_integration_secret_keys WHERE identity LIKE 'slack%'").all()).results;
  expect(all).toHaveLength(3);expect(JSON.stringify(all)).not.toContain(botToken);expect(JSON.stringify(all)).not.toContain(clientSecret);expect(JSON.stringify(all)).not.toContain(secret);
  const installedCredentials=async()=>(await env.DB.prepare("SELECT * FROM vector_integration_secret_keys WHERE identity LIKE 'slack%' AND identity NOT LIKE 'slack-oauth:%' ORDER BY identity,slot").all()).results;
  const priorCredentials=await installedCredentials();
  for(const refusedGrant of ['wrong-app','missing-scope','user'] as const){
   grant=refusedGrant;const refusedState=await begin();
   expect(await read(await callback(refusedState),400)).toMatchObject({error:'slack_oauth_grant_invalid'});
   expect(await installedCredentials()).toEqual(priorCredentials);
   const beforeReplay=calls.length;expect((await callback(refusedState)).status).toBe(403);expect(calls).toHaveLength(beforeReplay);
  }
  grant='valid';
  expect((await request('/api/settings/integrations/slack/app','GET',undefined,admin)).status).toBe(200);
  const adminState=await begin(admin);expect((await callback(adminState)).status).toBe(403);expect((await callback(adminState,admin)).status).toBe(303);
  expect(calls.filter(c=>c.method==='oauth.v2.access')).toHaveLength(5);
  const expiredState=await begin();await env.DB.prepare("UPDATE vector_integration_secret_keys SET valid_until=? WHERE identity LIKE 'slack-oauth:%'").bind(Date.now()-1).run();
  const expired=await env.DB.prepare("SELECT count(*) n FROM vector_integration_secret_keys WHERE identity LIKE 'slack-oauth:%' AND valid_until<?").bind(Date.now()).first<number>('n');expect(expired).toBe(1);expect((await callback(expiredState)).status).toBe(403);expect(calls.filter(c=>c.method==='oauth.v2.access')).toHaveLength(5);
  // The manual manifest path stores the same sealed profile, without a configuration token.
  await read(await f.call('/settings/integrations/slack/app','POST',{appId:'synthetic-vector-2000',clientId:'synthetic-vector-2001',clientSecret,signingSecret:secret}));
  const manualState=await begin();expect((await callback(manualState)).status).toBe(303);
  expect((await callback(manualState)).status).toBe(403);expect(calls.filter(c=>c.method==='oauth.v2.access')).toHaveLength(6);
   return;
  }
  // Every phase installs independently through the same public creation and OAuth doors.
  await read(await f.call('/settings/integrations/slack/app/create','POST',{configurationToken:configToken}));
  const state=await begin();expect((await callback(state)).status).toBe(303);
  const member=phase==='archive'||phase==='uninstall'?f.cookie:await invite('synthetic-vector-'+phase+'@vector.test',f.cookie);
  if(phase==='mapping'){
   const admin=await invite('synthetic-vector-2005@vector.test',f.cookie,'admin'),viewer=await invite('synthetic-vector-33007@vector.test',f.cookie,'viewer');
   await slackMemberMapping(f,admin,member,viewer);
   return;
  }
  const mappedMember=await actor(member);
  await read(await f.call('/settings/integrations/slack/app/members','POST',{operatorId:mappedMember,slackTeamId:slackIntakeFixture.team,slackUserId:slackIntakeFixture.user}));
  if(phase==='unfurl'){await slackUnfurlScenario(f,secret,member,mappedMember,calls);return;}
  if(phase==='events'){await slackEventIntake(f,secret,mappedMember);return;}
  const intake=await setupSlackIntake(f,secret,mappedMember);
  await intake.read(await intake.send(intake.payload));
  if(phase==='archive'){
   await begin();await slackAppArchive(f,[secret,clientSecret,configToken,botToken]);
   return;
  }
  for(const event of ['app_uninstalled','tokens_revoked'] as const){
   const priorCalls=calls.length;await slackProviderUninstall(f,secret,event);expect(calls).toHaveLength(priorCalls);
   await read(await f.call('/settings/integrations/slack/app','POST',{appId:'synthetic-vector-2000',clientId:'synthetic-vector-2001',clientSecret,signingSecret:secret}));
   const reconnect=await begin();expect((await callback(reconnect)).status).toBe(303);
  }
  await begin();await read(await f.call('/settings/integrations/slack','DELETE'));
  expect((await read(await f.call('/settings/integrations/slack/app'))).app).toBeNull();
  expect(await env.DB.prepare("SELECT count(*) n FROM vector_integration_secret_keys WHERE identity LIKE 'slack%'").first<number>('n')).toBe(0);
  expect(calls.filter(c=>c.method==='auth.revoke')).toHaveLength(1);
 }finally{edge.mockRestore();}
}
