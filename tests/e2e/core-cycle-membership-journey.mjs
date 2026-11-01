import { withOperatorClient } from './operator-request.mjs';
import assert from 'node:assert/strict';
import { beforePrivateNavigation } from './collaboration-navigation.mjs';

export async function cycleMembershipJourney(page, context, base, record = async () => {}) {
  async function api(path, method='GET', data) {
    return withOperatorClient(context, async client => {
      const response=await client.fetch(base+'/api'+path,{method,headers:{Origin:base},...(data===undefined?{}:{data})});
      assert(response.ok(),`${method} ${path}: ${response.status()}`); return await response.json();
    });
  }
  const suffix=String(Date.now()), prefix='CM'+suffix.slice(-5).replaceAll(/\d/g,d=>String.fromCharCode(65+Number(d)));
  const administration=await api('/settings/teams','POST',{name:'Checkout delivery '+suffix,identifierPrefix:prefix});
  const team=administration.teams.find(t=>t.identifierPrefix===prefix);
  const now=Date.now(), local=days=>new Date(now+days*86400000).toISOString().slice(0,16);
  // Team dates use the workspace zone; UTC makes this fixture independent of the host.
  await api('/settings','PATCH',{timezone:'UTC'});
  await api('/settings/cycles','POST',{teamId:team.id,name:'Checkout reliability '+suffix,startsLocal:local(-1),endsLocal:local(6),capacity:30});
  const active=(await api('/settings/administration')).cycles.find(c=>c.teamId===team.id);
  const create=title=>api('/issues','POST',{teamId:team.id,title,description:'Keep checkout available while payment providers are slow.',estimate:3});
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await beforePrivateNavigation(page,base+'/app/settings/teams/'+team.id+'/planning'); await page.goto(base+'/app/settings/teams/'+team.id+'/planning');
    // The two auto-add rules store as they flip: no Save button.
    const rules=page.getByRole('region',{name:'Add work automatically',exact:true});
    for(const when of ['starts','completes']){
      const row=rules.locator('label.switch-row').filter({hasText:'when it '+when});
      await row.waitFor();
      if(await rules.getByRole('switch',{name:'Add uncommitted work to the active cycle when it '+when}).isChecked())continue;
      const saved=page.waitForResponse(r=>r.url()===base+'/api/settings/teams/'+team.id&&r.request().method()==='PATCH');
      await row.click(); assert.equal((await saved).status(),200);
    }
    assert.equal(await rules.getByRole('button',{name:/^Save(?!d)/}).count(),0);
    const form=rules;
    await form.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await record('CYCLE-008',`rules-${width}`,page);
    const issue=await create(`Recover a delayed checkout at ${width}px`);
    await beforePrivateNavigation(page,base+'/app/issues/'+issue.identifier); await page.goto(base+'/app/issues/'+issue.identifier);
    const status=page.getByRole('combobox',{name:'Issue status',exact:true});
    await status.waitFor({state:'visible'}); await page.waitForFunction(()=>[...document.querySelectorAll('select')].some(s=>s.getAttribute('aria-label')==='Issue status'&&!s.disabled));
    await status.selectOption(team.statuses.find(s=>s.category==='started').id);
    await page.locator('.issue-history > summary').click();
    await page.getByText('Added to the active cycle automatically',{exact:true}).waitFor();
    const current=await api('/issues/'+issue.identifier);
    assert.equal(current.cycle?.id,active.id);
    assert.equal(current.activity.filter(a=>a.kind==='issue.cycle_automatically_added').length,1);
    assert(current.activity.some(a=>a.actor==='Cycle membership automation'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await record('CYCLE-008',`started-${width}`,page);
    await page.getByText('Added to the active cycle automatically',{exact:true}).scrollIntoViewIfNeeded();
    await record('CYCLE-008',`activity-${width}`,page);
    const completed=await create(`Reconcile a recovered payment at ${width}px`);
    await beforePrivateNavigation(page,base+'/app/issues/'+completed.identifier); await page.goto(base+'/app/issues/'+completed.identifier);
    await page.getByRole('combobox',{name:'Issue status',exact:true}).selectOption(team.statuses.find(s=>s.category==='completed').id);
    await page.locator('.issue-history > summary').click();
    await page.getByText('Added to the active cycle automatically',{exact:true}).waitFor();
    assert.equal((await api('/issues/'+completed.identifier)).cycle?.id,active.id);
    await record('CYCLE-008',`completed-${width}`,page);
  }
  await api('/settings/teams/'+team.id,'PATCH',{autoCycleStarted:false,autoCycleCompleted:false});
}
