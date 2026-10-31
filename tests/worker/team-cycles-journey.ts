import { env } from 'cloudflare:workers';
import { expect } from 'vitest';
import type { setupAdministration } from './administration-fixture';
import { roleWorkspace, snapshot } from './role-fixture';

type Fixture = Awaited<ReturnType<typeof setupAdministration>>;
export async function cyclesOffJourney(f: Fixture & {team:Fixture['initial']['teams'][number];active:{id:string};future:{id:string}}) {
  const path='/settings/teams/'+f.team.id;
  const unstarted=f.team.statuses.find(s=>s.category==='unstarted')!.id;
  const started=f.team.statuses.find(s=>s.category==='started')!.id;
  const committed=await f.create({statusId:unstarted,cycleId:f.active.id});
  const uncommitted=await f.create({statusId:unstarted});
  const startedCommitted=await f.create({statusId:started,cycleId:f.active.id});
  const next=async()=>((await (await f.call('/current')).json()) as any).sections.next.map((i:any)=>i.identifier);
  expect(await next()).toContain(committed.identifier);
  const before=(await env.DB.prepare('SELECT * FROM cycles WHERE team_id=? ORDER BY id').bind(f.team.id).all()).results;
  const history=(await env.DB.prepare('SELECT * FROM cycle_membership_events WHERE identifier=? ORDER BY id').bind(committed.identifier).all()).results;
  await f.mutate(path,'PATCH',{cyclesEnabled:false,autoCycleStarted:true,autoCycleCompleted:true});
  expect((await f.state()).teams.find(t=>t.id===f.team.id)?.cyclesEnabled).toBe(false);
  const options=await (await f.call('/options')).json() as any;
  expect(options.teams.find((t:any)=>t.id===f.team.id).cyclesEnabled).toBe(false);
  expect(options.cycles.some((c:any)=>c.teamId===f.team.id)).toBe(false);
  expect(await next()).not.toContain(committed.identifier);
  const current=await (await f.call('/current')).json() as any;
  expect(current.sections.now.find((i:any)=>i.identifier===startedCommitted.identifier).cycle).toBeNull();
  const metadata=await (await f.call('/metadata')).json() as Fixture['initial'];
  expect(metadata.teams.find(t=>t.id===f.team.id)?.cyclesEnabled).toBe(false);
  expect(metadata.cycles.some(c=>c.id===f.active.id)).toBe(true);
  const noCycle=await f.call('/issues/'+uncommitted.identifier,'PATCH',{expectedVersion:uncommitted.version,statusId:started});
  expect(noCycle.status).toBe(200);expect((await noCycle.json() as any).cycle).toBeNull();
  const bulkIssue=await f.create({statusId:unstarted});
  const bulkStatus=await f.call('/issues/bulk','POST',{issues:[{identifier:bulkIssue.identifier,expectedVersion:bulkIssue.version}],changes:{statusId:started}});
  expect(bulkStatus.status).toBe(200);
  expect((await (await f.call('/issues/'+bulkIssue.identifier)).json() as any).cycle).toBeNull();
  expect((await env.DB.prepare("SELECT id FROM issue_activity WHERE issue_id=? AND kind='issue.cycle_automatically_added'").bind(bulkIssue.id).all()).results).toHaveLength(0);
  const refused=await snapshot(['issues','issue_activity','cycle_membership_events','audit_records']);
  expect((await f.call('/issues/'+uncommitted.identifier,'PATCH',{expectedVersion:2,cycleId:f.active.id})).status).toBe(400);
  const bulkRefusal=await f.call('/issues/bulk','POST',{issues:[{identifier:uncommitted.identifier,expectedVersion:2}],changes:{cycleId:f.active.id}});
  expect(bulkRefusal.status).toBe(409);
  expect(await bulkRefusal.json()).toMatchObject({failures:[{identifier:uncommitted.identifier,reasons:[expect.stringContaining('Cycle is unavailable')]}]});
  expect((await f.call('/issues','POST',{teamId:f.team.id,title:'synthetic-vector-2501',cycleId:f.active.id})).status).toBe(400);
  expect((await f.call('/issues/'+committed.identifier,'PATCH',{expectedVersion:committed.version,cycleId:null})).status).toBe(400);
  expect((await f.call('/issues/bulk','POST',{issues:[{identifier:committed.identifier,expectedVersion:committed.version}],changes:{cycleId:null}})).status).toBe(409);
  expect(await snapshot(['issues','issue_activity','cycle_membership_events','audit_records'])).toEqual(refused);
  const edited=await f.call('/issues/'+committed.identifier,'PATCH',{expectedVersion:committed.version,title:'synthetic-vector-2502'});
  expect(edited.status).toBe(200);expect((await edited.json() as any).cycle.id).toBe(f.active.id);
  expect((await env.DB.prepare('SELECT * FROM cycles WHERE team_id=? ORDER BY id').bind(f.team.id).all()).results).toEqual(before);
  expect((await env.DB.prepare('SELECT * FROM cycle_membership_events WHERE identifier=? ORDER BY id').bind(committed.identifier).all()).results).toEqual(history);
  await f.mutate(path,'PATCH',{cyclesEnabled:true});
  expect(await next()).toContain(committed.identifier);
  expect((await (await f.call('/current')).json() as any).sections.now.find((i:any)=>i.identifier===startedCommitted.identifier).cycle.id).toBe(f.active.id);
  expect((await (await f.call('/options')).json() as any).cycles.map((c:any)=>c.id)).toContain(f.active.id);
  const resumed=await f.call('/issues/'+uncommitted.identifier,'PATCH',{expectedVersion:2,statusId:f.team.statuses.find(s=>s.category==='completed')!.id});
  expect(resumed.status).toBe(200);expect((await resumed.json() as any).cycle.id).toBe(f.active.id);
}

