import {prepareTimeSurfaces,inspectTimeSurfaces} from './personal-time-surfaces.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {createAdminRuntime,bootstrapOwner} from './admin-runtime-support.mjs';
const output=resolve(process.env.VECTOR_TIME_SHOTS??'.artifacts/verification/personal-time');
await mkdir(output,{recursive:true});
const runtime=createAdminRuntime(1440,[],{port:15972,inspectorPort:15973});
let browser,page;
try {
 runtime.initialize();await runtime.start();browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Tokyo',extraHTTPHeaders:{Connection:'close'}});page=await context.newPage();page.setDefaultTimeout(20000);await bootstrapOwner(page,runtime);
 const api=context.request,headers={Origin:runtime.base};
 const settings=await api.patch(runtime.base+'/api/settings',{headers,data:{timezone:'America/New_York'}});assert.equal(settings.status(),200);
 const state=await(await api.get(runtime.base+'/api/settings/administration')).json(),team=state.teams[0];
 const issueResponse=await api.post(runtime.base+'/api/issues',{headers,data:{title:'Reconcile October subscription invoices',teamId:team.id,description:'Check invoice totals and document the exceptions before the next billing cycle.',priority:'high',dueDate:'2026-10-30'}});assert.equal(issueResponse.status(),201);const issue=await issueResponse.json();
 const records=await prepareTimeSurfaces(context,runtime,issue,team);
 const future=new Date(Date.now()+3*86400000);future.setUTCHours(18,30,0,0);const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(future).map(p=>[p.type,p.value]));const local=`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:width===390?844:1000});await page.goto(runtime.base+'/app/settings/profile');
  // Each field saves as it changes: the zone when it is left, the hours when chosen. No Save button.
  const patched=()=>page.waitForResponse(r=>r.url().endsWith('/settings/personal-time')&&r.request().method()==='PATCH');
  // A change that sets what is already set writes nothing, so the second width picks different hours and finds the zone kept.
  let saved;const zone=page.getByLabel('Time zone',{exact:true});
  if(width===1440){saved=patched();await zone.fill('America/Los_Angeles');await zone.blur();assert.equal((await saved).status(),200);}
  else assert.equal(await zone.inputValue(),'America/Los_Angeles','the saved personal zone is shown on the next visit');
  saved=patched();await page.getByLabel('Day starts',{exact:true}).selectOption(width===1440?'08:30':'08:00');assert.equal((await saved).status(),200);
  saved=patched();await page.getByLabel('Day ends',{exact:true}).selectOption(width===1440?'16:30':'16:00');assert.equal((await saved).status(),200);
  assert.equal(await page.getByRole('button',{name:/^Save/}).count(),0);
  await page.locator('.field-saved:not(:empty)').first().waitFor();await page.getByRole('heading',{name:'Your hours'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/settings-${width}.png`});await page.getByLabel('Day ends',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/working-hours-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(runtime.base+'/app/issues/'+issue.identifier);await page.getByRole('heading',{name:issue.title,exact:true}).waitFor();await page.getByRole('button',{name:'Remind me',exact:true}).click();
  await page.getByLabel('Remind me at (America/Los_Angeles)').fill(local);const created=page.waitForResponse(r=>r.url().endsWith('/reminders')&&r.request().method()==='POST');await page.getByRole('button',{name:'Set personal reminder',exact:true}).click();assert.equal((await created).status(),200);
  const reminders=await(await api.get(runtime.base+'/api/issues/'+issue.identifier+'/reminders')).json();assert.ok(reminders.reminders.some(r=>r.remindAt===future.toISOString()),'personal zone controls the instant although browser is Tokyo');
  await page.getByText(/Next personal reminder:/).waitFor();await page.locator('.personal-reminders').scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/reminder-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Reload reads the saved clock during SSR; browser timezone must not change it.
  await page.reload();await page.getByText(/Next personal reminder:/).waitFor();assert.ok((await page.locator('.personal-reminders').innerText()).includes('America/Los_Angeles'));
  await inspectTimeSurfaces(page,context,runtime,issue,records,width,output,local);
  console.log(`[NOTIFY-010] ${width}: save personal zone and working hours, schedule in viewer zone, reload`);
 }
} catch(error){if(page)await page.screenshot({path:output+'/failure.png'}).catch(()=>{});throw error;}
finally{if(browser)await browser.close();await runtime.stop();}
