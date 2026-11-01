import { cyclesOffJourney } from "./team-cycles-journey";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { contractWith } from "../contract-tags";
import { setupAdministration } from "./administration-fixture";
import { beforeCommit } from "./removal-interleaving";
import { bindings, request } from "./base-auth-fixture";

const check = (name: string, run: () => Promise<void>) => contractWith(it, "TEAM-005 CYCLE-008 ISSUE-006 ISSUE-007 BASE-OPS-005", name, run);
let serial = 0;
async function fixture() {
  const f = await setupAdministration(), prefix = 'AC' + String.fromCharCode(65 + serial++);
  const state = await f.mutate('/settings/teams','POST',{name:'Automatic '+prefix,identifierPrefix:prefix});
  const team = state.teams.find(t=>t.identifierPrefix===prefix)!;
  const now = new Date();
  const local = (offset: number) => new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 16);
  await f.mutate('/settings/cycles','POST',{ teamId: team.id, name:'Current delivery cycle', startsLocal:local(-1), endsLocal:local(6) });
  await f.mutate('/settings/cycles','POST',{ teamId: team.id, name:'Following delivery cycle', startsLocal:local(6), endsLocal:local(13) });
  const cycles = (await f.state()).cycles.filter(c=>c.teamId===team.id);
  const active = cycles.find(c => c.name === 'Current delivery cycle')!, future = cycles.find(c => c.name === 'Following delivery cycle')!;
  const change = async (issue: { identifier: string; version: number }, category: string) => {
    const r = await f.call('/issues/'+issue.identifier,'PATCH',{ expectedVersion: issue.version,statusId:team.statuses.find(s=>s.category===category)!.id });
    expect(r.status,await r.clone().text()).toBe(200);
    return await r.json() as { id:string; identifier:string; version:number; cycle:{id:string}|null; activity:{kind:string;actor:string|null}[] };
  };
  return {...f, create:(extra:Record<string,unknown>={})=>f.create({teamId:team.id,...extra}), team, active, future, change};
}
check('native start and completion opt in independently, keep commitments, and record one durable automation per addition', async () => {
  const f=await fixture();
  const manual=await f.change(await f.create(),'started'); expect(manual.cycle).toBeNull();
  await f.mutate('/settings/teams/'+f.team.id,'PATCH',{autoCycleStarted:true});
  const intakeResponse=await f.call('/intake','POST',{teamId:f.team.id,title:'Investigate payment retries'});
  expect(intakeResponse.status).toBe(201);
  const intake=await intakeResponse.json() as {identifier:string;version:number};
  const accepted=await f.call('/issues/'+intake.identifier+'/accept','POST',{expectedVersion:intake.version,statusId:f.team.statuses.find(s=>s.category==='started')!.id});
  expect(accepted.status,await accepted.clone().text()).toBe(200);
  expect((await accepted.json() as {cycle:{id:string}|null}).cycle?.id).toBe(f.active.id);
  const started=await f.change(await f.create(),'started');
  expect(started.cycle?.id).toBe(f.active.id); expect(started.version).toBe(3);
  const completed=await f.change(started,'completed'); expect(completed.cycle?.id).toBe(f.active.id);
  const without=await f.change(await f.create(),'completed'); expect(without.cycle).toBeNull();
  await f.mutate('/settings/teams/'+f.team.id,'PATCH',{autoCycleStarted:false,autoCycleCompleted:true});
  const done=await f.change(await f.create(),'completed'); expect(done.cycle?.id).toBe(f.active.id);
  const committed=await f.change(await f.create({cycleId:f.future.id}),'started'); expect(committed.cycle?.id).toBe(f.future.id);
  for (const issue of [started,done]) {
    const rows=(await env.DB.prepare("SELECT actor_operator_id,actor_name,next_value_json FROM issue_activity WHERE issue_id=? AND kind='issue.cycle_automatically_added'").bind(issue.id).all()).results;
    expect(rows).toHaveLength(1); expect(rows[0].actor_operator_id).toBeNull(); expect(rows[0].actor_name).toBe('Cycle membership automation');
    expect(JSON.parse(String(rows[0].next_value_json)).cycleId).toBe(f.active.id);
    expect((await env.DB.prepare("SELECT id FROM audit_records WHERE subject_id=? AND action='cycle.membership.v1'").bind(issue.id).all()).results).toHaveLength(1);
  }
  const stale=await f.call('/issues/'+started.identifier,'PATCH',{expectedVersion:1,statusId:f.team.statuses.find(s=>s.category==='started')!.id}); expect(stale.status).toBe(409);
  await f.mutate('/settings/teams/'+f.team.id,'PATCH',{autoCycleCompleted:false});
  expect((await f.change(await f.create(),'completed')).cycle).toBeNull();
  await cyclesOffJourney(f);
});
check('bulk changes undo as one action including automatic membership, and expired cycles are never chosen', async()=>{
  const f=await fixture(); await f.mutate('/settings/teams/'+f.team.id,'PATCH',{autoCycleStarted:true});
  const issues=await Promise.all([f.create(),f.create()]);
  const response=await f.call('/issues/bulk','POST',{issues:issues.map(i=>({identifier:i.identifier,expectedVersion:i.version})),changes:{statusId:f.team.statuses.find(s=>s.category==='started')!.id}});
  expect(response.status,await response.clone().text()).toBe(200);
  const receipt=response.headers.get('x-vector-undo'); expect(receipt).not.toBeNull();
  for(const issue of issues){const detail=await (await f.call('/issues/'+issue.identifier)).json() as {cycle:{id:string}|null};expect(detail.cycle?.id).toBe(f.active.id)}
  const undo=await f.call('/issues/undo','POST',{actionId:JSON.parse(receipt!).actionId}); expect(undo.status,await undo.clone().text()).toBe(200);
  for(const issue of issues){const detail=await (await f.call('/issues/'+issue.identifier)).json() as {cycle:unknown};expect(detail.cycle).toBeNull()}
  await env.DB.prepare('UPDATE cycles SET ends_at=? WHERE id=?').bind(new Date(Date.now()-1000).toISOString(),f.active.id).run();
  expect((await f.change(await f.create(),'started')).cycle).toBeNull();
});
check('a rule or cycle changing before commit refuses the whole mutation without orphan automation',async()=>{
  for (const setting of ['auto_cycle_started','cycles_enabled']) {
    const f=await fixture(); await f.mutate('/settings/teams/'+f.team.id,'PATCH',{autoCycleStarted:true}); const issue=await f.create();
    const DB=beforeCommit(sql=>sql.includes('INSERT INTO issue_activity'),async()=>{await env.DB.prepare('UPDATE teams SET '+setting+'=0 WHERE id=?').bind(f.team.id).run()});
    const r=await request('/api/issues/'+issue.identifier,'PATCH',{expectedVersion:issue.version,statusId:f.team.statuses.find(s=>s.category==='started')!.id},f.cookie,{...bindings,DB});
    expect(r.status).toBe(400);
    expect((await env.DB.prepare("SELECT id FROM issue_activity WHERE issue_id=? AND kind='issue.cycle_automatically_added'").bind(issue.id).all()).results).toHaveLength(0);
    expect(await env.DB.prepare('SELECT version FROM issues WHERE id=?').bind(issue.id).first('version')).toBe(issue.version);
  }
});
