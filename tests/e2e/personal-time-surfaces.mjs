import assert from 'node:assert/strict';
export async function prepareTimeSurfaces(context,runtime,issue,team) {
 const api=context.request,base=runtime.base,headers={Origin:base};
 const owner=(await(await api.get(base+'/api/session')).json()).operatorId;
 const projectState=await api.post(base+'/api/settings/projects',{headers,data:{name:'October billing readiness',leadOperatorId:owner,description:'Reconciliation, audit notes and customer follow-up for this month.',priority:'high',targetDate:'2026-10-30'}});assert.equal(projectState.status(),200);
 const project=(await projectState.json()).projects.find(p=>p.name==='October billing readiness');
 const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
 const cycleState=await api.post(base+'/api/settings/cycles',{headers,data:{name:'Billing close and reconciliation',teamId:team.id,startsLocal:day(-1)+'T00:00',endsLocal:day(6)+'T00:00',capacity:20}});assert.equal(cycleState.status(),200);
 const cycle=(await cycleState.json()).cycles.find(c=>c.name==='Billing close and reconciliation');
 const pastState=await api.post(base+'/api/settings/cycles',{headers,data:{name:'September billing handover',teamId:team.id,startsLocal:day(-14)+'T00:00',endsLocal:day(-7)+'T00:00',capacity:8}});assert.equal(pastState.status(),200);const closedCycle=(await pastState.json()).cycles.find(c=>c.name==='September billing handover');
 const handoverResponse=await api.post(base+'/api/issues',{headers,data:{title:'Complete the previous reconciliation handover',teamId:team.id,cycleId:closedCycle.id,statusId:team.statuses.find(s=>s.category==='started').id,assigneeOperatorId:owner,estimate:3}});assert.equal(handoverResponse.status(),201);const handover=await handoverResponse.json();assert.equal((await api.patch(base+'/api/issues/'+handover.identifier,{headers,data:{expectedVersion:handover.version,statusId:team.statuses.find(s=>s.category==='completed').id}})).status(),200);
 const scheduled=await api.get(base+'/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *'));assert.equal(scheduled.status(),200);await scheduled.body();
 const updated=await api.patch(base+'/api/issues/'+issue.identifier,{headers,data:{expectedVersion:issue.version,assigneeOperatorId:owner,statusId:team.statuses.find(s=>s.category==='started').id,projectId:project.id,cycleId:cycle.id,estimate:3,description:'Reconcile invoice totals, identify exceptions and assign follow-up owners.'}});assert.equal(updated.status(),200);
 const intakeResponse=await api.post(base+'/api/intake',{headers,data:{teamId:team.id,title:'Invoice exception from the billing support queue',description:'Investigate the discrepancy before closing the monthly ledger.'}});assert.equal(intakeResponse.status(),201);const intake=await intakeResponse.json();
 const deferred=await api.post(base+'/api/issues/'+intake.identifier+'/defer',{headers,data:{expectedVersion:intake.version,returnAt:new Date(Date.now()+4*86400000).toISOString(),reason:'Waiting for the finance team to reconcile the source invoice.'}});assert.equal(deferred.status(),200);
 // A real second member assigns work through the normal issue door, producing Inbox activity.
 assert.equal((await api.post(base+'/api/settings/operators/invite',{headers,data:{email:['synthetic-vector-clock-member','personal-clock.test'].join(String.fromCharCode(64)),displayName:'Maya Ortiz'}})).status(),202);
 const mail=runtime.sql("SELECT json_extract(message,'$.text') text FROM rer_mail_development_outbox ORDER BY sequence DESC LIMIT 1")[0].text;
 const token=new URL(mail.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
 const peer=await context.browser().newContext();
 try {assert.equal((await peer.request.post(base+'/auth/confirm',{headers,data:{token},maxRedirects:0})).status(),303);
  assert.equal((await peer.request.post(base+'/api/issues',{headers,data:{teamId:team.id,title:'Review the customer credit memo exceptions',assigneeOperatorId:owner,priority:'high'}})).status(),201);
 } finally {await peer.close();}
 const credential=await api.post(base+'/api/settings/integrations/tokens',{headers,data:{name:'Billing audit reader',scopes:['issues:read']}});assert.equal(credential.status(),201);
 const issued=await credential.json();assert.equal((await api.get(base+'/api/v1/issues',{headers:{Authorization:'Bearer '+issued.token}})).status(),200);
 return {project,cycle,intake,closedCycle};
}
export async function inspectTimeSurfaces(page,context,runtime,issue,records,width,output,local) {
 const capture=async name=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits');await page.screenshot({path:`${output}/${name}-${width}.png`});};
 for(const [path,heading,name] of [
  ['/app',null,'current'],
  ['/app/my-work','My work','my-work'],
  ['/app/projects/'+records.project.id,'October billing readiness','project'],
  ['/app/cycles', 'Cycles','cycles'],
  ['/app/cycles/'+records.cycle.id,'Billing close and reconciliation','cycle'],
 ]) {await page.goto(runtime.base+path);if(heading)await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();await capture(name);if(name==='my-work'){
   const dates=page.locator('.cycle-dates time');
   assert.equal(await dates.getAttribute('datetime'),records.cycle.startsAt);
   assert.equal(await dates.getAttribute('data-ends-at'),records.cycle.endsAt);
   const inPersonalZone=await page.evaluate(cycle=>new Intl.DateTimeFormat(undefined,{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'}).format(new Date(cycle.startsAt)),records.cycle);
   assert((await dates.innerText()).includes(inPersonalZone),'The active cycle uses the viewer’s time zone and browser time format');
   assert.equal(await page.locator('.cycle-timezone').innerText(),'America/Los_Angeles');
  }if(name==='cycles'){await page.getByRole('link',{name:'Open '+records.cycle.name,exact:true}).scrollIntoViewIfNeeded();await capture('cycle-list-times');}if(name==='project'){for(const [heading,label] of [['Cycle capacity','project-cycle-times'],['Project activity','project-activity']]){await page.getByRole('heading',{name:heading,exact:true}).scrollIntoViewIfNeeded();await capture(label);}}}
 await page.goto(runtime.base+'/app/cycles/'+records.closedCycle.id);await page.getByRole('heading',{name:'Snapshot at close',exact:true}).scrollIntoViewIfNeeded();await capture('closed-cycle');
 await page.goto(runtime.base+'/app/issues/'+issue.identifier);await page.getByRole('heading',{name:issue.title,exact:true}).waitFor();await page.getByText('Description history',{exact:false}).click();await page.getByLabel('Compare from revision').waitFor();await page.getByLabel('Compare from revision').scrollIntoViewIfNeeded();await capture('description-history');
 await page.goto(runtime.base+'/app/issues/'+records.intake.identifier);
 await page.getByRole('heading',{name:records.intake.title,exact:true}).waitFor();
 // Scroll restoration can leave the phone decision sheet compact. Open its
 // visible native control before choosing an action; all time checks remain.
 const expand=page.getByRole('button',{name:'Show all decisions',exact:true});
 if(await expand.isVisible())await expand.click();
 await page.getByRole('tab',{name:'Defer',exact:true}).click();await page.getByLabel('Return for decision (America/Los_Angeles)').scrollIntoViewIfNeeded();await capture('deferral');await page.getByLabel('Return for decision (America/Los_Angeles)').fill(local);const deferred=page.waitForResponse(r=>r.url().endsWith('/defer')&&r.request().method()==='POST');await page.getByRole('button',{name:'Defer decision',exact:true}).click();assert.equal((await deferred).status(),200);await page.getByRole('status',{name:'Saved triage decision'}).scrollIntoViewIfNeeded();await capture('deferred-confirmation');
 await page.goto(runtime.base+'/app/new');await page.getByRole('heading',{name:'New issue',exact:true}).waitFor();await page.getByRole('radio',{name:/Intake/}).check();await page.getByLabel('Observed time (America/Los_Angeles)').scrollIntoViewIfNeeded();await capture('new-intake');await page.getByRole('radio',{name:/Issue.*Ready for work/}).check();
 await page.goto(runtime.base+'/app/inbox');const snooze=page.getByRole('button',{name:/^Snooze notification for/}).first();await snooze.waitFor();await snooze.click();await page.getByLabel('Custom date and time (America/Los_Angeles)').fill(local);await capture('snooze-input');
 const saved=page.waitForResponse(r=>r.url().includes('/snooze')&&r.request().method()==='POST');await page.getByRole('button',{name:'Snooze until then',exact:true}).click();assert.equal((await saved).status(),200);
 const snoozed=page.getByRole('button',{name:/Snoozed/});assert.equal(await snoozed.count(),1);await snoozed.first().click();await page.getByRole('button',{name:/^Return .* notification to Inbox now/}).first().waitFor();await capture('snoozed');await page.getByRole('button',{name:/^Return .* notification to Inbox now/}).first().click();
 await page.goto(runtime.base+'/app/settings#integrations');await page.getByRole('heading',{name:'API tokens',exact:true}).scrollIntoViewIfNeeded();await capture('token-settings');await page.getByRole('heading',{name:'Token usage',exact:true}).scrollIntoViewIfNeeded();await capture('token-usage');
}
