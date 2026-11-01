import { withOperatorClient } from './operator-request.mjs';
import {openAuthenticatedPage} from './ui-runtime-auth.mjs';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {roleScreens} from './role-ui-support.mjs';
import {navigate,settleReads,trackRequests} from './collaboration-navigation.mjs';
import {confirmLink,readDevelopmentLink} from './outbox-session.mjs';
export async function releasesJourney({page:shared,runtime,evidence}){
 const page=await shared.context().newPage();trackRequests(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/hydration|did not match|Minified React error #(418|423|425)/i.test(m.text()))errors.push(m.text());});
 const capture=roleScreens(evidence),base=runtime.base;
 const call=async(path,method='GET',data,status=200)=>{return withOperatorClient(page.context(), async client => {
const res=await client.fetch(base+'/api'+path,{method,headers:{Origin:base},data});assert.equal(res.status(),status,await res.text());return await res.json();
});};
 try{
 const settings=await call('/settings/administration'),team=settings.teams.find(t=>!t.archivedAt),done=team.statuses.find(s=>s.category==='completed'),owner=(await call('/session')).operatorId;
 let memberFixture;
 // Viewports share one real Member; restore its role through the public Owner door.
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  const inspect=async(region,name)=>{await capture(page,region,name+'-'+width);await page.setViewportSize({width,height:1000});};
  await navigate(page,base+'/app/settings/developers');
  const panel=page.locator('#integrations');
  await panel.getByLabel('Token name',{exact:true}).fill('synthetic-vector-1750-'+width);
  await panel.getByLabel('releases:read',{exact:true}).check();await panel.getByLabel('releases:write',{exact:true}).check();
  const minted=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/settings/integrations/tokens');
  await panel.getByRole('button',{name:'Create token',exact:true}).click();const mintedResponse=await minted;assert.equal(mintedResponse.status(),201);const {token}=await mintedResponse.json();
  await panel.getByRole('button',{name:'I saved it; close',exact:true}).click();
  await inspect(panel.getByRole('group',{name:'Create a named token',exact:true}),'release-scopes');
  const api=(path,method='GET',data)=>page.request.fetch(base+'/api/v1'+path,{method,headers:{Origin:base,Authorization:'Bearer '+token},data});
  const projectState=await call('/settings/projects','POST',{name:'synthetic-vector-1751-'+width,leadOperatorId:owner});
  const project=projectState.projects.find(p=>p.name==='synthetic-vector-1751-'+width);
  const issues=[];
  for(let i=0;i<5;i++)issues.push(await call('/issues','POST',{teamId:team.id,projectId:project.id,title:'synthetic-vector-1752-'+width+'-'+i,...(i<2?{statusId:done.id}:{})},201));
  const blocker=await call('/issues','POST',{teamId:team.id,title:'synthetic-vector-1753-'+width},201);
  await call('/issues/'+issues[2].identifier+'/dependencies','POST',{expectedVersion:issues[2].version,relatedIdentifier:blocker.identifier,relatedVersion:blocker.version,direction:'blocked-by'});
  const fixtureRepository='synthetic-vector-1754/release-'+width,github=await call('/settings/integrations/github','POST',{name:'synthetic-vector-1754-'+width,repository:fixtureRepository},201);
  const body=JSON.stringify({action:'opened',number:24,repository:{full_name:fixtureRepository},pull_request:{number:24,title:'Refs '+issues[0].identifier,body:null,html_url:'https://github.com/'+fixtureRepository+'/pull/24',state:'open',merged:false,updated_at:'2026-10-23T13:00:00.000Z'}});
  const sent=await fetch(github.receiver,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256',github.secret).update(body).digest('hex'),'X-GitHub-Delivery':randomUUID(),'X-GitHub-Event':'pull_request'},body});assert.equal(sent.status,200);await sent.body.cancel();
  await navigate(page,base+'/app/releases');await page.getByRole('heading',{name:'Releases',exact:true}).waitFor();
  const form=page.getByRole('region',{name:'Create release',exact:true});
  await form.getByLabel('Release name',{exact:true}).fill('2.4');await form.getByLabel('Target date',{exact:true}).fill('2027-01-24');await form.getByLabel('Description',{exact:true}).fill('synthetic-vector-1755 delivery');
  await inspect(page.locator('.release-page'),'release-create');
  const created=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/releases');
  await form.getByRole('button',{name:'Create release',exact:true}).click();assert.equal((await created).status(),201);const release=await(await created).json();
  await page.getByRole('heading',{name:'2.4',exact:true}).waitFor();
  await page.getByText('Choose release scope',{exact:true}).click();
  await page.getByLabel('Issue keys',{exact:true}).fill(issues.map(i=>i.identifier).join(', '));
  await page.getByRole('checkbox',{name:project.name,exact:true}).check();
  await inspect(page.locator('.release-page'),'release-scope-editor');
  const scoped=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/releases/'+release.id+'/scope');
  await page.getByRole('button',{name:'Save release scope',exact:true}).click();assert.equal((await scoped).status(),200);
  await page.getByText('2/5 completed',{exact:true}).waitFor();
  await page.getByRole('link',{name:blocker.identifier+' · '+blocker.title,exact:true}).waitFor();
  await page.getByRole('link',{name:'Refs '+issues[0].identifier+' · '+fixtureRepository+' #24',exact:true}).waitFor();
  await inspect(page.locator('.release-page'),'release-progress-blockers-prs');
  const published=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/releases/'+release.id);
  await page.getByRole('button',{name:'Mark Released',exact:true}).click();assert.equal((await published).status(),200);
  await page.getByText('Released',{exact:true}).first().waitFor();
  await inspect(page.locator('.release-page'),'release-released');
  for(const issue of issues){const detail=await call('/issues/'+issue.identifier);assert.equal(detail.activity.filter(a=>a.kind==='release.published'&&a.nextValue.releaseId===release.id).length,1);}
  const read=await api('/releases/'+release.id);assert.equal(read.status(),200);assert.equal((await read.json()).status,'released');
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.getByRole('button',{name:'Share inside workspace',exact:true}).click();await page.getByText('Read-only workspace link copied.',{exact:true}).waitFor();
  const share=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(share,base+'/app/releases/'+release.id+'?readOnly=1');
  await navigate(page,share);await page.getByText('Read-only workspace view',{exact:true}).waitFor();assert.equal(await page.getByText('Edit release',{exact:true}).count(),0);await inspect(page.locator('.release-page'),'release-share');
  await navigate(page,base+'/app/issues/'+issues[0].identifier);
  const chip=page.getByRole('region',{name:'Issue releases',exact:true});await chip.getByRole('link',{name:'2.4 · Released',exact:true}).waitFor();await inspect(chip,'release-issue-chip');
  if(!memberFixture){
   const email='synthetic-vector-1756@example.test';
   await call('/settings/operators/invite','POST',{displayName:'synthetic-vector-1756',email,role:'member'},202);
   const signed=await confirmLink(await readDevelopmentLink(base,null,email,runtime.state));assert.equal(signed.status,303);
   const cookie=signed.headers.get('set-cookie').split(';')[0];
   const guestHeaders={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
   const session=await(await runtime.req('/api/session',{headers:guestHeaders})).json();
   memberFixture={cookie,guestHeaders,session};
  }else await call('/settings/operators/'+memberFixture.session.operatorId+'/role','PATCH',{role:'member',teamIds:[]});
  const {cookie,guestHeaders,session}=memberFixture;
  const scopedToken=await runtime.req('/api/settings/integrations/tokens',{method:'POST',headers:guestHeaders,body:JSON.stringify({name:'synthetic-vector-1757',scopes:['releases:read','releases:write']})});assert.equal(scopedToken.status,201);const guestToken=(await scopedToken.json()).token;
  const memberShare=await runtime.req('/app/releases/'+release.id+'?readOnly=1',{redirect:'follow',headers:guestHeaders});assert.equal(memberShare.status,200);await memberShare.body.cancel();
  const memberPage=await openAuthenticatedPage(page.context().browser(),cookie,base);
  memberPage.on('pageerror',e=>errors.push(e.message));
  try{await memberPage.goto(share);await memberPage.getByText('Read-only workspace view',{exact:true}).waitFor();await memberPage.getByRole('heading',{name:'2.4',exact:true}).waitFor();assert.equal(await memberPage.getByText('Edit release',{exact:true}).count(),0);await settleReads(memberPage);}finally{await memberPage.context().close();}
  await call('/settings/operators/'+session.operatorId+'/role','PATCH',{role:'guest',teamIds:[team.id]});
  const refusal=await runtime.req('/api/releases',{method:'POST',headers:guestHeaders,body:JSON.stringify({name:'Guest release'})});assert.equal(refusal.status,403);await refusal.body.cancel();
  const deniedApi=await runtime.req('/api/v1/releases',{method:'POST',headers:{Origin:base,Authorization:'Bearer '+guestToken,'Content-Type':'application/json'},body:JSON.stringify({name:'Guest release'})});assert.equal(deniedApi.status,403);await deniedApi.body.cancel();
  const deniedPage=await runtime.req('/app/releases/'+release.id,{headers:guestHeaders});assert.equal(deniedPage.status,403);await deniedPage.body.cancel();
  await settleReads(page);
 }
 assert.deepEqual(errors,[],'release screens have no hydration or browser errors');
 }finally{await settleReads(page);await page.close();}
}
