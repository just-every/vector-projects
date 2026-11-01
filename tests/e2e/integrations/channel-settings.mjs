import { withOperatorClient } from '../operator-request.mjs';
import assert from 'node:assert/strict';
import {readDevelopmentLink} from '../outbox-session.mjs';
import {roleScreens} from '../role-ui-support.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export async function exerciseChannels({page,runtime,cookie,team,width,evidence}){
 const panel=page.locator('.channel-settings'),headers={Origin:runtime.base};
 const calls=async()=>{try{return(await readFile(process.env.VECTOR_CHANNEL_EDGE,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return[];}};
 const send=async(path,method,data)=>{return withOperatorClient(page.context(), async client => {
const response=await client.fetch(runtime.base+'/api'+path,{method,headers,data});assert.ok(response.ok(),method+' '+path+' '+response.status());return await response.json();
});};
 const shot=async(name)=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');await page.screenshot({path:resolve(evidence,`slack-003-${name}-${width}.png`)});};
 const axe=async(selector='.channel-settings')=>{await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});const result=await page.evaluate(selector=>axe.run(document.querySelector(selector)),selector);assert.deepEqual(result.violations.filter(v=>['critical','serious'].includes(v.impact)),[]);};
 await panel.getByRole('heading',{name:'Slack and Discord channels',exact:true}).waitFor();
 const details=panel.locator('details').filter({has:page.getByRole('form',{name:'Slack credential',exact:true,includeHidden:true})});await details.locator('summary').click();await panel.getByRole('form',{name:'Slack credential'}).waitFor();await panel.scrollIntoViewIfNeeded();await shot('credential');
 await panel.getByLabel('Slack bot token',{exact:true}).fill('synthetic-browser-slack-credential-'+width);
 const saved=page.waitForResponse(r=>r.url().endsWith('/settings/integrations/slack')&&r.request().method()==='POST');await panel.getByRole('button',{name:'Validate and save Slack token'}).click();assert.equal((await saved).status(),200);
 await panel.getByText('Slack connected to Delivery workspace',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Slack bot token').inputValue(),'');
 const admin=await send('/settings/administration','GET');const owner=admin.operators[0];
 await runtime.writeFixture([{sql:'DELETE FROM vector_integration_secret_keys WHERE identity=?',params:['slack:'+admin.workspace.id]}]);await page.reload();await panel.getByText('Slack needs attention. Re-enter the bot token.',{exact:true}).waitFor();await panel.getByText('Slack needs attention. Re-enter the bot token.',{exact:true}).evaluate(element=>element.scrollIntoView({block:'center'}));await shot('needs-attention');
 await send('/settings/integrations/slack','POST',{botToken:'synthetic-browser-slack-credential-'+width});await page.reload();await panel.getByText('Slack connected to Delivery workspace',{exact:true}).waitFor();
 const name='Checkout delivery '+width;
 await page.goto(runtime.base+'/app/projects');await page.getByRole('button',{name:'New project',exact:true}).click();
 const create=page.getByRole('form',{name:'Create project',exact:true});await create.getByLabel('Project name',{exact:true}).fill(name);await create.getByRole('combobox',{name:'Project lead',exact:true}).selectOption(owner.id);await create.getByLabel('Create Slack channel',{exact:true}).check();await create.getByLabel('Create Slack channel',{exact:true}).scrollIntoViewIfNeeded();await shot('create-project');await axe('form[aria-label="Create project"]');
 const createdResponse=page.waitForResponse(r=>r.url().endsWith('/settings/projects')&&r.request().method()==='POST');await create.getByRole('button',{name:'Create project',exact:true}).click();assert.equal((await createdResponse).status(),200);
 const project=(await send('/settings/administration','GET')).projects.find(p=>p.name===name);assert.ok(project);
 assert.equal((await calls()).filter(c=>c.method==='conversations.create'&&c.body.name==='checkout-delivery-'+width).length,1);
 await page.goto(runtime.base+'/app/settings/connections');await panel.getByText(name,{exact:true}).waitFor();await panel.getByText(name,{exact:true}).scrollIntoViewIfNeeded();await shot('bound-slack');await axe();
 const config=await send('/settings/integrations/channels','GET');assert.equal(config.bindings.find(b=>b.objectId===project.id).channelName,'checkout-delivery-'+width);
 const allowance=panel.getByRole('form',{name:'Allow project channel',exact:true});
 await allowance.getByLabel('Allowed channel name',{exact:true}).fill('member-delivery-'+width);await allowance.getByLabel('Allowed Slack channel ID',{exact:true}).fill('CALLOWED'+width);
 const allowed=page.waitForResponse(r=>r.url().endsWith('/settings/integrations/channels/allowed')&&r.request().method()==='POST');await allowance.getByRole('button',{name:'Allow channel',exact:true}).click();assert.equal((await allowed).status(),201);await panel.getByText('Channel allowed for project creators.',{exact:true}).waitFor();await shot('allowed-project-channel');await roleScreens(evidence)(page,allowance,'allow-project-channel-'+width);
 const email=`synthetic-vector-${width}@vector.test`;
 await send('/settings/operators/invite','POST',{email,displayName:'Delivery member '+width,role:'member'});
 const link=await readDevelopmentLink(runtime.base,page.request,email,runtime.state);
 const memberContext=await page.context().browser().newContext({storageState:await page.context().storageState(),viewport:{width,height:900}});
 let issue;
 try{
  const member=await memberContext.newPage();await member.goto(link);await member.getByRole('button',{name:'Confirm',exact:true}).click();await member.waitForURL(runtime.base+'/app');
  await member.goto(runtime.base+'/app/projects/'+project.id);await member.getByText('Project Slack channel',{exact:true}).click();
  const choice=member.getByRole('form',{name:'Project Slack channel',exact:true}),channelId='CALLOWED'+width;
  const options=await member.request.get(runtime.base+'/api/projects/'+project.id+'/slack-channel');assert.equal(options.status(),200);
  await choice.getByRole('combobox').selectOption(channelId);
  const inspect=roleScreens(evidence);await inspect(member,member.locator('.project-management'),'member-project-channel-choice-'+width);
  const forbiddenBefore=(await calls()).length;
  assert.equal((await member.request.post(runtime.base+'/api/projects/'+project.id+'/slack-channel',{headers,data:{channelId:'CUNAPPROVED'}})).status(),403);
  assert.equal((await calls()).length,forbiddenBefore,'unapproved channel makes no Slack call');
  const bound=member.waitForResponse(r=>r.url().endsWith('/projects/'+project.id+'/slack-channel')&&r.request().method()==='POST');
  await choice.getByRole('button',{name:'Bind project channel',exact:true}).click();assert.equal((await bound).status(),201);
  await member.getByText('Bound to #member-delivery-'+width,{exact:true}).waitFor();await member.getByText('Project channel bound.',{exact:true}).waitFor();assert.equal(await member.locator('.project-management [role=alert]').count(),0);await inspect(member,member.locator('.project-management'),'member-project-channel-bound-'+width);
  const created=await member.request.post(runtime.base+'/api/issues',{headers,data:{title:'Enable customer checkout '+width,teamId:team.id,projectId:project.id,statusId:team.statuses.find(s=>s.category==='unstarted').id}});assert.equal(created.status(),201);issue=await created.json();
 }catch(error){console.error('Member project settings:',await memberContext.pages().at(-1)?.locator('.project-management').innerText());await memberContext.pages().at(-1)?.screenshot({path:resolve(evidence,'member-channel-failure-'+width+'.png')});throw error;}finally{await memberContext.close();}
 await send('/issues/'+issue.identifier,'PATCH',{expectedVersion:issue.version,statusId:team.statuses.find(s=>s.category==='started').id});
 for(let i=0;i<2;i++){const tick=await page.request.get(runtime.base+'/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *'));assert.equal(tick.status(),200);await tick.body();}
 const posts=(await calls()).filter(c=>c.method==='chat.postMessage'&&c.body.text.includes(issue.identifier));assert.equal(posts.length,2);assert.ok(posts.every(post=>post.body.channel==='CALLOWED'+width));assert.ok(posts[1].body.text.includes(team.statuses.find(s=>s.category==='unstarted').name+' → '+team.statuses.find(s=>s.category==='started').name));
 const form=panel.getByRole('form',{name:'Bind notification channel'});await form.getByLabel('Team, project, saved view or initiative').selectOption('project:'+project.id);await form.getByLabel('Channel service').selectOption('discord');await form.getByLabel('Channel display name').fill('checkout-discord');await form.getByLabel('Discord webhook URL').fill('https://discord.com/api/webhooks/123/synthetic-browser-discord');
 await form.getByLabel('Discord webhook URL').evaluate(element=>element.scrollIntoView({block:'center'}));await shot('discord-form');const bindingResponse=page.waitForResponse(r=>r.url().endsWith('/settings/integrations/channels')&&r.request().method()==='POST');await form.getByRole('button',{name:'Save channel binding'}).click();assert.equal((await bindingResponse).status(),201);
 const discordIssue=await send('/issues','POST',{title:'Discord rollout '+width,teamId:team.id,projectId:project.id,statusId:team.statuses.find(s=>s.category==='unstarted').id});
 for(let i=0;i<2;i++){const tick=await page.request.get(runtime.base+'/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *'));assert.equal(tick.status(),200);await tick.body();}
 assert.equal((await calls()).filter(c=>c.method==='discord'&&c.body.content.includes(discordIssue.identifier)).length,1);
 await page.reload();await panel.getByText('Discord #checkout-discord',{exact:false}).waitFor();await panel.getByText(name,{exact:true}).scrollIntoViewIfNeeded();await shot('bound-discord');await axe();
 const removed=page.waitForResponse(r=>r.url().includes('/settings/integrations/channels/')&&r.request().method()==='DELETE');await panel.getByRole('button',{name:'Remove binding for '+name,exact:true}).click();assert.equal((await removed).status(),200);await panel.getByRole('button',{name:'Remove binding for '+name,exact:true}).waitFor({state:'hidden'});await panel.getByText('A new binding replaces',{exact:false}).evaluate(element=>element.scrollIntoView({block:'center'}));await shot('unbound');
 await form.getByLabel('Team, project, saved view or initiative').selectOption('team:'+team.id);await form.getByLabel('Channel service').selectOption('slack');await form.getByLabel('Channel display name').fill('needs-channel-membership');await form.getByLabel('Slack channel ID').fill('CREFUSED');
 const refusalBinding=page.waitForResponse(r=>r.url().endsWith('/settings/integrations/channels')&&r.request().method()==='POST');await form.getByRole('button',{name:'Save channel binding'}).click();assert.equal((await refusalBinding).status(),201);
 await send('/issues','POST',{title:'Check channel membership '+width,teamId:team.id,statusId:team.statuses.find(s=>s.category==='unstarted').id});
 const refusalTick=await page.request.get(runtime.base+'/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *'));assert.equal(refusalTick.status(),200);await refusalTick.body();
 // The suspended routing is on Connections; the refused delivery is in the delivery history on Developers.
 await page.goto(runtime.base+'/app/settings/connections');await panel.getByRole('alert').filter({hasText:'Routing suspended'}).evaluate(element=>element.scrollIntoView({block:'center'}));await shot('routing-suspended');
 await page.goto(runtime.base+'/app/settings/developers');const failure=page.getByText(/Slack refused this message \(not_in_channel\)/).first();await failure.waitFor();await failure.evaluate(element=>element.scrollIntoView({block:'center'}));await shot('delivery-failure');await page.goto(runtime.base+'/app/settings/connections');await panel.waitFor();
 await form.getByLabel('Team, project, saved view or initiative').selectOption('team:'+team.id);await form.getByLabel('Channel display name').fill('confirmed-delivery');await form.getByLabel('Slack channel ID').fill('CDELIVERY');
 const confirmed=page.waitForResponse(r=>r.url().endsWith('/settings/integrations/channels')&&r.request().method()==='POST');await form.getByRole('button',{name:'Save channel binding'}).click();assert.equal((await confirmed).status(),201);
 const resumed=await send('/issues','POST',{title:'Confirm delivery access '+width,teamId:team.id,statusId:team.statuses.find(s=>s.category==='unstarted').id});
 const resumedTick=await page.request.get(runtime.base+'/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *'));assert.equal(resumedTick.status(),200);await resumedTick.body();assert.equal((await calls()).filter(c=>c.method==='chat.postMessage'&&c.body.text.includes(resumed.identifier)).length,1);
 const failedBinding=(await send('/settings/integrations/channels','GET')).bindings.find(b=>b.scope==='team'&&b.objectId===team.id);await send('/settings/integrations/channels/'+failedBinding.id,'DELETE');
 await page.goto(runtime.base+'/app/settings/teams');await page.getByRole('button',{name:'New team',exact:true}).click();const teamForm=page.getByRole('form',{name:'Create team',exact:true});await teamForm.getByLabel('Team name',{exact:true}).fill('Customer operations');await teamForm.getByLabel('Identifier prefix',{exact:true}).fill('CUST');await teamForm.locator('label.switch-row').filter({hasText:'Create Slack channel'}).click();await teamForm.getByLabel('Create Slack channel',{exact:true}).evaluate(element=>element.scrollIntoView({block:'center'}));await shot('create-team');await axe('form[aria-label="Create team"]');
 await page.goto(runtime.base+'/app/settings/connections');const removedSlack=page.waitForResponse(r=>r.url().endsWith('/settings/integrations/slack')&&r.request().method()==='DELETE');await panel.getByRole('button',{name:'Remove Slack connection',exact:true}).click();assert.equal((await removedSlack).status(),200);await panel.getByText('Slack is not connected.',{exact:true}).waitFor();await panel.getByText('Slack is not connected.',{exact:true}).evaluate(element=>element.scrollIntoView({block:'center'}));await shot('connection-removed');
 await initiativeApprovalOutcomes({page,runtime,send,width});
}


