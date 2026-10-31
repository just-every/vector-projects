import {triageUpgrade} from './triage-upgrade';
import {triageResponsibilityJourney} from './triage-responsibility-journey';
import {exerciseErrorProviders} from './error-provider-journey';
import {env} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import {setupIntegrations} from './integration-fixture';
it('[ERROR-001 INTAKE-001 INTAKE-002 INTAKE-003 INTAKE-011] signed native source publication and replay are atomic, source-attributed and restart-safe',async()=>{
 const f=await setupIntegrations(),config=await f.source(),input={teamId:f.initial.teams[0].id,title:'Source signal',sourceRecordId:'record-a',sourceRevisionId:'rev-1',observedAt:'2026-10-01T02:00:00.000Z',measurements:{errors:5},assertions:{cause:{value:'Source hypothesis',attribution:'source'}}};
 expect((await f.signed(config,input,{},true)).status).toBe(401);expect((await f.signed(config,{...input,title:''})).status).toBe(400);
 expect((await f.app.request(config.receiver,{method:'POST',body:'untrusted'},(await import('./base-auth-fixture')).bindings)).status).toBe(401);
 expect((await f.signed({...config,receiver:config.receiver.replace(config.id,'01K00000000000000000000099')},input)).status).toBe(401);
 const created=await f.signed(config,input);expect(created.status).toBe(200);const result=await created.json() as {identifier:string;evidenceRevisionId:string;reused:boolean};expect(result.reused).toBe(false);
 f.restart();
 const replay=await f.signed(config,input);expect(replay.status).toBe(200);expect(await replay.json()).toEqual({...result,reused:true});
 expect((await f.signed(config,{...input,title:'Different reused contents'})).status).toBe(409);
 expect((await env.DB.prepare('SELECT count(*) n FROM evidence_revisions').first())?.n).toBe(1);
 await env.DB.prepare("CREATE TRIGGER source_receipt_failure BEFORE INSERT ON vector_source_receipts BEGIN SELECT RAISE(ABORT,'receipt failure'); END").run();
 expect((await f.signed(config,{...input,sourceRevisionId:'rev-fail'})).status).toBe(503);expect((await env.DB.prepare('SELECT count(*) n FROM evidence_revisions').first())?.n).toBe(1);
 await env.DB.prepare('DROP TRIGGER source_receipt_failure').run();expect((await f.signed(config,{...input,sourceRevisionId:'rev-fail'})).status).toBe(200);
 const issue=await env.DB.prepare('SELECT id,status_id,version FROM issues WHERE identifier=?').bind(result.identifier).first<{id:string;status_id:string;version:number}>();
 const done=f.initial.teams[0].statuses.find(row=>row.category==='completed')!;await env.DB.prepare('UPDATE issues SET status_id=?,version=version+1,completed_at=? WHERE id=?').bind(done.id,'2026-10-02T00:00:00.000Z',issue!.id).run();
 expect((await f.signed(config,{...input,sourceRevisionId:'older',observedAt:'2026-09-01T01:00:00.000Z'})).status).toBe(200);expect(await env.DB.prepare('SELECT status_id FROM issues WHERE id=?').bind(issue!.id).first<string>('status_id')).toBe(done.id);
 for(const category of ['canceled','duplicate']){
  const terminal=f.initial.teams[0].statuses.find(row=>row.category===category)!;
  await env.DB.prepare('UPDATE issues SET status_id=?,version=version+1,deferred_until=NULL WHERE id=?').bind(terminal.id,issue!.id).run();
  const before=await env.DB.prepare('SELECT status_id,team_id,title,description,priority,assignee_operator_id,deferred_until FROM issues WHERE id=?').bind(issue!.id).first();
  expect((await f.signed(config,{...input,sourceRevisionId:category+'-new',observedAt:'2026-10-04T00:00:00.000Z',assertions:{cause:{value:category+' source claim',attribution:'source'}}})).status).toBe(200);
  expect(await env.DB.prepare('SELECT status_id,team_id,title,description,priority,assignee_operator_id,deferred_until FROM issues WHERE id=?').bind(issue!.id).first()).toEqual(before);
 }
 const projected=await f.call('/issues/'+result.identifier);expect(projected.status).toBe(200);
 const detail=await projected.json() as {evidence:{observedAt:string;sourceId:string;sourceRecordId:string;sourceRevisionId:string;changes:{field:string;previous:unknown;current:unknown}[]}[]};
 expect(detail.evidence.map(row=>row.observedAt)).toEqual([...detail.evidence.map(row=>row.observedAt)].sort());
 expect(detail.evidence.every(row=>row.sourceId===config.sourceId&&row.sourceRecordId===input.sourceRecordId)).toBe(true);
 expect(detail.evidence.some(row=>row.changes.some(change=>change.field==='assertions.cause'))).toBe(true);
 expect((await f.call('/settings/teams/'+f.initial.teams[0].id,'PATCH',{archived:true})).status).toBe(200);
 const count=(await env.DB.prepare('SELECT count(*) n FROM evidence_revisions').first())?.n;
 expect((await f.signed(config,{...input,sourceRecordId:'archived-new',sourceRevisionId:'new'})).status).toBe(409);
 expect((await env.DB.prepare('SELECT count(*) n FROM evidence_revisions').first())?.n).toBe(count);
 expect((await f.call('/settings/teams/'+f.initial.teams[0].id,'PATCH',{archived:false})).status).toBe(200);
 const deletedInput={...input,sourceRecordId:'deleted-record'},createdForRemoval=await f.signed(config,deletedInput);expect(createdForRemoval.status).toBe(200);const removed=await createdForRemoval.json() as {identifier:string};
 const removedIssue=await (await f.call('/issues/'+removed.identifier)).json() as {version:number};
 expect((await f.call('/issues/'+removed.identifier,'DELETE',{expectedVersion:removedIssue.version,confirmed:true})).status).toBe(200);
 f.restart();expect((await f.signed(config,deletedInput)).status).toBe(410);expect((await f.signed(config,{...deletedInput,title:'Altered erased revision'})).status).toBe(409);expect((await f.signed(config,{...deletedInput,sourceRevisionId:'after-delete'})).status).toBe(410);
 const rotation=await f.call('/settings/integrations/sources/'+config.id+'/rotate','POST',{overlapHours:1});expect(rotation.status).toBe(200);expect((await f.signed(config,input)).status).toBe(200);
 await env.DB.prepare("UPDATE vector_integration_secret_keys SET valid_until=1 WHERE identity=? AND slot='previous'").bind('source:'+config.id).run();expect((await f.signed(config,input)).status).toBe(401);
 expect((await f.call('/settings/integrations/sources/'+config.id,'DELETE')).status).toBe(200);expect((await f.signed(config,input)).status).toBe(401);
 expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
 await exerciseErrorProviders(f);
 await triageResponsibilityJourney(f);
 await triageUpgrade();
},180000);
it('[INTAKE-002 ISSUE-010] deletion winning a new source revision returns gone and cannot allocate a replacement',async()=>{
 const {beforeCommit}=await import('./removal-interleaving');
 const f=await setupIntegrations(),source=await f.source('deletion-race'),input={teamId:f.initial.teams[0].id,title:'Raced source',sourceRecordId:'source-race',sourceRevisionId:'first',observedAt:'2026-10-01T02:00:00Z'};
 const unrelatedIssues=(await env.DB.prepare("SELECT * FROM issues ORDER BY id").all()).results;
 const first=await f.signed(source,input);expect(first.status).toBe(200);const {identifier}=await first.json() as {identifier:string};
 const issue=await (await f.call('/issues/'+identifier)).json() as {version:number};
 const sequence=await env.DB.prepare('SELECT * FROM issue_prefix_sequences').all();
 const {request}=await import('./base-auth-fixture');
 const racedDelete=beforeCommit(sql=>sql.includes('DELETE FROM issues'),async()=>{expect((await f.signed(source,{...input,sourceRevisionId:'wins-before-delete'})).status).toBe(200);});
 expect((await request('/api/issues/'+identifier,'DELETE',{expectedVersion:issue.version,confirmed:true},f.cookie,{DB:racedDelete})).status).toBe(409);
 expect(await env.DB.prepare('SELECT count(*) n FROM evidence_revisions WHERE issue_id=(SELECT id FROM issues WHERE identifier=?)').bind(identifier).first<number>('n')).toBe(2);

 const DB=beforeCommit(sql=>sql.includes('INSERT INTO evidence_revisions'),async()=>{expect((await f.call('/issues/'+identifier,'DELETE',{expectedVersion:issue.version,confirmed:true})).status).toBe(200);});
 const result=await f.signed(source,{...input,sourceRevisionId:'late'},{DB});expect(result.status,await result.clone().text()).toBe(410);
 expect((await env.DB.prepare('SELECT * FROM issue_prefix_sequences').all()).results).toEqual(sequence.results);
 expect((await env.DB.prepare('SELECT * FROM issues ORDER BY id').all()).results).toEqual(unrelatedIssues);expect(await env.DB.prepare('SELECT count(*) n FROM evidence_revisions WHERE source_id=?').bind(source.sourceId).first<number>('n')).toBe(0);expect(await env.DB.prepare('SELECT count(*) n FROM vector_source_receipts WHERE source_id=?').bind(source.id).first<number>('n')).toBe(2);
});


