import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { writeRuntimeD1 } from './runtime-d1.mjs'

/** Shared presets stay portable, including definitions saved before status exclusion. */
export async function workspaceTemplateJourney({page,runtime,capture,api,go}) {
  const {base}=runtime,options=await api('/options'),teamA=options.teams[0]
  const statusA=options.statuses.find(s=>s.teamId===teamA.id&&s.category==='unstarted')
  const state=await api('/settings/teams','POST',{name:'Quality engineering',identifierPrefix:'QA'})
  const teamB=state.teams.find(t=>t.identifierPrefix==='QA'),statusB=teamB.statuses.find(s=>s.category==='backlog')
  const defaults={title:'Investigate checkout failure',description:'## Reproduction\n\nRecord the customer steps.'}
  const subissues=[{title:'Reproduce checkout failure',description:'Reproduce the saved card checkout failure.'},{title:'Verify regression coverage',description:'Verify saved cards complete checkout after the fix.'}]
  await go('/app/settings#teams')
  const library=page.getByRole('region',{name:'Issue templates',exact:true})
  await library.getByRole('button',{name:'New issue template',exact:true}).click()
  const form=page.getByRole('form',{name:'Edit issue template',exact:true})
  await form.getByLabel('Issue template scope',{exact:true}).selectOption(teamA.id)
  await form.getByLabel('Issue template name',{exact:true}).fill('Shared bug report')
  await form.getByLabel('Issue defaults title',{exact:true}).fill(defaults.title)
  await form.getByLabel('Issue defaults description',{exact:true}).fill(defaults.description)
  await form.getByText('Issue defaults properties',{exact:true}).click()
  await form.getByLabel('Issue defaults status',{exact:true}).selectOption(statusA.id)
  for(const [i,child] of subissues.entries()) {
    await form.getByRole('button',{name:'Add subissue',exact:true}).click()
    await form.getByLabel(`Subissue ${i+1} title`,{exact:true}).fill(child.title)
    await form.getByLabel(`Subissue ${i+1} description`,{exact:true}).fill(child.description)
    await form.getByText(`Subissue ${i+1} properties`,{exact:true}).click()
    await form.getByLabel(`Subissue ${i+1} status`,{exact:true}).selectOption(statusA.id)
  }
  await form.getByLabel('Issue template scope',{exact:true}).selectOption('')
  await expect(form.getByRole('combobox',{name:/status$/})).toHaveCount(0)
  await capture('workspace-template-management',page)
  await form.getByRole('button',{name:'Save issue template',exact:true}).click()
  await library.getByRole('status').filter({hasText:'Saved Shared bug report.'}).waitFor()
  const template=(await api('/issue-templates')).templates.find(t=>t.name==='Shared bug report')
  assert.equal(template.teamId,null)
  for(const preset of [template.defaults,...template.subissues])assert.equal(preset.statusId,undefined)
  await page.reload();await library.getByRole('button',{name:'Edit Shared bug report',exact:true}).click()
  await expect(form.getByRole('combobox',{name:/status$/})).toHaveCount(0)
  await form.getByRole('button',{name:'Cancel template',exact:true}).click()
  // Historical content represents the exact workspace/status combination admitted by f154.
  // Creation still uses the real browser and scoped routes, never a fixture application path.
  await writeRuntimeD1(base,'UPDATE issue_templates SET defaults_json=?,subissues_json=? WHERE id=?',[
    JSON.stringify({...defaults,statusId:statusA.id}),JSON.stringify(subissues.map(child=>({...child,statusId:statusA.id}))),template.id,
  ])
  const seen=new Set(),width=page.viewportSize().width
  const graph=async(parent,title,door,before)=>{
    const stored=await api('/issues/'+parent.identifier),children=(await api('/issues/'+parent.identifier+'/subissues')).children
    assert.equal(stored.title,title);assert.equal(stored.description,defaults.description)
    assert.equal(stored.team.id,teamB.id);assert.equal(stored.status.id,statusB.id)
    assert.deepEqual(children.map(c=>c.title),subissues.map(c=>c.title))
    for(const [i,child] of children.entries()) {
      const detail=await api('/issues/'+child.identifier)
      assert.equal(detail.id,child.id);assert.equal(detail.parent.identifier,parent.identifier)
      assert.equal(detail.description,subissues[i].description);assert.equal(detail.team.id,teamB.id);assert.equal(detail.status.id,statusB.id)
    }
    for(const issue of [parent,...children]){assert(!seen.has(issue.id));seen.add(issue.id)}
    const after=runtime.sql('SELECT count(*) n FROM issues')[0].n;assert.equal(after,before+3)
    console.log('CROSS_TEAM '+JSON.stringify({width,door,templateId:template.id,templateVersion:template.version,teamId:teamB.id,statusId:statusB.id,statusName:statusB.name,countBefore:before,countAfter:after,parent:{id:parent.id,identifier:parent.identifier,title:stored.title,description:stored.description},children}))
    await go('/app/issues/'+parent.identifier)
    for(const child of children)await page.getByRole('link',{name:new RegExp(child.identifier)}).first().waitFor()
    await capture('workspace-template-'+door+'-linked-children',page)
  }
  await go('/app/new-issue')
  await expect(page.getByRole('button',{name:'Create issue',exact:true})).toBeEnabled()
  await page.getByLabel(/^Team/).selectOption(teamB.id)
  await page.getByLabel('Title',{exact:false}).first().fill('Checkout fails for saved cards')
  await page.getByRole('combobox',{name:'Issue template',exact:true}).selectOption(template.id)
  await page.getByRole('button',{name:'Apply template defaults',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Shared bug report · 2 subissues'}).waitFor()
  assert.equal(await page.getByLabel('Description',{exact:false}).first().inputValue(),defaults.description)
  await capture('workspace-template-other-team-applied',page)
  const before=runtime.sql('SELECT count(*) n FROM issues')[0].n
  const submission=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/issues'&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Create issue',exact:true}).click()
  const response=await submission;assert.equal(response.status(),201)
  const parent=await response.json();await page.waitForURL(base+'/app/issues/'+parent.identifier)
  await graph(parent,'Checkout fails for saved cards','browser',before)
  const token=await api('/settings/integrations/tokens','POST',{name:'synthetic-vector-1651',scopes:['issues:write']})
  try {
    const before=runtime.sql('SELECT count(*) n FROM issues')[0].n
    const scoped=await page.request.post(base+'/api/v1/issues',{headers:{Authorization:'Bearer '+token.token,Origin:base},data:{teamId:teamB.id,templateId:template.id,templateVersion:template.version}})
    assert.equal(scoped.status(),201)
    await graph(await scoped.json(),defaults.title,'scoped',before)
  }finally{await api('/settings/integrations/tokens/'+token.credential.id,'DELETE')}
  console.log('PROBE ISSUE-016 cross-team: workspace editor excludes statuses; legacy Team A parent/child statuses -> browser and /api/v1 create exact linked graphs in Team B using its backlog default')
}
