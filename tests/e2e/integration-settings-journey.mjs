import {exerciseSlackAppInstallation} from './integrations/slack-app-installation.mjs';
import {eventSigner} from '../sendgrid-event-fixture.ts';
import {exerciseChannels} from './integrations/channel-settings.mjs';
import {exerciseSlackDirectMessages} from './integrations/slack-dm-settings.mjs';
import {navigate,settleReads,trackRequests} from './collaboration-navigation.mjs';
import {openTeam,switchRow} from './settings-pane-support.mjs';
import assert from 'node:assert/strict';
import {createWebhookProtocol} from '../../vendor/base/integrations/core/webhook.ts';
import {sendSignedPullRequest,pullRequestRepository} from './integration-signed-pr.mjs';
import {githubReceipts} from './integrations/github-receipts.mjs';
export async function exerciseIntegrationSettings({page,runtime,cookie,team,width,evidence}){
 await page.setViewportSize({width,height:900});await page.goto(runtime.base+'/app/settings/developers');const panel=page.locator('#integrations');await panel.getByRole('heading',{name:'Integrations',exact:true}).waitFor();
 const receipt=async(path,action,status=201)=>{const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/integrations'+path&&r.request().method()==='POST');await action();const response=await pending;assert.equal(response.status(),status);return response.json();};
 const reveal=async value=>{const input=panel.getByLabel('New credential',{exact:true});await input.waitFor();assert.equal(await input.inputValue()===value,true,'The reveal contains the issued credential');assert.equal(await input.getAttribute('type'),'password');await panel.getByRole('button',{name:'Show credential',exact:true}).click();assert.equal(await input.getAttribute('type'),'text');await panel.getByRole('button',{name:'Hide credential',exact:true}).click();await panel.getByRole('button',{name:'I saved it; close',exact:true}).click();assert.equal(await input.count(),0);};
 const name='Browser token '+width;await panel.getByLabel('Token name',{exact:true}).fill(name);const token=await receipt('/tokens',()=>panel.getByRole('button',{name:'Create token',exact:true}).click());await reveal(token.token);
 const used=await runtime.req('/api/v1/issues',{headers:{Authorization:'Bearer '+token.token}});assert.equal(used.status,200);await used.body.cancel();
 const usage=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/integrations/tokens/usage');await panel.getByRole('button',{name:'Refresh token usage',exact:true}).click();assert.equal((await usage).status(),200);
 await page.goto(runtime.base+'/app/settings/connections');await panel.getByRole('heading',{name:'Integrations',exact:true}).waitFor();
 await panel.getByLabel('Source name',{exact:true}).fill('Browser source '+width);await panel.getByLabel('Stable source ID',{exact:true}).fill('browser-source-'+width);await panel.getByLabel('Intake team',{exact:true}).selectOption(team.id);const source=await receipt('/sources',()=>panel.getByRole('button',{name:'Register source',exact:true}).click());await reveal(source.secret);
 const input={teamId:team.id,title:'Native signed signal '+width,summary:'Observed source evidence',sourceRecordId:'record-'+width,sourceRevisionId:'revision-1',observedAt:'2026-10-01T01:00:00.000Z',assertions:{hypothesis:{value:'Source hypothesis '+width,attribution:'source'},verified:{value:false,attribution:'source'}}};
 const protocol=createWebhookProtocol({resolveDestination:async()=>source.receiver,signingKey:async()=>new Uint8Array(Buffer.from(source.secret,'hex'))}),wire=await protocol.prepare({id:crypto.randomUUID(),tenant:source.workspaceId,destinationId:source.sourceId,event:'signal.revision',protocol:'webhook',body:JSON.stringify(input)},Date.now());
 const admitted=await fetch(source.receiver,{method:'POST',headers:wire.headers,body:wire.body});assert.equal(admitted.status,200);const issue=await admitted.json();
 const plainBody={title:'Plain webhook alert '+width};
 const postPlain=url=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(plainBody)});
 const plain=await postPlain(source.webhookUrl);assert.equal(plain.status,200);const plainIssue=await plain.json();assert.equal(plainIssue.reused,false);
 const replayPlain=await postPlain(source.webhookUrl);assert.equal(replayPlain.status,200);assert.deepEqual(await replayPlain.json(),{...plainIssue,reused:true});
 await page.goto(runtime.base+'/app/issues/'+plainIssue.identifier);await page.getByRole('heading',{name:plainBody.title,exact:true}).waitFor();
 await page.goto(runtime.base+'/app/settings/connections');await panel.getByRole('heading',{name:'Integrations',exact:true}).waitFor();
 const replaced=await receipt('/sources/'+source.id+'/webhook-url',()=>panel.getByRole('button',{name:'Replace webhook URL for Browser source '+width,exact:true}).click());await reveal(replaced.webhookUrl);
 assert.equal((await postPlain(source.webhookUrl)).status,401);
 const acceptedReplacement=await postPlain(replaced.webhookUrl);assert.equal(acceptedReplacement.status,200);assert.deepEqual(await acceptedReplacement.json(),{...plainIssue,reused:true});
 const revokeSource=page.waitForResponse(r=>r.request().method()==='DELETE'&&new URL(r.url()).pathname==='/api/settings/integrations/sources/'+source.id);await panel.getByRole('button',{name:'Revoke Browser source '+width,exact:true}).click();assert.equal((await revokeSource).status(),200);assert.equal((await postPlain(replaced.webhookUrl)).status,401);

 await exerciseEmailIntake({page,runtime,cookie,team,evidence});
 await exerciseSlackAppInstallation({page,runtime,cookie,team,width,evidence});
 await exerciseChannels({page,runtime,cookie,team,width,evidence});
 await exerciseSlackDirectMessages({page,runtime,width,evidence});
 await page.goto(runtime.base+'/app/settings/connections');await panel.getByRole('heading',{name:'Integrations',exact:true}).waitFor();
 await panel.getByLabel('Destination name',{exact:true}).fill('Browser receiver '+width);await panel.getByLabel('Public HTTPS destination',{exact:true}).fill('https://receiver.example.com/events');const destination=await receipt('/destinations',()=>panel.getByRole('button',{name:'Register destination',exact:true}).click());await reveal(destination.secret);
 const config=await(await runtime.req('/api/settings/integrations',{headers:{Cookie:cookie}})).json();assert.equal(config.outboundConfigured,false);assert(!JSON.stringify(config).includes(token.token));assert(!JSON.stringify(config).includes(source.secret));assert(!JSON.stringify(config).includes(source.webhookUrl));assert(!JSON.stringify(config).includes(replaced.webhookUrl));assert(!JSON.stringify(config).includes(destination.secret));
 await panel.getByLabel('Repository name',{exact:true}).fill('Browser repository '+width);await panel.getByLabel('GitHub owner/repository',{exact:true}).fill(pullRequestRepository(width));const github=await receipt('/github',()=>panel.getByRole('button',{name:'Register repository',exact:true}).click());await reveal(github.secret);
 const githubHealth=async()=>{const response=await runtime.req('/api/settings/integrations',{headers:{Cookie:cookie}});assert.equal(response.status,200);return (await response.json()).github.find(row=>row.id===github.id);};
 if(width===1440)assert.equal((await githubHealth()).lastReceivedEventAt,null);
 const receipts=githubReceipts({page,panel,runtime,cookie,width,evidence}),repositoryName='Browser repository '+width,unreceived=await receipts.none(repositoryName);
 const [,merged]=await sendSignedPullRequest(github,issue.identifier,width);
 const lastReceivedEventAt=width===1440?(await githubHealth()).lastReceivedEventAt:null;
 if(width===1440){assert.ok(lastReceivedEventAt);assert.equal(lastReceivedEventAt,runtime.sql(`SELECT received_at FROM vector_github_deliveries WHERE repository_id='${github.id}' ORDER BY received_at DESC LIMIT 1`)[0].received_at);}
 await page.reload();assert.equal(await panel.getByLabel('New credential',{exact:true}).count(),0);
 if(width===1440)assert.equal((await githubHealth()).lastReceivedEventAt,lastReceivedEventAt);
 const shownReceipt=await receipts.received(github,repositoryName,merged,unreceived);
 await page.goto(runtime.base+'/app/settings/developers');await panel.getByRole('heading',{name:'Integrations',exact:true}).waitFor();
 await panel.getByRole('button',{name:'Revoke '+name,exact:true}).waitFor();
 await page.goto(runtime.base+'/app/issues/'+issue.identifier);const pr=page.getByRole('link',{name:'Fix '+issue.identifier+' · '+pullRequestRepository(width)+' #42',exact:true});await pr.waitFor();assert.equal(await pr.getAttribute('href'),'https://github.com/'+pullRequestRepository(width)+'/pull/42');await page.getByText('· merged',{exact:true}).waitFor();await pr.scrollIntoViewIfNeeded();
 await page.goto(runtime.base+'/app/settings/developers');const revoked=page.waitForResponse(r=>r.request().method()==='DELETE'&&new URL(r.url()).pathname.startsWith('/api/settings/integrations/tokens/'));await panel.getByRole('button',{name:'Revoke '+name,exact:true}).click();assert.equal((await revoked).status(),200);assert.equal((await runtime.req('/api/v1/issues',{headers:{Authorization:'Bearer '+token.token}})).status,401);
 await page.goto(runtime.base+'/app/settings/connections');await panel.getByRole('heading',{name:'Integrations',exact:true}).waitFor();
 await receipts.revoked(github,repositoryName,merged,shownReceipt);
}

