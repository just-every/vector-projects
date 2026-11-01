import {jsonMediaType,formMediaType} from '../../../src/core/features/oauth-apps/media-types.ts';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {openAuthenticatedPage} from '../ui-runtime-auth.mjs';
import {confirmLink,readDevelopmentLink} from '../outbox-session.mjs';
import {navigate,settleReads,trackRequests} from '../collaboration-navigation.mjs';

/** One browser journey; assertions run at desktop width, captures also show phone layout. */
export async function exerciseOAuthApps({page,runtime,cookie,evidence}){
 const name='synthetic-vector-4541',redirect=runtime.base+'/oauth-test-client/callback',headers={Cookie:cookie,Origin:runtime.base,'Content-Type':jsonMediaType};
 const capture=async(page,region,name)=>{
  await mkdir(evidence,{recursive:true});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await region.scrollIntoViewIfNeeded();
   await region.evaluate(root=>{
    for(const element of document.querySelectorAll('body *'))
     if(['fixed','sticky'].includes(getComputedStyle(element).position)&&!root.contains(element)&&!element.contains(root))
      element.setAttribute('data-oauth-capture-hidden','');
   });
   await region.screenshot({path:join(evidence,name+'-'+width+'.png'),style:'[data-oauth-capture-hidden] { visibility:hidden !important; }'});
   await page.evaluate(()=>document.querySelectorAll('[data-oauth-capture-hidden]').forEach(element=>element.removeAttribute('data-oauth-capture-hidden')));
  }
  await page.setViewportSize({width:1440,height:1000});
 };
 const call=async(path,method='GET',body,status=200)=>{const r=await runtime.req('/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,status);return r.json();};
 const person=async(n,role)=>{
  const email='synthetic-vector-'+n+'@vector.test';await call('/settings/operators/invite','POST',{email,displayName:'synthetic-vector-'+n,role},202);
  const link=await readDevelopmentLink(runtime.base,runtime.req,email,runtime.state),confirmed=await confirmLink(link);assert.equal(confirmed.status,303);
  return confirmed.headers.get('set-cookie').split(';')[0];
 };
 const memberCookie=await person(4542,'member'),adminCookie=await person(4543,'admin');
 await page.setViewportSize({width:1440,height:1000});trackRequests(page);await navigate(page,runtime.base+'/app/settings/developers/apps');
 assert.equal(new URL(page.url()).pathname,'/app/settings/developers/apps');
 const panel=page.getByRole('region',{name:'OAuth apps',exact:true});await panel.getByRole('heading',{name:'Registered applications',exact:true}).waitFor();
 await panel.getByLabel('Application name',{exact:true}).fill(name);await panel.getByLabel('Redirect URLs',{exact:true}).fill('http://example.com/callback');
 let response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/oauth-apps'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Register application',exact:true}).click();assert.equal((await response).status(),400);
 const alert=panel.getByRole('alert');await alert.waitFor();assert.ok(await alert.isVisible());await expect(alert).toBeInViewport();
 await capture(page,panel.locator('form'),'oauth-register-refused');
 await panel.getByLabel('Redirect URLs',{exact:true}).fill(redirect);
 await panel.getByRole('checkbox',{name:'Create and update issues',exact:true}).check();await panel.getByRole('checkbox',{name:'Read projects you can access',exact:true}).check();
 response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/oauth-apps'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Register application',exact:true}).click();const receipt=await response;assert.equal(receipt.status(),201);const client=await receipt.json();
 const secret=panel.getByLabel('New credential',{exact:true});await secret.waitFor();assert.equal(await secret.inputValue()===client.secret,true);
 await panel.getByRole('button',{name:'I saved it; close',exact:true}).click();assert.equal(await secret.count(),0);
 await panel.getByLabel(name+' client ID',{exact:true}).waitFor();await page.reload();await panel.getByLabel(name+' client ID',{exact:true}).waitFor();
 assert.equal(await secret.count(),0);assert.equal((await page.content()).includes(client.secret),false);
 const member=await openAuthenticatedPage(page.context().browser(),memberCookie,runtime.base),admin=await openAuthenticatedPage(page.context().browser(),adminCookie,runtime.base);
 try{
  await member.setViewportSize({width:1440,height:1000});trackRequests(member);
  const verifier=randomBytes(32).toString('hex'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const query=new URLSearchParams({response_type:'code',client_id:client.id,redirect_uri:redirect,scope:'issues:read projects:read',state:'synthetic-vector-4544',code_challenge:challenge,code_challenge_method:'S256'});
  await navigate(member,runtime.base+'/api/oauth/authorize?'+query);const consent=member.getByRole('region',{name:'Authorize an application',exact:true});
  await consent.getByRole('heading',{name,exact:true}).waitFor();await capture(member,consent,'oauth-consent');
  await Promise.all([member.waitForURL(url=>url.pathname==='/oauth-test-client/callback'),consent.getByRole('button',{name:'Approve access',exact:true}).click()]);
  const code=new URL(member.url()).searchParams.get('code');assert.ok(code);
  const exchange=await runtime.req('/api/oauth/token',{method:'POST',headers:{'Content-Type':formMediaType},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.id,client_secret:client.secret,code,redirect_uri:redirect,code_verifier:verifier})});
  assert.equal(exchange.status,200);const token=await exchange.json();
  const api=(path,method='GET',body)=>runtime.req('/api/v1'+path,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':jsonMediaType},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await api('/issues')).status,200);const before=runtime.sql('SELECT COUNT(*) AS n FROM issues')[0].n,team=runtime.sql('SELECT id FROM teams ORDER BY created_at LIMIT 1')[0].id;
  assert.equal((await api('/issues','POST',{teamId:team,title:'synthetic-vector-4545'})).status,403);assert.equal(runtime.sql('SELECT COUNT(*) AS n FROM issues')[0].n,before);
  await navigate(member,runtime.base+'/app/settings/developers');const personal=member.getByRole('region',{name:'API tokens',exact:true});await personal.waitFor();
  assert.equal(await personal.getByText(name,{exact:true}).count(),0);await capture(member,personal,'oauth-member-tokens');
  const invalid=new URLSearchParams(query);invalid.set('client_id',randomUUID());
  await navigate(member,runtime.base+'/api/oauth/authorize?'+invalid);assert.equal(new URL(member.url()).pathname,'/app/settings/oauth-consent');
  await member.getByRole('alert').waitFor();assert.ok(await member.getByRole('alert').isVisible());assert.ok(await member.getByRole('link',{name:'Back to Vector',exact:true}).isVisible());
  await capture(member,member.getByRole('region',{name:'Authorize an application',exact:true}),'oauth-consent-error');
  trackRequests(admin);await navigate(admin,runtime.base+'/app/settings/developers/apps');const inventory=admin.getByRole('region',{name:'Authorized grants',exact:true}),revoke=inventory.getByRole('button',{name:'Revoke '+name+' for synthetic-vector-4542',exact:true});
  await revoke.waitFor();await capture(admin,admin.getByRole('region',{name:'OAuth apps',exact:true}),'oauth-apps');
  response=admin.waitForResponse(r=>r.request().method()==='DELETE'&&new URL(r.url()).pathname==='/api/settings/oauth-apps/grants/'+token.grant_id);
  await revoke.click();assert.equal((await response).status(),200);await inventory.getByRole('status').waitFor();assert.equal((await api('/issues')).status,401);await settleReads(admin);
 }finally{await member.context().close();await admin.context().close();}
 console.log('API-004 OAuth browser authorization, personal-token isolation, recovery and Admin revocation passed.');
}