export async function teamCyclesPermissions(w: Awaited<ReturnType<typeof roleWorkspace>>) {
  const viewer=await w.fresh('member');
  expect((await w.call('/settings/operators/'+viewer.id+'/role','PATCH',{role:'viewer',teamIds:[]})).status).toBe(200);
  const path='/settings/teams/'+w.team.id;
  for(const permission of ['team_owners','all_members']) {
    expect((await w.call(path+'/permissions','PUT',{settings:permission,planning:'all_members'})).status).toBe(200);
    for(const actor of [w.people.owner,w.admin,w.lead,w.member,w.guest,viewer]) {
      const before=await snapshot(['teams','cycles','team_cycle_schedules','cycle_snapshots','issues','audit_records','administration_audit_details']);
      const allowed=actor!==w.guest&&actor!==viewer&&(actor!==w.member||permission==='all_members');
      const response=await actor.call(path,'PATCH',{cyclesEnabled:false});
      expect(response.status,await response.clone().text()).toBe(allowed?200:403);
      if(!allowed)expect(await snapshot(['teams','cycles','team_cycle_schedules','cycle_snapshots','issues','audit_records','administration_audit_details'])).toEqual(before);
      else {
        expect((await response.json() as Fixture['initial']).teams.find(t=>t.id===w.team.id)?.cyclesEnabled).toBe(false);
        expect((await w.call(path,'PATCH',{cyclesEnabled:true})).status).toBe(200);
      }
    }
  }
  expect((await w.call(path+'/permissions','PUT',{settings:'team_owners',planning:'all_members'})).status).toBe(200);
  const before=await snapshot(['teams','audit_records','administration_audit_details']);
  expect((await w.member.call(path,'PATCH',{cyclesEnabled:false})).status).toBe(403);
  expect(await snapshot(['teams','audit_records','administration_audit_details'])).toEqual(before);
}