/** The existing integrations journey also proves the team's mail conversation, on a page of its
 * own: it settles that page's reads before leaving each document and closes it, so nothing it
 * starts stays on the shared page between the journey's configurations. */
export async function exerciseEmailIntake({page:shared,runtime,cookie,team,evidence}) {
 const page=await shared.context().newPage();trackRequests(page);
 try {
 await page.setViewportSize(shared.viewportSize());
 const {roleScreens}=await import('./role-ui-support.mjs'),inspect=roleScreens(evidence);
 const sender='synthetic-vector-721@example.test',address='synthetic-vector-'+Date.now()+'@example.test';
 await openTeam(page,runtime.base,team,'automation');
 const section=page.getByRole('region',{name:'Email intake for '+team.name,exact:true});
 // Intake is off until switched on; its address, senders and acknowledgement follow.
 const enable=section.getByRole('switch',{name:'Enable email intake',exact:true});
 await enable.and(page.locator(':enabled')).waitFor();
 if(!(await enable.isChecked()))await switchRow(section,'Enable email intake').click();
 await section.getByLabel('Private intake address',{exact:true}).fill(address);
 await section.getByLabel('Allowed sender addresses',{exact:true}).fill(sender);
 await inspect(page,section,'email-intake-configure');
 const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/email-intake'));
 await section.getByRole('button',{name:'Save email intake',exact:true}).click();assert.equal((await saved).status(),200);
 await section.getByText('Email intake settings saved.',{exact:true}).waitFor();
 await inspect(page,section,'email-intake-saved');
 await section.getByText('How this works',{exact:true}).click();
 const signer=await eventSigner(),eventKey=section.getByRole('form',{name:'Configure SendGrid Event Webhook',exact:true});
 await eventKey.getByLabel('SendGrid Event Webhook verification key',{exact:true}).fill(signer.publicKey);
 const keySaved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/email-intake/event-key'));
 await eventKey.getByRole('button',{name:'Save Event Webhook key',exact:true}).click();assert.equal((await keySaved).status(),200);
 await eventKey.getByText('No verification key saved.',{exact:true}).waitFor({state:'hidden'});
 await inspect(page,eventKey,'email-provider-event-settings');

 const messageId='<synthetic-vector-'+Date.now()+'@example.test>';
 const raw=['From: '+sender,'To: '+address,'Message-ID: '+messageId,'Subject: Delayed delivery from the warehouse','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="synthetic-vector-722"','','--synthetic-vector-722','Content-Type: text/plain','','Please check the delivery attached below.','--synthetic-vector-722','Content-Type: image/png','Content-Disposition: inline; filename="delivery.png"','Content-ID: <delivery-image>','Content-Transfer-Encoding: base64','','iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','--synthetic-vector-722','Content-Type: text/plain','Content-Disposition: attachment; filename="delivery.txt"','','Delivery route 721','--synthetic-vector-722--',''].join('\r\n');
 const accepted=await runtime.req('/cdn-cgi/local/email?from='+encodeURIComponent(sender)+'&to='+encodeURIComponent(address),{method:'POST',body:raw});assert.equal(accepted.status,200,await accepted.text());
 const receipts=await(await runtime.req('/api/settings/teams/'+team.id+'/email-intake',{headers:{Cookie:cookie}})).json();
 const identifier=receipts.receipts.find(r=>r.messageId===messageId)?.issueIdentifier;assert.ok(identifier);
 await navigate(page,runtime.base+'/app/issues/'+identifier);
 const requester=page.getByRole('region',{name:'Email requester',exact:true});await requester.getByText(sender,{exact:false}).waitFor();
 await requester.getByRole('link',{name:'delivery.txt',exact:true}).waitFor();
 await inspect(page,requester,'email-intake-requester');
 await requester.getByRole('button',{name:'View inline image: delivery.png',exact:true}).click();
 await requester.getByRole('img',{name:'delivery.png',exact:true}).waitFor();
 await inspect(page,requester,'email-intake-inline-image');
 await page.getByRole('button',{name:'Reply by email',exact:true}).first().click();
 const form=page.getByRole('form',{name:'Reply by email',exact:true});
 await form.getByRole('textbox',{name:'Email reply',exact:true}).fill('We are checking with the warehouse and will follow up.');
 await inspect(page,form,'email-intake-reply');
 const sent=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/email-replies'));
 await form.getByRole('button',{name:'Send reply by email',exact:true}).click();assert.equal((await sent).status(),201);
 const outcome=page.getByLabel('Email delivery outcome',{exact:true});await outcome.getByText('Email delivery: accepted',{exact:false}).waitFor();
 await inspect(page,page.locator('.detail-section').filter({has:page.getByRole('heading',{name:'Discussion',exact:true})}),'email-intake-accepted');

 const delivery=runtime.sql(`SELECT provider_message_id FROM intake_email_deliveries WHERE issue_id=(SELECT id FROM issues WHERE identifier='${identifier}') AND kind='reply'`)[0];assert.ok(delivery.provider_message_id);
 for(const [index,event] of ['processed','bounce'].entries()){
  const signed=await signer.sign([{sg_event_id:'synthetic-vector-'+(2200+index)+'-'+Date.now(),sg_message_id:delivery.provider_message_id+'.filter',email:sender,event}]);
  const result=await runtime.req(`/api/integrations/sendgrid/events/${team.id}`,{method:'POST',...signed});assert.equal(result.status,200);
  await outcome.getByText('Email delivery: '+(event==='bounce'?'bounced':'accepted'),{exact:true}).waitFor();
  await inspect(page,page.locator('.detail-section').filter({has:page.getByRole('heading',{name:'Discussion',exact:true})}),'email-provider-'+event);
 }

 await settleReads(page);
 } finally {await page.close();}
 console.log('TRIAGE-005 email intake settings, requester, reply and accepted outcome passed at 1440 and 390');
}