it('[INTAKE-007] declining without a reason is refused; with one it reaches Canceled and keeps evidence and decision history [INTAKE-006 NOTIFY-001] fresh evidence returns deferred intake once', async () => {
  const f = await setupIntegrations();
  const source = await f.source('deferred-evidence');
  const input = {
    teamId: f.initial.teams[0].id,
    title: 'Deferred signal awaiting fresh evidence',
    sourceRecordId: 'deferred-signal',
    sourceRevisionId: 'first',
    observedAt: new Date().toISOString(),
  };
  const read = async <T>(response: Response, status = 200): Promise<T> => {
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json() as Promise<T>;
  };
  type Detail = {
    identifier: string;
    version: number;
    status: { id: string; category: string };
    deferredUntil: string | null;
    completedAt: string | null;
    canceledAt: string | null;
    assignee: { id: string } | null;
    priority: string;
    evidence: { id: string; sourceRevisionId: string }[];
    decisions: { id: string; kind: string; returnAt: string | null }[];
    activity: { id: string; kind: string; actor: string | null; previousValue: unknown; nextValue: unknown }[];
  };
  type Inbox = {
    items: { identifier: string; eventId: string; actor: string | null; causes: string[] }[];
  };
  const created = await read<{ identifier: string }>(await f.signed(source, input));
  const path = `/issues/${created.identifier}`;
  const detail = () => f.call(path).then(response => read<Detail>(response));
  const returns = async () =>
    (await read<Inbox>(await f.call('/notifications?limit=50'))).items
      .filter(row => row.identifier === created.identifier && row.causes.includes('intake_return'));
  const issue = await detail();
  const returnAt = new Date(Date.now() + 3_600_000).toISOString();
  const deferred = await read<Detail>(await f.call(path + '/defer', 'POST', {
    expectedVersion: issue.version, returnAt, reason: 'Wait for another observation',
  }));
  expect(deferred.deferredUntil).toBe(returnAt);
  const deferActivity = deferred.activity.find(row => row.kind === 'intake.deferred');
  expect(deferActivity).toBeDefined();
  expect(await returns()).toEqual([]);

  const fresh = { ...input, sourceRevisionId: 'fresh', summary: 'New observation' };
  await env.DB.prepare("CREATE TRIGGER deferred_receipt_failure BEFORE INSERT ON vector_source_receipts BEGIN SELECT RAISE(ABORT,'receipt failure'); END").run();
  try {
    expect((await f.signed(source, fresh)).status).toBe(503);
    expect(await detail()).toEqual(deferred);
    expect(await returns()).toEqual([]);
  } finally { await env.DB.prepare('DROP TRIGGER deferred_receipt_failure').run(); }
  const publication = await read<{ reused: boolean }>(await f.signed(source, fresh));
  expect(publication.reused).toBe(false);
  const returned = await detail();
  expect(returned).toMatchObject({
    version: deferred.version + 1,
    deferredUntil: null,
    status: deferred.status,
    decisions: deferred.decisions,
  });
  expect(returned.evidence).toHaveLength(deferred.evidence.length + 1);
  expect(returned.activity).toContainEqual(deferActivity);
  const returnActivity = returned.activity.filter(row => row.kind === 'intake.returned');
  expect(returnActivity).toHaveLength(1);
  expect(returnActivity[0]).toMatchObject({
    actor: 'Monitoring source',
    previousValue: { deferredUntil: returnAt },
    nextValue: { deferredUntil: null },
  });
  const notifications = await returns();
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({
    eventId: returnActivity[0].id,
    actor: 'Monitoring source',
    causes: ['intake_return'],
  });

  f.restart();
  expect(await read(await f.signed(source, fresh))).toMatchObject({ reused: true });
  const replayed = await detail();
  expect({ version: replayed.version, activity: replayed.activity, evidence: replayed.evidence, decisions: replayed.decisions })
    .toEqual({ version: returned.version, activity: returned.activity, evidence: returned.evidence, decisions: returned.decisions });
  expect(await returns()).toEqual(notifications);

  await read(await f.signed(source, { ...input, sourceRevisionId: 'already-returned' }));
  const alreadyReturned = await detail();
  expect(alreadyReturned.version).toBe(returned.version);
  expect(alreadyReturned.evidence).toHaveLength(returned.evidence.length + 1);
  expect(alreadyReturned.activity.filter(row => row.kind === 'intake.returned')).toEqual(returnActivity);
  expect(await returns()).toEqual(notifications);

  for (const reason of [undefined, '', '   ']) {
    expect((await f.call(path + '/decline', 'POST', { expectedVersion: alreadyReturned.version, reason })).status).toBe(400);
    expect(await detail()).toEqual(alreadyReturned);
  }
  const declined = await read<Detail>(await f.call(path + '/decline', 'POST', {
    expectedVersion: alreadyReturned.version, reason: 'No further work required',
  }));
  expect(declined.status.category).toBe('canceled');
  expect(declined.evidence).toEqual(alreadyReturned.evidence);
  expect(declined.decisions).toEqual(expect.arrayContaining(alreadyReturned.decisions));
  expect(declined.decisions.filter(row => row.kind === 'declined')).toHaveLength(1);
  expect(declined.activity).toEqual(expect.arrayContaining(alreadyReturned.activity));
  f.restart();
  expect(await detail()).toEqual(declined);
  expect(declined.canceledAt).toEqual(expect.any(String));
  await read(await f.signed(source, { ...input, sourceRevisionId: 'after-terminal' }));
  const terminal = await detail();
  expect(terminal).toMatchObject({
    status: declined.status,
    version: declined.version,
    assignee: declined.assignee,
    priority: declined.priority,
    deferredUntil: null,
    completedAt: declined.completedAt,
    canceledAt: declined.canceledAt,
    decisions: declined.decisions,
  });
  expect(terminal.evidence).toHaveLength(declined.evidence.length + 1);
  expect(terminal.activity.filter(row => row.kind === 'intake.returned')).toEqual(returnActivity);
  expect(await returns()).toEqual(notifications);
});
