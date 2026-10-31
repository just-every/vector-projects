import { workspaceTemplateJourney } from './issue-template-workspace-journey.mjs'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { withOperatorClient } from './operator-request.mjs'
import { beforePrivateNavigation } from './collaboration-navigation.mjs'

/** Reached by the existing administration Verify journey; assertions use its one phone width. */
export async function issueTemplatesJourney({page,runtime,capture,expectedTemplateConflicts=new Set()}) {
  const base=runtime.base,context=page.context(),errors=[]
  const onError=e=>errors.push(e.message)
  page.on('pageerror',onError)
  const api=async(path,method='GET',data)=>withOperatorClient(context,async client=>{
    const response=await client.fetch(base+'/api'+path,{method,headers:{Origin:base},...(data===undefined?{}:{data})})
    assert(response.ok(),method+' '+path+' '+response.status());return response.json()
  })
  const go=async path=>{await beforePrivateNavigation(page,base+path);await page.goto(base+path)}
  try {
    const options=await api('/options'),team=options.teams[0],status=options.statuses.find(s=>s.teamId===team.id&&s.category==='unstarted')
    assert(team&&status,'a native team and unstarted status are available')
    const labelState=await api('/settings/labels','POST',{name:'synthetic-vector-1620',color:'#52637a'})
    const label=labelState.labels.find(l=>l.name==='synthetic-vector-1620')
    const projects=await api('/settings/projects','POST',{name:'synthetic-vector-1621',leadOperatorId:options.operator.id})
    const project=projects.projects.find(p=>p.name==='synthetic-vector-1621')
    await go('/app/settings#teams')
    const library=page.getByRole('region',{name:'Issue templates',exact:true})
    await library.getByRole('button',{name:'New issue template',exact:true}).click()
    const form=page.getByRole('form',{name:'Edit issue template',exact:true})
    await form.getByLabel('Issue template scope',{exact:true}).selectOption(team.id)
    await form.getByLabel('Issue template name',{exact:true}).fill('synthetic-vector-1622')
    await form.getByLabel('Issue defaults title',{exact:true}).fill('synthetic-vector-1623')
    const description=form.getByLabel('Issue defaults description',{exact:true})
    await description.fill('/h2');await description.press('Enter');await description.pressSequentially('Bug details')
    const markdown=await description.inputValue();assert.equal(markdown,'## Bug details')
    await form.getByText('Issue defaults properties',{exact:true}).click()
    await form.getByLabel('Issue defaults status',{exact:true}).selectOption(status.id)
    await form.getByLabel('Issue defaults priority',{exact:true}).selectOption('high')
    await form.getByLabel('Issue defaults estimate',{exact:true}).fill('5')
    await form.getByLabel('Issue defaults project',{exact:true}).selectOption(project.id)
    await form.getByLabel('Issue defaults assignee',{exact:true}).selectOption(options.operator.id)
    await form.getByLabel(label.name,{exact:true}).check()
    for(const [i,title] of ['synthetic-vector-1624','synthetic-vector-1625'].entries()) {
      await form.getByRole('button',{name:'Add subissue',exact:true}).click()
      await form.getByLabel('Subissue '+(i+1)+' title',{exact:true}).fill(title)
      await form.getByLabel('Subissue '+(i+1)+' description',{exact:true}).fill('Verify child '+(i+1))
    }
    const bold=description.locator('..').getByRole('button',{name:'Bold text',exact:true})
    await bold.focus();await page.getByRole('tooltip',{name:'Bold text',exact:true}).waitFor();await description.focus()
    await capture('issue-template-management',page)
    await form.getByRole('button',{name:'Save issue template',exact:true}).click()
    await library.getByRole('status').filter({hasText:'Saved synthetic-vector-1622.'}).waitFor()
    const template=(await api('/issue-templates')).templates.find(t=>t.name==='synthetic-vector-1622')
    assert.deepEqual(template.defaults,{title:'synthetic-vector-1623',description:markdown,statusId:status.id,priority:'high',assigneeOperatorId:options.operator.id,estimate:5,projectId:project.id,labelIds:[label.id]})
    assert.deepEqual(template.subissues.map(c=>c.title),['synthetic-vector-1624','synthetic-vector-1625'])
    await page.reload();await library.getByRole('button',{name:'Edit '+template.name,exact:true}).click()
    assert.equal(await form.getByLabel('Issue defaults description',{exact:true}).inputValue(),markdown)
    await form.getByRole('button',{name:'Cancel template',exact:true}).click()
    await go('/app/new-issue')
    const issueForm=page.locator('.new-issue-form')
    await expect(issueForm.getByRole('button',{name:'Create issue',exact:true})).toBeEnabled()
    await issueForm.getByLabel(/^Team/).selectOption(team.id)
    await issueForm.getByLabel('Title',{exact:false}).first().fill('synthetic-vector-1626')
    await issueForm.getByLabel('Description',{exact:false}).first().fill('Already typed description')
    await issueForm.getByText('Optional context',{exact:true}).click()
    await issueForm.getByLabel('Priority',{exact:true}).selectOption('none')
    await issueForm.getByLabel(/^Team/).selectOption('')
    await issueForm.getByLabel(/^Team/).selectOption(team.id)
    await issueForm.getByRole('combobox',{name:'Issue template',exact:true}).selectOption(template.id)
    // While the current definition is loading, submission cannot race ahead without its children.
    let releaseTemplate,finishTemplate
    const templateRead=base+'/api/issue-templates/'+template.id
    const held=new Promise(resolve=>{releaseTemplate=resolve})
    const finished=new Promise(resolve=>{finishTemplate=resolve})
    const holdTemplate=async route=>{try{await held;await route.continue()}finally{finishTemplate()}}
    await page.route(templateRead,holdTemplate)
    await issueForm.getByRole('button',{name:'Apply template defaults',exact:true}).click()
    await expect(issueForm.getByRole('button',{name:'Create issue',exact:true})).toBeDisabled()
    releaseTemplate();await finished;await page.unroute(templateRead,holdTemplate)

    await page.getByRole('status').filter({hasText:template.name+' · 2 subissues'}).waitFor()
    assert.equal(await issueForm.getByLabel('Title',{exact:false}).first().inputValue(),'synthetic-vector-1626')
    assert.equal(await issueForm.getByLabel('Description',{exact:false}).first().inputValue(),'Already typed description')
    assert.equal(await issueForm.getByLabel('Priority',{exact:true}).inputValue(),'none','a deliberate no-priority selection survives')
    assert.equal(await issueForm.getByLabel('Estimate',{exact:false}).inputValue(),'5')
    assert.equal(await issueForm.getByLabel('Project',{exact:true}).inputValue(),project.id)
    await capture('issue-template-application',page)
    const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/issues'&&r.request().method()==='POST')
    await issueForm.getByRole('button',{name:'Create issue',exact:true}).click()
    const response=await created;assert.equal(response.status(),201);const parent=await response.json()
    await page.waitForURL(base+'/app/issues/'+parent.identifier)
    const children=await api('/issues/'+parent.identifier+'/subissues')
    assert.deepEqual(children.children.map(c=>c.title),['synthetic-vector-1624','synthetic-vector-1625'])
    assert.equal(new Set([parent.id,...children.children.map(c=>c.id)]).size,3)
    for(const child of children.children){await page.getByRole('link',{name:new RegExp(child.identifier)}).first().waitFor();assert.equal((await api('/issues/'+child.identifier)).parent.identifier,parent.identifier)}
    const stored=await api('/issues/'+parent.identifier)
    assert.equal(stored.title,'synthetic-vector-1626');assert.equal(stored.description,'Already typed description');assert.equal(stored.priority,'none')
    assert.deepEqual(stored.labels.map(l=>l.id),[label.id]);assert.equal(stored.status.id,status.id)
    await capture('issue-template-linked-children',page)
    const token=await api('/settings/integrations/tokens','POST',{name:'synthetic-vector-1627',scopes:['issues:write','issues:read']})
    const apiResponse=await page.request.post(base+'/api/v1/issues',{headers:{Authorization:'Bearer '+token.token,Origin:base},data:{teamId:team.id,templateId:template.id,templateVersion:template.version}})
    assert.equal(apiResponse.status(),201);const second=await apiResponse.json();assert.equal(second.title,'synthetic-vector-1623');assert.equal(second.description,markdown)
    const secondChildren=(await api('/issues/'+second.identifier+'/subissues')).children
    assert.deepEqual(secondChildren.map(c=>c.title),children.children.map(c=>c.title));assert(secondChildren.every(c=>!children.children.some(old=>old.id===c.id)))
    for(const child of secondChildren)assert.equal((await api('/issues/'+child.identifier)).parent.identifier,second.identifier)
    // Selection captures a version. A concurrent edit is refused before any graph is created.
    await go('/app/new-issue');await expect(page.getByRole('button',{name:'Create issue',exact:true})).toBeEnabled()
    await page.getByLabel(/^Team/).selectOption(team.id)
    await page.getByRole('combobox',{name:'Issue template',exact:true}).selectOption(template.id)
    await page.getByRole('button',{name:'Apply template defaults',exact:true}).click()
    await page.getByRole('status').filter({hasText:template.name+' · 2 subissues'}).waitFor()
    const {id,version,canEdit,...input}=template
    await api('/issue-templates/'+id,'PUT',{...input,expectedVersion:version,name:'synthetic-vector-1628'})
    const before=runtime.sql('SELECT count(*) n FROM issues')[0].n
    expectedTemplateConflicts.add(base+'/api/issues')
    const stale=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/issues'&&r.request().method()==='POST')
    await page.getByRole('button',{name:'Create issue',exact:true}).click();assert.equal((await stale).status(),409)
    await page.getByRole('alert').filter({hasText:'Template changed'}).waitFor();assert.equal(runtime.sql('SELECT count(*) n FROM issues')[0].n,before)
    await go('/app/settings#teams');await library.getByRole('button',{name:'Edit synthetic-vector-1628',exact:true}).click()
    await form.getByLabel('Confirm template deletion',{exact:true}).check();await form.getByRole('button',{name:'Delete issue template',exact:true}).click()
    await library.getByRole('status').filter({hasText:'Template deleted.'}).waitFor()
    assert.equal((await api('/issues/'+parent.identifier+'/subissues')).children.length,2)
    await api('/settings/integrations/tokens/'+token.credential.id,'DELETE')
    // Complete the stale attempt as an ordinary issue, retiring its unsent draft
    // before the separate workspace-template creation starts (the gate's sequence).
    await go('/app/new-issue');await expect(page.getByRole('button',{name:'Create issue',exact:true})).toBeEnabled()
    await page.getByLabel('Title',{exact:false}).first().fill('Investigate checkout regression')
    const ordinary=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/issues'&&r.request().method()==='POST')
    await page.getByRole('button',{name:'Create issue',exact:true}).click();assert.equal((await ordinary).status(),201)
    await page.waitForURL(/\/app\/issues\//)
    console.log('PROBE ISSUE-016 ordinary: native browser issue without template -> 201')
    await workspaceTemplateJourney({page,runtime,capture,api,go})
    assert.deepEqual(errors,[],'no browser exceptions or hydration errors')
    console.log('PROBE ISSUE-016 browser: create template, apply over typed fields, submit -> exact parent and two children; stale application refused unchanged; deletion retains graph')
    console.log('PROBE ISSUE-016 scoped: POST native template selection -> exact prefills and two distinct children linked to the returned parent')
  }finally{page.off('pageerror',onError)}
}
