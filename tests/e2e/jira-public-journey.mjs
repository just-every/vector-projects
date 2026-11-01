import assert from 'node:assert/strict';
import {tableCounts,verifyJiraReview,verifyReport} from './jira-review-checks.mjs';
import {generateJiraFixture} from '../fixtures/import/jira/generate.mjs';
import {captureJiraState} from './jira-capture-support.mjs';
import {verifyQualifiedStatusControls} from './jira-status-controls.mjs';

export async function exerciseJiraPublicJourney({page,runtime,native,directory,proof}) {
 const panel=page.locator('#data'),baseline=generateJiraFixture();
 const capture=(state,focus)=>captureJiraState({page,panel,directory,state,proof,focus});
 const apply=panel.getByRole('button',{name:'Apply reviewed run',exact:true});
 const file=async fixture=>{
  await panel.getByLabel('Issue export file',{exact:true}).setInputFiles({name:'jira-'+fixture.variant+'.csv',mimeType:'text/csv',buffer:Buffer.from(fixture.csv)});
  await panel.getByLabel('Default team',{exact:true}).waitFor();
 };
 const preview=async fixture=>{
  // Every authenticated API request admits an operator minute-rate bucket.
  // Warm that transport bucket through the public door before measuring the
  // import request, keeping the complete table-count assertion unchanged.
  const minute=Date.now()%60000;
  if(minute>50000)await new Promise(resolve=>setTimeout(resolve,60250-minute));
  const admitted=await page.request.get(runtime.base+'/api/data/import/options');
  assert.equal(admitted.status(),200);await admitted.body();
  const before=tableCounts(runtime);
  const startedAt=Date.now();
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/data/import/preview'&&r.request().method()==='POST');
  await panel.getByRole('button',{name:'Preview import',exact:true}).click();
  const response=await pending;assert.equal(response.status(),200);const result=await response.json();
  const after=tableCounts(runtime);
  const elapsedMs=Date.now()-startedAt;
  await panel.getByRole('heading',{name:'Review 300 source rows',exact:true}).waitFor();
  const counts=await verifyJiraReview(panel,result,fixture);
  proof.previews.push({variant:fixture.variant,ready:result.ready,errors:result.errors,dates:result.jiraDates,concepts:counts,statusMappings:response.request().postDataJSON().references?.status,requestStartedAt:new Date(startedAt).toISOString(),requestMinute:Math.floor(startedAt/60000),requestSecond:(startedAt%60000)/1000,elapsedMs,tableCount:Object.keys(before).length,before,after});
  assert.deepEqual(after,before,'Public preview changes no table row counts');
  return result;
 };
 await page.goto(runtime.base+'/app/settings/move-in');
 await panel.getByRole('heading',{name:'Data / Move in',exact:true}).waitFor();
 await panel.getByLabel('File format',{exact:true}).selectOption('jira-csv');
 await capture('jira-choice');
 await panel.getByLabel('Import source name',{exact:true}).fill('jira-public-300');
 await file(baseline);
 await panel.getByLabel('Default team',{exact:true}).selectOption(native.team.id);
 await panel.getByLabel('Source UTC offset',{exact:true}).fill('+10:00');
 const reference=async(kind,source,id)=>{
  await panel.getByLabel('Field to match',{exact:true}).selectOption(kind);
  await panel.getByLabel('Name in your file',{exact:true}).fill(source);
  await panel.getByLabel('Value in Vector',{exact:true}).selectOption(id);
  await panel.getByRole('button',{name:'Add name mapping',exact:true}).click();
 };
 for(const [source,category] of [['To Do','unstarted'],['In Progress','started'],['Done','completed']]) {
  await reference('status',native.team.name+'/'+source,native.statuses[category].id);
 }
 await reference('assignee',baseline.expected.nativeSetup.assigneeTokens[0].token,native.operator.id);
 for(const cycle of native.cycles)await reference('cycle',cycle.name,cycle.id);
 for(const [source,target] of Object.entries(baseline.expected.priorities.explicitVectorMapping)) {
  await panel.getByLabel('Jira priority',{exact:true}).fill(source);
  // This native select's wrapping label includes its option text; unlike the
  // reference selects it has no aria-label overriding that implicit name.
  await panel.getByLabel(/^Vector priority/).selectOption(target);
  await panel.getByRole('button',{name:'Confirm priority mapping',exact:true}).click();
 }
 await verifyQualifiedStatusControls({panel,native,fixture:baseline,reference,preview,proof});
 const unknown=generateJiraFixture({variant:'unknown-status'});
 await file(unknown);const invalid=await preview(unknown);
 assert.equal(invalid.ready,false);
 assert(invalid.errors.some(row=>(row.value==='Awaiting Product Review'||row.message.includes('Awaiting Product Review'))&&row.field==='status'));
 assert.equal(await apply.isDisabled(),true);
 await capture('unknown-status-refusal',panel.locator('.import-review'));
 // Keep the unrecognized workflow value unresolved; the appropriate repair for
 // this synthetic variant is the intended baseline CSV with its known statuses.
 await file(baseline);const reviewed=await preview(baseline);
 assert.equal(reviewed.ready,true,JSON.stringify(reviewed.errors));
 assert(reviewed.omissions.length>0);
 assert.equal(await apply.isDisabled(),true,'Acknowledgement is required');
 await capture('loss-review',panel.getByRole('region',{name:'Jira loss review',exact:true}));
 await panel.getByLabel('I reviewed these omissions.',{exact:true}).check();
 assert.equal(await apply.isEnabled(),true);
 const snapshots=[],reads=[];
 const observe=response=>{
  const path=new URL(response.url()).pathname;
  if(response.request().method()==='POST'&&(path==='/api/data/import/apply'||/^\/api\/data\/import\/runs\/[^/]+\/resume$/.test(path))) {
   reads.push((async()=>{assert.equal(response.status(),200);snapshots.push(await response.json());})());
  }
 };
 page.on('response',observe);
 let runId;
 try {
  const applied=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/data/import/apply'&&r.request().method()==='POST');
  await apply.click();const created=await(await applied).json();runId=created.id;
  const row=panel.locator('.import-runs > li').filter({has:page.getByText(runId,{exact:true})});
  await row.getByText(/Completed · .*300 source records/).waitFor({timeout:180000});
  await Promise.all(reads);
  const completed=snapshots.at(-1);assert.equal(completed.state,'completed');assert.equal(completed.checkpoint,300);
  assert(completed.progress.batchesTotal>1,'The real 300-row run must publish in staged batches');
  assert.equal(completed.progress.batchesApplied,completed.progress.batchesTotal);
  proof.run={id:runId,snapshots};
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/data/import/runs/'+runId+'/report');
  await row.getByRole('button',{name:'Reconciliation report',exact:true}).click();
  const receipt=await response;assert.equal(receipt.status(),200);const report=await receipt.json();
  const section=panel.locator('.import-report');await section.getByRole('heading',{name:'Reconciliation report: jira-public-300',exact:true}).waitFor();
  proof.report=await verifyReport(section,report,baseline);
  await capture('completed-reconciliation',section);
  await section.getByRole('button',{name:'Close report',exact:true}).click();
 } finally {page.off('response',observe);}
 const ambiguous=generateJiraFixture({variant:'ambiguous-numeric-dates'});
 await panel.getByLabel('Import source name',{exact:true}).fill('jira-ambiguous-refusal');
 await file(ambiguous);const refusal=await preview(ambiguous);
 assert.equal(refusal.ready,false);
 assert(refusal.errors.some(row=>row.code==='jira_ambiguous_dates'));
 assert.equal(refusal.jiraDates.pattern,'undetermined numeric order');
 assert.equal(await apply.isDisabled(),true);
 await panel.getByText(/Day\/month order is ambiguous across the whole file/).waitFor();
 await capture('ambiguous-date-refusal',panel.locator('.import-review'));
}