export async function pausedCycleSchedule(f: Fixture, teamId:string, issueId:string, oldCycleId:string, at:string) {
  const { scheduled }=await import('../../src/core/app/scheduled');
  const { bindings }=await import('./base-auth-fixture');
  const path='/settings/teams/'+teamId;
  const tables=['cycles','team_cycle_schedules','cycle_snapshots','cycle_membership_events'];
  const retained=async()=>({
    cycles:(await env.DB.prepare('SELECT * FROM cycles WHERE team_id=? ORDER BY id').bind(teamId).all()).results,
    schedule:await env.DB.prepare('SELECT * FROM team_cycle_schedules WHERE team_id=?').bind(teamId).first(),
    snapshots:(await env.DB.prepare('SELECT s.* FROM cycle_snapshots s JOIN cycles c ON c.id=s.cycle_id WHERE c.team_id=? ORDER BY s.cycle_id').bind(teamId).all()).results,
    commitment:await env.DB.prepare('SELECT cycle_id,version FROM issues WHERE id=?').bind(issueId).first(),
    membership:(await env.DB.prepare('SELECT * FROM cycle_membership_events WHERE cycle_id IN (SELECT id FROM cycles WHERE team_id=?) ORDER BY id').bind(teamId).all()).results,
  });
  const before=await retained();expect(before.snapshots.length).toBeGreaterThan(0);
  await f.mutate(path,'PATCH',{cyclesEnabled:false});
  const denied=await snapshot([...tables,'audit_records','administration_audit_details']);
  expect((await f.call(path+'/cycle-schedule','PUT',{weeks:1,startWeekday:1,cooldownWeeks:0,upcomingCount:2})).status).toBe(409);
  expect((await f.call('/settings/cycles','POST',{teamId,name:'synthetic-vector-2503',startsLocal:'2039-01-01T00:00',endsLocal:'2039-01-08T00:00'})).status).toBe(409);
  expect(await snapshot([...tables,'audit_records','administration_audit_details'])).toEqual(denied);
  const other=(await f.mutate('/settings/teams','POST',{name:'synthetic-vector-2504',identifierPrefix:'SYNPAUSE'})).teams.find(t=>t.identifierPrefix==='SYNPAUSE')!;
  await f.mutate('/settings/teams/'+other.id+'/cycle-schedule','PUT',{weeks:1,startWeekday:1,cooldownWeeks:0,upcomingCount:1});
  const generation=await env.DB.prepare('SELECT generation FROM team_cycle_schedules WHERE team_id=?').bind(other.id).first<number>('generation');
  await scheduled({scheduledTime:Date.parse(at)},bindings);
  await scheduled({scheduledTime:Date.parse(at)},bindings);
  expect(await retained()).toEqual(before);
  expect(await env.DB.prepare('SELECT generation FROM team_cycle_schedules WHERE team_id=?').bind(other.id).first<number>('generation')).toBeGreaterThan(generation!);
  await f.mutate(path,'PATCH',{cyclesEnabled:true});
  await scheduled({scheduledTime:Date.parse(at)},bindings);
  const after=await retained();
  expect(after.snapshots.find((s:any)=>s.cycle_id===oldCycleId)).toEqual(before.snapshots.find((s:any)=>s.cycle_id===oldCycleId));
  expect(after.snapshots.length).toBeGreaterThan(before.snapshots.length);
  expect(after.commitment?.cycle_id).not.toBe(before.commitment?.cycle_id);
  expect((await f.state()).cycleSchedules.find(s=>s.teamId===teamId)).toBeDefined();
}

export async function proveTeamCyclesUpgrade() {
  const {applyD1Migrations}=await import('cloudflare:test');
  const {inject}=await import('vitest');
  const {insertHistoricalSample}=await import('./historical-sample-fixture');
  const migrations=inject('migrations'),boundary=migrations.findIndex(m=>m.name==='0121_team_cycles_enabled.sql');
  expect(boundary).toBeGreaterThan(0);
  const db=env.ARCHIVE_TARGET_DB;
  await applyD1Migrations(db,migrations.slice(0,boundary));
  await insertHistoricalSample(db,new Date('2026-10-01T00:00:00Z'));
  const before=(await db.prepare('SELECT * FROM teams ORDER BY id').all()).results;
  const cycles=(await db.prepare('SELECT * FROM cycles ORDER BY id').all()).results;
  const commitments=(await db.prepare('SELECT id,cycle_id FROM issues ORDER BY id').all()).results;
  await applyD1Migrations(db,migrations.slice(boundary));
  const after=(await db.prepare('SELECT * FROM teams ORDER BY id').all()).results;
  expect(after.map(({cycles_enabled,...team})=>team)).toEqual(before);
  expect(after.every(t=>t.cycles_enabled===1)).toBe(true);
  expect((await db.prepare('SELECT * FROM cycles ORDER BY id').all()).results).toEqual(cycles);
  expect((await db.prepare('SELECT id,cycle_id FROM issues ORDER BY id').all()).results).toEqual(commitments);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
}
