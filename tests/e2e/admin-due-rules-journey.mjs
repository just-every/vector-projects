import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { withOperatorClient } from './operator-request.mjs';
import { beforePrivateNavigation } from './collaboration-navigation.mjs';

async function api(page,base,path,method='GET',data){
  return withOperatorClient(page.context(),async client=>{
    const response=await client.fetch(base+'/api'+path,{method,headers:{Origin:base},...(data===undefined?{}:{data})});
    const body=await response.json();assert(response.ok(),`${method} ${path}: ${response.status()}`);return body;
  });
}
export async function dueRuleConfigurationRefusals({page,peer,memberId,runtime,clause,proofDirectory}){
  const {base,sql}=runtime;
  await clause('AUTO-006 ROLE-001','only Owners and Admins configure workspace due-soon rules',async()=>{
    const team=(await api(page,base,'/settings/administration')).teams[0],viewport=peer.viewportSize();
    for(const role of ['member','guest','viewer']){
      await api(page,base,'/settings/operators/'+memberId+'/role','PATCH',{role,...(role==='guest'?{teamIds:[team.id]}:{})});
      const before=sql('SELECT * FROM workspace_due_rules ORDER BY id');
      await withOperatorClient(peer.context(),async client=>{
        const refusal=await client.put(base+'/api/settings/automation/due-soon',{headers:{Origin:base},data:{name:'Forbidden rule',enabled:true,expectedVersion:0}});
        assert.equal(refusal.status(),403);
      });
      assert.deepEqual(sql('SELECT * FROM workspace_due_rules ORDER BY id'),before);
      await beforePrivateNavigation(peer,base+'/app/settings');await peer.goto(base+'/app/settings');
      // The refused role's Settings offers no rule surface at desktop or phone width.
      for(const width of [1440,390]){
        await peer.setViewportSize({width,height:width===390?844:1000});
        await peer.getByRole('heading',{name:'Settings',exact:true}).waitFor();
        assert.equal(await peer.getByRole('region',{name:'Due-soon automation',exact:true}).count(),0);
        assert.equal(await peer.getByRole('form',{name:'Due-soon rule',exact:true}).count(),0);
        if(proofDirectory)await peer.screenshot({path:proofDirectory+'/AUTO-006-'+role+'-refusal-'+width+'.png'});
      }
      await peer.setViewportSize(viewport);
    }
    await api(page,base,'/settings/operators/'+memberId+'/role','PATCH',{role:'member'});
  });
}
export async function dueRulesJourney({page,runtime,clause,capture,proofDirectory}){
  const {base}=runtime,original=(await api(page,base,'/settings')).workspace;
  await clause('AUTO-006','create a persisted due-soon rule and observe its scheduled notification, cycle move and failure history',async()=>{
    const teams=await api(page,base,'/settings/teams','POST',{name:'Due-soon delivery',identifierPrefix:'DUER'});
    const team=teams.teams.find(t=>t.identifierPrefix==='DUER');
    const {operatorId}=await api(page,base,'/session');
    await api(page,base,'/settings','PATCH',{timezone:'America/New_York'});
    const issue=await api(page,base,'/issues','POST',{title:'Prepare the delivery checklist',teamId:team.id,assigneeOperatorId:operatorId,dueDate:'2026-03-10'});
    await beforePrivateNavigation(page,base+'/app/settings#automation');await page.goto(base+'/app/settings#automation');
    const form=page.getByRole('form',{name:'Due-soon rule',exact:true});
    await form.getByLabel('Rule name',{exact:true}).fill('Delivery two days ahead');
    const checkbox=form.getByLabel('Enable due-soon rule',{exact:true});
    await checkbox.focus();await page.keyboard.press('Space');
    const save=page.waitForResponse(r=>r.url().endsWith('/settings/automation/due-soon')&&r.request().method()==='PUT');
    await form.getByRole('button',{name:'Create due-soon rule',exact:true}).click();assert.equal((await save).status(),200);
    await expect(form.getByRole('button',{name:'Save due-soon rule',exact:true})).toBeEnabled();
    const tick=async instant=>withOperatorClient(page.context(),async client=>{
      const response=await client.get(base+'/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *')+'&time='+Date.parse(instant));
      assert.equal(response.status(),200);await response.body();
    });
    await tick('2026-03-08T04:59:00Z');assert.deepEqual((await api(page,base,'/settings/automation')).runs,[]);
    await tick('2026-03-08T07:00:00Z');
    await page.reload();const region=page.getByRole('region',{name:'Due-soon automation',exact:true});
    await region.getByText('No active open cycle',{exact:false}).waitFor();
    assert.equal((await api(page,base,'/issues/'+issue.identifier)).cycle,null);
    const cycles=await api(page,base,'/settings/cycles','POST',{teamId:team.id,name:'Delivery window',startsLocal:'2026-03-01T00:00',endsLocal:'2026-03-15T00:00'});
    const cycle=cycles.cycles.find(c=>c.teamId===team.id);
    await tick('2026-03-08T08:00:00Z');await tick('2026-03-08T08:00:00Z');
    assert.equal((await api(page,base,'/issues/'+issue.identifier)).cycle.id,cycle.id);
    await beforePrivateNavigation(page,base+'/app/settings');await page.goto('about:blank');
    await runtime.stop();await runtime.start();await tick('2026-03-08T08:00:00Z');
    await page.goto(base+'/app/settings#automation');
    const history=await api(page,base,'/settings/automation');assert.equal(history.runs.length,1);assert.equal(history.runs[0].outcome,'succeeded');
    const notifications=await api(page,base,'/notifications');
    assert.equal(notifications.items.filter(n=>n.identifier===issue.identifier&&n.causes.includes('due_reminder')).length,1);
    await page.reload();await expect(form.getByLabel('Rule name',{exact:true})).toHaveValue('Delivery two days ahead');
    await expect(form.getByLabel('Enable due-soon rule',{exact:true})).toBeChecked();
    await region.getByText('Assignee notified',{exact:false}).waitFor();
    // Assertions run at the administration journey's phone width; both widths get one screen proof.
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:width===390?844:1000});await region.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      // A region taller than the phone viewport would stitch the sticky Settings navigation over it.
      if(proofDirectory){
        await region.evaluate(root=>{for(const element of document.querySelectorAll('body *'))if(['fixed','sticky'].includes(getComputedStyle(element).position)&&!root.contains(element)&&!element.contains(root))element.setAttribute('data-capture-hidden','');});
        await region.screenshot({path:proofDirectory+'/AUTO-006-'+width+'.png',style:'[data-capture-hidden] { visibility: hidden !important; }'});
        await page.evaluate(()=>document.querySelectorAll('[data-capture-hidden]').forEach(element=>element.removeAttribute('data-capture-hidden')));
      }
      await capture('due-soon-'+width);
    }
    await form.getByLabel('Enable due-soon rule',{exact:true}).uncheck();
    const disabled=page.waitForResponse(r=>r.url().endsWith('/settings/automation/due-soon')&&r.request().method()==='PUT');
    await form.getByRole('button',{name:'Save due-soon rule',exact:true}).click();assert.equal((await disabled).status(),200);
    // The saved disabled rule leaves the next due-soon issue untouched and unannounced.
    assert.equal((await api(page,base,'/settings/automation')).rule.enabled,false);
    const quiet=await api(page,base,'/issues','POST',{title:'Confirm the paused rule stays quiet',teamId:team.id,assigneeOperatorId:operatorId,dueDate:'2026-03-11'});
    await tick('2026-03-09T08:00:00Z');
    assert.equal((await api(page,base,'/issues/'+quiet.identifier)).cycle,null);
    assert.equal((await api(page,base,'/settings/automation')).runs.length,1);
    assert.equal((await api(page,base,'/notifications')).items.some(n=>n.identifier===quiet.identifier),false);
    await api(page,base,'/settings','PATCH',{timezone:original.timezone,reminderTime:original.reminderTime});
  });
}
