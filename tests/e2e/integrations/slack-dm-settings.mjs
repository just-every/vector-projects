import { withOperatorClient } from '../operator-request.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {confirmLink} from '../outbox-session.mjs';
import {mentionToken} from '../../../src/core/features/notifications/mention-token.ts';
import {exerciseNotificationChannelControls,inspectMemberNotificationChannels} from './notification-channel-controls.mjs';
const require=createRequire(import.meta.url);
/** SLACK-004 and NOTIFY-007 in the built Worker: Settings → Notifications linking states, the signing-secret
 * field in Settings → Integrations, and one teammate mention that reaches the Slack edge as a DM. */
export async function exerciseSlackDirectMessages({page,runtime,width,evidence}){
 await page.setViewportSize({width,height:900});
 const usersFile=process.env.VECTOR_CHANNEL_EDGE+'.users',headers={Origin:runtime.base};
 const calls=async()=>{try{return(await readFile(process.env.VECTOR_CHANNEL_EDGE,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return[];}};
 const send=async(path,method,data)=>{return withOperatorClient(page.context(), async client => {
const response=await client.fetch(runtime.base+'/api'+path,{method,headers,data});assert.ok(response.ok(),method+' '+path+' '+response.status());return await response.json();
});};
 const shot=async(name,locator)=>{const surface=locator.page();await locator.evaluate(element=>element.scrollIntoView({block:'center'}));assert.equal(await surface.evaluate(()=>innerWidth),width,'capture viewport matches its evidence width');assert.ok(await surface.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');await surface.screenshot({path:resolve(evidence,`slack-004-${name}-${width}.png`)});};
 const axe=async(selector,surface=page)=>{await surface.addScriptTag({path:require.resolve('axe-core/axe.min.js')});const result=await surface.evaluate(selector=>axe.run(document.querySelector(selector)),selector);assert.deepEqual(result.violations.filter(v=>['critical','serious'].includes(v.impact)),[]);};
 const answered=async(path,method,action)=>{
  const [response]=await Promise.all([
   page.waitForResponse(r=>new URL(r.url()).pathname==='/api'+path&&r.request().method()===method),
   Promise.resolve().then(action),
  ]);
  assert.equal(response.status(),200,method+' '+path);return response;
 };
 const links=()=>runtime.sql('SELECT count(*) AS n FROM vector_slack_member_links')[0].n;
 const owner=runtime.sql("SELECT o.id,o.name,a.email FROM operators o JOIN vector_auth_operators m ON m.operator_id=o.id JOIN oa_operators a ON a.id=m.auth_id WHERE o.removed_at IS NULL ORDER BY o.created_at LIMIT 1")[0];
 const region=page.getByRole('region',{name:'Notifications',exact:true}),slack=region.locator('.slack-direct-messages');
 const matrix=region.getByRole('table',{name:'Your notification channels',exact:true});
 const mentions=matrix.getByRole('checkbox',{name:'Slack for Mentions',exact:true});
 const assignments=matrix.getByRole('checkbox',{name:'Slack for Assignments',exact:true});
 const chooseSlack=async(control,checked)=>{
  if(await control.isChecked()===checked)return;
  await control.evaluate(element=>element.scrollIntoView({block:'center'}));
  await answered('/settings/notifications/channels','PUT',()=>control.click());
  await region.locator('.notification-channels').getByRole('status').filter({hasText:'Notification channels saved.'}).waitFor();
  assert.equal(await control.isChecked(),checked,'Slack choice follows the saved response');
 };
 await writeFile(usersFile,'{}');
 // Unavailable, with its reason, while the workspace has no Slack credential.
 await page.goto(runtime.base+'/app/settings/notifications');await slack.getByText(/Slack direct messages are unavailable/).waitFor();
 assert.equal(await mentions.isDisabled(),true);await shot('unavailable',slack.getByText(/Slack direct messages are unavailable/));await axe('.notifications-panel');
 await exerciseNotificationChannelControls({page,region,send,answered,shot,axe});
 await send('/settings/integrations/slack','POST',{botToken:'synthetic-vector-'+(7000+width)});
 // Unlinked, with Assign to me and Change status off until the signing secret is entered.
 await page.reload();const link=slack.getByRole('button',{name:'Link Slack',exact:true});await link.waitFor();
 await slack.getByText(/off until an Admin enters the Slack signing secret/).waitFor();assert.equal(await mentions.isDisabled(),true);await shot('unlinked-actions-off',slack.locator('.slack-direct-link'));await axe('.notifications-panel');
 // No match: the message is shown and nothing is stored.
 await answered('/settings/notifications/slack/lookup','POST',()=>link.click());await slack.getByText('No Slack account found for this email',{exact:true}).waitFor();
 assert.equal(links(),0);await shot('no-match',slack.getByText('No Slack account found for this email',{exact:true}));await axe('.notifications-panel');
 // The member's own sign-in email finds their Slack account, shown for confirmation.
 const slackUser='USARAH'+width;await writeFile(usersFile,JSON.stringify({[owner.email]:{id:slackUser,team_id:'TDELIVERY',name:'sarah',real_name:owner.name,profile:{display_name:owner.name.split(' ')[0],real_name:owner.name}}}));
 await answered('/settings/notifications/slack/lookup','POST',()=>link.click());const confirm=slack.getByRole('group',{name:'Confirm your Slack account',exact:true});await confirm.waitFor();
 assert.equal(links(),0,'lookup stores nothing before confirmation');await shot('confirm',confirm);await axe('.notifications-panel');
 await answered('/settings/notifications/slack/link','POST',()=>confirm.getByRole('button',{name:'Confirm Slack link',exact:true}).click());
 await slack.getByRole('button',{name:'Unlink Slack',exact:true}).waitFor();assert.equal(links(),1);
 await chooseSlack(mentions,false);await chooseSlack(mentions,true);
 await chooseSlack(assignments,false);await chooseSlack(assignments,true);await chooseSlack(assignments,false);
 assert.equal(await mentions.isChecked(),true);await shot('linked',slack.locator('.slack-direct-link'));await axe('.notifications-panel');
 // The Admin enters a generated signing secret beside the bot token.
 await page.goto(runtime.base+'/app/settings/connections');
 const channels=page.locator('.channel-settings'),details=channels.locator('details').filter({has:page.getByRole('form',{name:'Slack credential',exact:true,includeHidden:true})});if(!await details.evaluate(element=>element.open))await details.locator('summary').click();
 const secret=crypto.randomUUID().replaceAll('-',''),field=channels.getByLabel('Slack signing secret',{exact:true});await field.fill(secret);await shot('signing-secret',field);await axe('.channel-settings');
 await answered('/settings/integrations/slack/signing-secret','POST',()=>channels.getByRole('button',{name:'Save signing secret',exact:true}).click());
 const actions=channels.locator('.slack-direct-actions');await actions.getByText(/Assign to me and Change status are on/).waitFor();
 assert.ok(await field.inputValue()==='','Saving clears the signing secret field');
 assert.equal(await channels.getByLabel('Interactivity Request URL',{exact:true}).inputValue(),runtime.base+'/api/integrations/slack/interactive');await shot('actions-on',actions);await axe('.channel-settings');
 assert.ok(!JSON.stringify(await send('/settings/integrations/channels','GET')).includes(secret),'the signing secret is never read back');
 // A teammate mentions the member: one DM at the Slack edge with the three actions.
 const teammate=runtime.sql("SELECT o.id,a.email FROM operators o JOIN vector_auth_operators m ON m.operator_id=o.id JOIN oa_operators a ON a.id=m.auth_id WHERE o.removed_at IS NULL AND a.status='active' AND o.role='member' AND o.id<>'"+owner.id+"' ORDER BY o.created_at LIMIT 1")[0];
 assert.equal((await runtime.req('/auth/request',{method:'POST',headers:{Origin:runtime.base,'Content-Type':'application/json'},body:JSON.stringify({email:teammate.email,returnTo:'/app'})})).status,202);
 const signInLink=runtime.sql(`SELECT json_extract(message,'$.text') AS text FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='${teammate.email}' ORDER BY created_at DESC,sequence DESC LIMIT 1`)[0].text.match(/https?:\/\/[^\s]+/)[0];
 const signed=await confirmLink(signInLink);assert.equal(signed.status,303);const teammateCookie=signed.headers.get('set-cookie').split(';')[0];
 await inspectMemberNotificationChannels({page,runtime,teammateCookie,width,shot,axe});
 const team=(await send('/settings/administration','GET')).teams.find(row=>!row.archivedAt);
 const created=await runtime.req('/api/issues',{method:'POST',headers:{Cookie:teammateCookie,Origin:runtime.base,'Content-Type':'application/json'},body:JSON.stringify({title:'Review checkout copy '+width,teamId:team.id,description:'Please review '+mentionToken({id:owner.id,name:owner.name})+' PRIVATE_BROWSER_BODY',dueDate:'2026-12-01'})});
 assert.equal(created.status,201);const issue=await created.json();
 const dms=(await calls()).filter(call=>call.method==='chat.postMessage'&&call.body.channel==='D'+slackUser.slice(1)&&call.body.text.includes(issue.identifier));
 assert.equal(dms.length,1);const dm=dms[0].body;
 assert.deepEqual(dm.blocks.at(-1).elements.map(element=>element.action_id),['vector_open','vector_assign_me','vector_change_status']);
 assert.equal(dm.blocks.at(-1).elements[0].url,runtime.base+'/app/issues/'+issue.identifier);assert.equal(dm.unfurl_links,false);assert.equal(dm.unfurl_media,false);
 assert.ok(!JSON.stringify(dm).includes('PRIVATE_BROWSER_BODY')&&!JSON.stringify(dm).includes(owner.email),'only the allowed fields leave the deployment');
 await writeFile(resolve(evidence,`slack-004-dm-payload-${width}.json`),JSON.stringify(dm,null,1)+'\n');
 // Unlink is revocable at any time; removing the Slack connection leaves the next width unconnected.
 await page.goto(runtime.base+'/app/settings/notifications');await answered('/settings/notifications/slack/link','DELETE',()=>slack.getByRole('button',{name:'Unlink Slack',exact:true}).click());await link.waitFor();assert.equal(links(),0);
 await send('/settings/integrations/slack','DELETE');
}
