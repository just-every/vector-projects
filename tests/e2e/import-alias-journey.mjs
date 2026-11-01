import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {navigate,settleReads} from './collaboration-navigation.mjs';
import {roleScreens} from './role-ui-support.mjs';
/** The alias journey runs its assertions at desktop width and records the
 * affected native screens once at desktop and phone widths. */
export async function exerciseImportAliases({page,runtime,cookie,evidence}) {
 const headers={Cookie:cookie,Origin:runtime.base,'Content-Type':'application/json'};
 const call=async(path,method='GET',body,status=200)=>{
  const response=await runtime.req('/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(response.status,status,await response.clone().text());return response.json();
 };
 const inspect=roleScreens(evidence);
 await page.setViewportSize({width:1440,height:1000});
 const options=await call('/data/import/options'),team=options.references.teams.find(row=>!row.archived_at),status=options.references.statuses.find(row=>row.team_id===team.id&&row.category==='unstarted');
 const native=await call('/issues','POST',{teamId:team.id,title:'synthetic-vector-1820 native collision'},201);
 const csv=[['ID','Title','Description','Team','Status','Original URL'],['ENG-123','synthetic-vector-1821 imported login','',team.name,status.name,''],[native.identifier,'synthetic-vector-1822 collision','',team.name,status.name,''],['GH-42','synthetic-vector-1825 GitHub source','',team.name,status.name,'https://github.com/octocat/hello-world/issues/42'],['PROJ-45','synthetic-vector-1826 Jira source','',team.name,status.name,'']].map((row,index)=>index===0?[...row,'Estimate','Priority','Project','Assignee','Labels','Cycle Name','Created','Updated','Due Date','Parent issue','Archived']:[...row,...Array(11).fill('')]).map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\n');
 const input={format:'linear-csv',source:'synthetic-vector-1823',name:'linear.csv',base64:Buffer.from(csv).toString('base64'),mapping:{sourceUrl:'Original URL'}};
 const review=await call('/data/import/preview','POST',input);assert.equal(review.ready,true);
 let run=await call('/data/import/apply','POST',{input:{...input,effectiveAt:review.effectiveAt},reviewedFingerprint:review.fingerprint,operationKey:'review:'+review.fingerprint,acknowledgeOmissions:true});
 for(let n=0;run.state!=='completed';n++){assert(n<20);run=await call('/data/import/runs/'+run.id+'/resume','POST',{});}
 const url='https://linear.app/synthetic-vector-1823/issue/ENG-123/login';
 const found=(await call('/search?q='+encodeURIComponent(url))).issues;assert.equal(found.length,1);const imported=found[0];
 for(const [sourceUrl,title] of [['https://github.com/octocat/hello-world/issues/42','synthetic-vector-1825 GitHub source'],['https://synthetic-vector-1823.atlassian.net/browse/PROJ-45','synthetic-vector-1826 Jira source']]) {
  const target=(await call('/search?q='+encodeURIComponent(sourceUrl))).issues;assert.equal(target.length,1);assert.equal(target[0].title,title);
  await navigate(page,runtime.base+'/app/search');await page.getByRole('searchbox',{name:'Search workspace',exact:true}).fill(sourceUrl);
  await page.getByRole('link',{name:target[0].identifier+' '+title,exact:true}).click();await page.waitForURL('**/app/issues/'+target[0].identifier);
  await page.locator('h1:visible').first().click();await page.keyboard.press('Control+k');
  const sourcePalette=page.getByRole('dialog',{name:'Command palette',exact:true});await sourcePalette.getByRole('textbox').fill(sourceUrl);
  await sourcePalette.getByRole('option').filter({hasText:target[0].identifier}).waitFor();await page.keyboard.press('Enter');await page.waitForURL('**/app/issues/'+target[0].identifier);
  await page.goto(runtime.base+'/app/issues/'+(title.includes('GitHub')?'GH-42':'PROJ-45'));await page.waitForURL('**/app/issues/'+target[0].identifier);
 }
 await navigate(page,runtime.base+'/app/search');await page.getByRole('searchbox',{name:'Search workspace',exact:true}).fill(url);
 const result=page.getByRole('link',{name:imported.identifier+' '+imported.title,exact:true});await result.waitFor();
 await inspect(page,page.locator('main').last(),'alias-source-search');await page.setViewportSize({width:1440,height:1000});
 await result.click();await page.waitForURL('**/app/issues/'+imported.identifier);await page.getByRole('heading',{name:imported.title,exact:true}).waitFor();
 await page.goto(runtime.base+'/app/issues/ENG-123');await page.waitForURL('**/app/issues/'+imported.identifier);
 await page.goto(runtime.base+'/alias/ENG-123');await page.waitForURL('**/app/issues/'+imported.identifier);await page.getByRole('heading',{name:imported.title,exact:true}).waitFor();
 // The palette shares the same visible identity lookup.
 await page.locator('h1:visible').first().click();await page.keyboard.press('Control+k');
 const palette=page.getByRole('dialog',{name:'Command palette',exact:true});await palette.getByRole('textbox').fill(url);
 await palette.getByRole('option').filter({hasText:imported.identifier}).waitFor();await page.keyboard.press('Enter');await page.waitForURL('**/app/issues/'+imported.identifier);
 const config=await call('/settings/integrations/github','POST',{name:'synthetic-vector-1824',repository:'octocat/hello-world'},201);
 const admin=await call('/settings/administration'),targetTeam=admin.teams.find(row=>row.id===team.id),done=targetTeam.statuses.find(row=>row.category==='completed');
 const rules=await call('/github/automation'),rule=rules.teams.find(row=>row.id===team.id).rules.find(row=>row.trigger==='merged');
 await call('/settings/teams/'+team.id,'PATCH',{githubAutomation:{trigger:'merged',statusId:done.id,allowReopen:false,expectedVersion:rule.version}});
 const body={action:'closed',number:188,repository:{full_name:'octocat/hello-world'},pull_request:{number:188,title:'Fixes ENG-123',body:'Fixes ENG-123',head:{ref:'eng-123-fix-login'},state:'closed',merged:true,updated_at:'2026-10-12T00:00:00.000Z',html_url:'https://github.com/octocat/hello-world/pull/188'}},text=JSON.stringify(body),delivery=randomUUID();
 const send=async()=>{const response=await runtime.req(new URL(config.receiver).pathname,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256',config.secret).update(text).digest('hex'),'X-GitHub-Delivery':delivery,'X-GitHub-Event':'pull_request'},body:text});assert.equal(response.status,200,await response.clone().text());return response.json();};
 await send();const completed=await call('/issues/'+imported.identifier);assert.equal(completed.status.id,done.id);await send();assert.equal((await call('/issues/'+imported.identifier)).version,completed.version);
 await navigate(page,runtime.base+'/app/issues/'+imported.identifier);await page.getByRole('link',{name:'Fixes ENG-123 · octocat/hello-world #188',exact:true}).waitFor();
 await inspect(page,page.locator('.issue-inspector'),'alias-linked-issue');await page.setViewportSize({width:1440,height:1000});
 await navigate(page,runtime.base+'/app/settings/move-in');
 const aliases=page.getByRole('region',{name:'Imported aliases',exact:true});await aliases.getByLabel('ENG aliases active',{exact:true}).waitFor();
 await aliases.getByLabel('ENG aliases active',{exact:true}).uncheck();await aliases.getByRole('status').getByText('ENG aliases disabled.',{exact:true}).waitFor();
 assert.equal((await runtime.req('/alias/ENG-123',{headers:{Cookie:cookie}})).status,404);
 assert.deepEqual((await call('/search?q='+encodeURIComponent(url))).issues,[]);
 await aliases.getByLabel('ENG aliases active',{exact:true}).check();await aliases.getByRole('status').getByText('ENG aliases enabled.',{exact:true}).waitFor();
 await inspect(page,aliases,'alias-prefix-settings');await page.setViewportSize({width:1440,height:1000});
 const report=await call('/data/import/runs/'+run.id+'/report');assert.equal(report.aliasCollisions.length,1);assert.equal(report.aliasCollisions[0].nativeIdentifier,native.identifier);
 const row=page.locator('.import-runs>li').filter({hasText:run.id});
 await row.getByRole('button',{name:'Reconciliation report',exact:true}).click();
 const shown=row.getByRole('region',{name:'Reconciliation report: synthetic-vector-1823',exact:true});await shown.getByRole('heading',{name:'Alias collisions',exact:true}).waitFor();
 await inspect(page,shown,'alias-collision-report');await page.setViewportSize({width:1440,height:1000});
 assert.equal((await runtime.req('/alias/'+native.identifier,{headers:{Cookie:cookie}})).headers.get('Location'),'/app/issues/'+native.identifier);
 await settleReads(page);
 await call('/settings/integrations/github/'+config.id,'DELETE');
}