/** Outcomes remain next to the control and truthful through a stale list and a repeated approval. */
export async function initiativeApprovalOutcomes({page,runtime,send,width}){
 await page.setViewportSize({width,height:width===390?844:1000});
 const panel=page.locator('.channel-settings'),approval=panel.getByRole('form',{name:'Approve initiative channel',exact:true});
 const owner=(await send('/settings/administration','GET')).viewer.id;
 const initiative=await send('/initiatives','POST',{name:'synthetic-vector-1851-'+width,ownerOperatorId:owner});
 const project=(await send('/settings/projects','POST',{name:'synthetic-vector-1852-'+width,leadOperatorId:owner})).projects.find(p=>p.name==='synthetic-vector-1852-'+width);
 const source=await send('/settings/integrations/channels','POST',{scope:'project',objectId:project.id,provider:'discord',channelName:'gate-c45p-src-south',webhookUrl:'https://discord.com/api/webhooks/1853/synthetic-vector-1854',events:['issue.created']});
 await page.reload();await approval.waitFor();
 const select=approval.getByLabel('Existing channel',{exact:true}),choose=async()=>{await approval.getByLabel('Initiative to approve for',{exact:true}).selectOption(initiative.id);await select.selectOption('discord:'+source.id);};
 const submit=async(status,changed)=>{
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/channels/initiative-approvals'));
  await approval.getByRole('button',{name:'Approve channel for initiative',exact:true}).click();const result=await response;assert.equal(result.status(),status);if(changed!==undefined)assert.equal((await result.json()).changed,changed);
  const outcome=panel.locator('.initiative-approval-outcome');await outcome.waitFor();
  await page.waitForFunction(()=>document.activeElement?.classList.contains('initiative-approval-outcome'));
  const measured=await outcome.evaluate(element=>{const box=element.getBoundingClientRect();return {text:element.textContent,top:box.top,bottom:innerHeight-box.bottom,focused:document.activeElement===element};});
  assert.ok(measured.top>=0&&measured.bottom>=0,'approval outcome is in the viewport');assert.ok(measured.focused);
  console.log('INIT-001 approval outcome',JSON.stringify({width,status,...measured}));
 };
 await choose();await submit(201,true);
 const rows=runtime.sql("SELECT * FROM vector_initiative_destination_approvals WHERE initiative_id='"+initiative.id+"'"),audits=runtime.sql("SELECT id FROM audit_records WHERE action='channel.initiative_destination_approved' AND subject_id='"+initiative.id+"'");
 await choose();await submit(201,false);
 assert.deepEqual(runtime.sql("SELECT * FROM vector_initiative_destination_approvals WHERE initiative_id='"+initiative.id+"'"),rows);
 assert.deepEqual(runtime.sql("SELECT id FROM audit_records WHERE action='channel.initiative_destination_approved' AND subject_id='"+initiative.id+"'"),audits);
 const scoped=await send('/initiatives/'+initiative.id+'/channel-binding','PUT',{provider:'discord',channelId:'1853',events:['initiative.updated'],expectedVersion:null});
 await page.reload();await approval.waitFor();
 assert.equal(await select.locator('option[value="discord:'+scoped.id+'"]').count(),0);
 assert.equal(await select.locator('option[value="discord:'+source.id+'"]').count(),1);
 console.log('INIT-001 approval options',JSON.stringify({width,unfilteredDiscord:(await send('/settings/integrations/channels','GET')).bindings.filter(b=>b.provider==='discord').length,offeredDiscord:await select.locator('option[value^="discord:"]').count(),kept:source.id,excluded:scoped.id}));
 // A concurrent withdrawal leaves this browser's row stale; its response must reload that list.
 const row=(await send('/settings/integrations/channels','GET')).approvals.find(a=>a.initiativeId===initiative.id);
 await send('/settings/integrations/channels/initiative-approvals/'+row.id,'DELETE');
 const withdraw=panel.getByRole('button',{name:'Withdraw approval for '+initiative.name+' #gate-c45p-src-south',exact:true});
 const withdrawn=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().endsWith('/initiative-approvals/'+row.id));await withdraw.click();assert.equal((await withdrawn).status(),404);
 await panel.locator('.initiative-approval-outcome').waitFor();await withdraw.waitFor({state:'detached'});
 assert.ok(!(await page.locator('body').innerText()).includes('approval_not_found'));
 console.log('INIT-001 concurrent withdrawal',JSON.stringify({width,text:await panel.locator('.initiative-approval-outcome').innerText(),remaining:await withdraw.count()}));
 await choose();
 console.log('INIT-001 approval geometry',JSON.stringify(await approval.evaluate((form)=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,fields:[...form.querySelectorAll('select')].map(select=>({label:select.getAttribute('aria-label'),width:select.clientWidth,scrollWidth:select.scrollWidth,border:getComputedStyle(select).borderWidth,height:select.getBoundingClientRect().height,options:[...select.options].map(option=>{const style=getComputedStyle(select),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=style.font;return {text:option.text,scrollWidth:option.scrollWidth,clientWidth:option.clientWidth,textWidth:context.measureText(option.text).width,availableWidth:select.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)};})})),detail:form.querySelector('#approval-destination-detail').textContent}))));
 await send('/settings/integrations/channels/'+source.id,'DELETE');
 await submit(404);
}
