import { inviteReader } from './role-reader-support.mjs';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { navigate } from './collaboration-navigation.mjs';
import { openTeam, switchRow } from './settings-pane-support.mjs';
import { openDisclosures } from './ui-controls-checks.mjs';
import { roleScreens } from './role-ui-support.mjs';

/** One Settings journey exercises a disabled team and an independent enabled team. */
export async function teamCyclesSettings({page,runtime,clause,evidence,peer,memberId}) {
  const {base,sql}=runtime, inspect=roleScreens(evidence);
  const send=async(actor,path,method='GET',data,status=200)=>{
    const response=await actor.request.fetch(base+'/api'+path,{method,headers:{Origin:base},...(data===undefined?{}:{data})});
    assert.equal(response.status(),status,method+' '+path+' '+await response.text());
    return response.status()===204?undefined:response.json();
  };
  const createTeam=async(name,prefix)=> (await send(page,'/settings/teams','POST',{name,identifierPrefix:prefix})).teams.find(t=>t.identifierPrefix===prefix);
  const team=await createTeam('Cycle feature delivery','SYNCYCL');
  const other=await createTeam('Independent cycle delivery','SYNKEEP');
  const path='/settings/teams/'+team.id;
  const now=Date.now(), local=days=>new Date(now+days*86400000).toISOString().slice(0,16);
  const createCycle=async(t,name)=> (await send(page,'/settings/cycles','POST',{teamId:t.id,name,startsLocal:local(-1),endsLocal:local(7)})).cycles.find(c=>c.teamId===t.id&&c.name===name);
  const cycle=await createCycle(team,'Retained delivery cycle'), independent=await createCycle(other,'Independent delivery cycle');
  await send(page,path+'/cycle-schedule','PUT',{weeks:2,startWeekday:1,cooldownWeeks:0,upcomingCount:2});
  const makeIssue=async(t,c,title)=>send(page,'/issues','POST',{teamId:t.id,cycleId:c.id,title,statusId:t.statuses.find(s=>s.category==='unstarted').id},201);
  const committed=await makeIssue(team,cycle,'Retained cycle commitment');
  const unrelated=await makeIssue(other,independent,'Independent cycle commitment');
  const retained=()=>({
    cycles:sql(`SELECT * FROM cycles WHERE team_id='${team.id}' ORDER BY id`),
    schedule:sql(`SELECT * FROM team_cycle_schedules WHERE team_id='${team.id}'`),
    issues:sql(`SELECT id,cycle_id FROM issues WHERE team_id='${team.id}' ORDER BY id`),
    history:sql(`SELECT * FROM cycle_membership_events WHERE cycle_id IN (SELECT id FROM cycles WHERE team_id='${team.id}') ORDER BY id`),
    snapshots:sql(`SELECT s.* FROM cycle_snapshots s JOIN cycles c ON c.id=s.cycle_id WHERE c.team_id='${team.id}' ORDER BY s.cycle_id`),
  });
  const before=retained();
  // Enable cycles is a switch in the team's Planning tab that stores as it flips: no Save button.
  const cyclesSwitch=actor=>actor.getByRole('switch',{name:'Enable cycles',exact:true});
  const saveSwitch=async(actor,enabled)=>{
    await openTeam(actor,base,team,'planning');
    const control=cyclesSwitch(actor);
    await expect(control).toBeEnabled();
    await control.focus();
    assert.equal(await control.evaluate(element=>element===document.activeElement),true,'keyboard reaches cycle setting');
    assert.equal(await actor.getByRole('button',{name:'Save team',exact:true}).count(),0);
    if(await control.isChecked()!==enabled){
      const receipt=actor.waitForResponse(r=>new URL(r.url()).pathname==='/api'+path&&r.request().method()==='PATCH');
      await switchRow(actor,'Enable cycles').click();
      assert.equal((await receipt).status(),200);
    }
    await expect(cyclesSwitch(actor)).toBeChecked({checked:enabled});
    // With cycles off the schedule is gone from Planning; on, it is there again.
    assert.equal(await actor.getByLabel('Cycle length',{exact:true}).count(),enabled?1:0);
    return actor.locator('.settings-pane');
  };
  const probe=await inviteReader({owner:page,browser:page.context().browser(),runtime,email:'synthetic-vector-2506'+'@'+'vector.test',name:'synthetic-vector-2506',role:'member',width:390});
  try {
  await clause('TEAM-005','team Settings disables cycles across editor and Current without discarding commitments; re-enable and current permissions',async()=>{
    await navigate(page,base+'/app');
    await expect(page.locator('.stream-list [data-issue-identifier="'+committed.identifier+'"]')).toBeVisible();
    await expect(page.locator('.stream-list [data-issue-identifier="'+unrelated.identifier+'"]')).toBeVisible();
    const form=await saveSwitch(page,false);
    await inspect(page,form,'team-cycles-disabled-settings');
    await page.reload();
    await openTeam(page,base,team,'planning');
    await expect(cyclesSwitch(page)).not.toBeChecked();
    await navigate(page,base+'/app/issues/'+committed.identifier);
    await expect(page.getByRole('heading',{name:committed.title,exact:true})).toBeVisible();
    await expect(page.getByRole('combobox',{name:'Issue cycle',exact:true})).toHaveCount(0);
    await inspect(page,page.locator('main'),'team-cycles-disabled-editor');
    await page.getByRole('button',{name:'Add 👍 reaction',exact:true}).focus();
    await expect(page.getByRole('tooltip',{name:'Add 👍 reaction',exact:true})).toBeVisible();
    await page.keyboard.press('Tab');
    await navigate(page,base+'/app/new-issue');
    await page.getByLabel(/^Team/).selectOption(team.id);
    await openDisclosures(page);
    await expect(page.getByRole('combobox',{name:'Cycle',exact:true})).toHaveCount(0);
    await page.getByLabel(/^Team/).selectOption(other.id);
    await expect(page.getByRole('combobox',{name:'Cycle',exact:true})).toBeVisible();
    await expect(page.getByRole('combobox',{name:'Cycle',exact:true}).locator('option[value="'+independent.id+'"]')).toHaveCount(1);
    await navigate(page,base+'/app/cycles/'+cycle.id);
    await expect(page.getByRole('heading',{name:cycle.name,exact:true})).toBeVisible();
    await expect(page.getByRole('form',{name:'Commit issue to cycle',exact:true})).toHaveCount(0);
    await navigate(page,base+'/app');
    await expect(page.getByRole('heading',{name:'Current',exact:true})).toBeVisible();
    await expect(page.locator('.stream-list [data-issue-identifier="'+committed.identifier+'"]')).toHaveCount(0);
    await expect(page.locator('.stream-list [data-issue-identifier="'+unrelated.identifier+'"]')).toBeVisible();
    await inspect(page,page.locator('main'),'team-cycles-disabled-current');
    await navigate(page,base+'/app/issues');
    await page.getByRole('checkbox',{name:'Select '+committed.identifier,exact:true}).check();
    await expect(page.getByRole('combobox',{name:'Change',exact:true}).locator('option[value="cycleId"]')).toHaveCount(0);
    assert.deepEqual(retained(),before,'disabling and reload retain all stored cycle state');
    await saveSwitch(page,true);
    await navigate(page,base+'/app/issues/'+committed.identifier);
    await expect(page.getByRole('combobox',{name:'Issue cycle',exact:true})).toHaveValue(cycle.id);
    await inspect(page,page.locator('main'),'team-cycles-enabled-editor');
    await navigate(page,base+'/app');
    await expect(page.locator('.stream-list [data-issue-identifier="'+committed.identifier+'"]')).toBeVisible();
    await inspect(page,page.locator('main'),'team-cycles-enabled-current');
    assert.deepEqual(retained(),before,'re-enabling retains original cycle identities and commitments');
    // The same Member session sees each current grant, with refused storage unchanged.
    await send(page,path+'/members/'+memberId,'PUT',{role:'member'});
    await send(page,path+'/permissions','PUT',{settings:'all_members',planning:'all_members'});
    await saveSwitch(peer,false);
    await send(page,path+'/permissions','PUT',{settings:'team_owners',planning:'all_members'});
    const protectedState=sql('SELECT * FROM teams ORDER BY id');
    await send(peer,path,'PATCH',{cyclesEnabled:true},403);
    assert.deepEqual(sql('SELECT * FROM teams ORDER BY id'),protectedState);
    await send(page,path,'PATCH',{cyclesEnabled:true});
    const unchanged=()=>({teams:sql('SELECT * FROM teams ORDER BY id'),audit:sql('SELECT * FROM audit_records ORDER BY id'),history:retained()});
    for(const permission of ['team_owners','all_members']) {
      await send(page,path+'/permissions','PUT',{settings:permission,planning:'all_members'});
      for(const role of ['admin','guest','viewer','member']) {
        await send(page,'/settings/operators/'+probe.id+'/role','PATCH',{role,teamIds:role==='guest'?[team.id]:[]});
        if(role==='member')await send(page,path+'/members/'+probe.id,'PUT',{role:'member'});
        const before=unchanged(),allowed=role==='admin'||role==='member'&&permission==='all_members';
        await send(probe.page,path,'PATCH',{cyclesEnabled:false},allowed?200:403);
        if(allowed)await send(page,path,'PATCH',{cyclesEnabled:true});
        else assert.deepEqual(unchanged(),before,role+' refusal leaves storage unchanged');
      }
    }
    await send(page,path+'/permissions','PUT',{settings:'team_owners',planning:'all_members'});
    assert.deepEqual(retained(),before,'authority probes retain history');
  });
  assert.deepEqual(probe.errors,[],'role probe has no browser errors');
  } finally {await probe.context.close();}
}
