import { it,expect } from 'vitest'
import { env } from 'cloudflare:workers'
import { beforeCommit } from './removal-interleaving'
import { setupIntegrations } from './integration-fixture'
import { actor,invite,request } from './base-auth-fixture'

it('[ISSUE-016 ROLE-009] native and scoped templates create an atomic issue graph with current authority and typed fields',async()=>{
  const f=await setupIntegrations(),team=f.initial.teams[0],status=team.statuses.find(s=>s.category==='unstarted')!
  const projectState=await f.mutate('/settings/projects','POST',{name:'synthetic-vector-1600',leadOperatorId:f.owner})
  const project=projectState.projects.find(p=>p.name==='synthetic-vector-1600')!
  const labelState=await f.mutate('/settings/labels','POST',{name:'synthetic-vector-1601',color:'#52637a'})
  const label=labelState.labels.find(l=>l.name==='synthetic-vector-1601')!
  const input={name:'synthetic-vector-1602',teamId:null,defaults:{title:'Bug: investigate',description:'## Reproduce\n\nDescribe the failure.',statusId:status.id,priority:'high',labelIds:[label.id],assigneeOperatorId:f.owner,estimate:5,projectId:project.id},subissues:[{title:'synthetic-vector-1603',description:'Reproduce',priority:'urgent'},{title:'synthetic-vector-1604',description:'Verify',estimate:2}]}
  const made=await f.call('/issue-templates','POST',input);expect(made.status,await made.clone().text()).toBe(201)
  const template=await made.json() as any
  const snapshot=async()=>Promise.all(['issue_templates','issues','issue_labels','issue_parents','issue_activity','issue_followers','issue_mentions','notifications','notification_candidates'].map(async table=>({table,rows:(await env.DB.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results})))
  const unchanged=async(run:()=>Promise<Response>,status:number)=>{const before=await snapshot(),response=await run();expect(response.status,await response.clone().text()).toBe(status);expect(await snapshot()).toEqual(before)}
  const selection={templateId:template.id,templateVersion:1,teamId:team.id}
  const verifyGraph=async(response:Response,expected:Record<string,unknown>,api?:(path:string)=>Promise<Response>)=>{
    expect(response.status,await response.clone().text()).toBe(201)
    const parent=await response.json() as any
    expect(parent).toMatchObject(expected)
    const children=(await env.DB.prepare('SELECT i.id,i.identifier,i.title,i.description,r.parent_issue_id,r.position FROM issue_parents r JOIN issues i ON i.id=r.issue_id WHERE r.parent_issue_id=? ORDER BY r.position').bind(parent.id).all()).results
    expect(children.map(c=>c.title)).toEqual(input.subissues.map(c=>c.title));expect(new Set([parent.id,...children.map(c=>c.id)]).size).toBe(3)
    expect(children.map(c=>c.parent_issue_id)).toEqual([parent.id,parent.id]);expect(children.map(c=>c.position)).toEqual([1,2])
    for(const child of children){const read=await (api?api('/issues/'+child.identifier):f.call('/issues/'+child.identifier));expect(read.status).toBe(200);expect(await read.json()).toMatchObject({id:child.id,identifier:child.identifier,title:child.title,parent:{identifier:parent.identifier}})}
    const detail=await (await f.call('/issues/'+parent.identifier+'/subissues')).json() as any
    expect(detail.children.map((s:any)=>s.identifier)).toEqual(children.map(c=>c.identifier))
    return parent
  }
  const native=await verifyGraph(await f.call('/issues','POST',selection),{title:input.defaults.title,description:input.defaults.description,status:{id:status.id},priority:'high',estimate:5,assignee:{id:f.owner},project:{id:project.id},labels:[{id:label.id}]})
  const token=await f.issueToken(['issues:write','issues:read','issue-templates:read','issue-templates:write'])
  const api=(path:string,method='GET',body?:unknown)=>f.api(token.token,path,method,body)
  expect((await api('/issue-templates')).status).toBe(200)
  const apiParent=await verifyGraph(await api('/issues','POST',{...selection,title:'synthetic-vector-1605',description:'Already typed',priority:'low',labelIds:[],estimate:null,assigneeOperatorId:null,projectId:null}),{title:'synthetic-vector-1605',description:'Already typed',priority:'low',labels:[],estimate:null,assignee:null,project:null},path=>api(path))
  expect(apiParent.id).not.toBe(native.id)
  f.restart()
  expect(await (await f.call('/issue-templates/'+template.id)).json()).toEqual(template)
  const readonly=await f.issueToken(['issue-templates:read'])
  await unchanged(()=>f.api(readonly.token,'/issue-templates','POST',input),401)
  const scopedMade=await api('/issue-templates','POST',{...input,name:'synthetic-vector-1606'});expect(scopedMade.status).toBe(201)
  const scopedTemplate=await scopedMade.json() as any
  expect((await api('/issue-templates/'+scopedTemplate.id,'PUT',{...input,name:'synthetic-vector-1607',expectedVersion:1})).status).toBe(200)
  await unchanged(()=>api('/issues','POST',{...selection,templateId:scopedTemplate.id}),409)
  expect((await api('/issue-templates/'+scopedTemplate.id,'DELETE',{expectedVersion:2})).status).toBe(200)
  await unchanged(()=>api('/issues','POST',{...selection,templateId:scopedTemplate.id,templateVersion:2}),404)
  const member=await invite(['synthetic-vector-1608','example.test'].join('@'),f.cookie,'member'),memberId=await actor(member)
  const memberCall=(path:string,method='GET',body?:unknown)=>request('/api'+path,method,body,member)
  await unchanged(()=>memberCall('/issue-templates','POST',input),403)
  expect((await f.call('/settings/teams/'+team.id+'/members/'+memberId,'PUT',{role:'member'})).status).toBe(200)
  const teamInput={...input,teamId:team.id},memberMade=await memberCall('/issue-templates','POST',teamInput);expect(memberMade.status,await memberMade.clone().text()).toBe(201)
  const teamTemplate=await memberMade.json() as any
  expect((await f.call('/settings/teams/'+team.id+'/permissions','PUT',{settings:'all_members',planning:'team_owners'})).status).toBe(200)
  for(const [path,method,body] of [['/issue-templates','POST',teamInput],['/issue-templates/'+teamTemplate.id,'PUT',{...teamInput,expectedVersion:1}],['/issue-templates/'+teamTemplate.id,'DELETE',{expectedVersion:1}]] as const)await unchanged(()=>memberCall(path,method,body),403)
  expect((await f.call('/settings/teams/'+team.id+'/permissions','PUT',{settings:'all_members',planning:'all_members'})).status).toBe(200)
  const racing=beforeCommit(sql=>sql.includes('INSERT INTO issue_templates'),async()=>{expect((await f.call('/settings/teams/'+team.id+'/permissions','PUT',{settings:'all_members',planning:'team_owners'})).status).toBe(200)})
  await unchanged(()=>request('/api/issue-templates','POST',{...teamInput,name:'synthetic-vector-1614'},member,{DB:racing}),409)
  expect((await f.call('/settings/teams/'+team.id+'/members/'+memberId,'PUT',{role:'owner'})).status).toBe(200)
  expect((await memberCall('/issue-templates/'+teamTemplate.id,'PUT',{...teamInput,expectedVersion:1})).status).toBe(200)
  const guest=await invite(['synthetic-vector-1609','example.test'].join('@'),f.cookie,'member'),guestId=await actor(guest)
  expect((await f.call('/settings/operators/'+guestId+'/role','PATCH',{role:'guest',teamIds:[team.id]})).status).toBe(200)
  const guestCall=(path:string,method='GET',body?:unknown)=>request('/api'+path,method,body,guest)
  await unchanged(()=>guestCall('/issue-templates','POST',teamInput),403)
  expect((await guestCall('/issue-templates/'+template.id)).status).toBe(404)
  const guestCreate=await guestCall('/issues','POST',{...selection,templateId:teamTemplate.id,templateVersion:2,title:'synthetic-vector-1610'});expect(guestCreate.status,await guestCreate.clone().text()).toBe(201)
  expect((await f.call('/settings/teams/'+team.id+'/permissions','PUT',{settings:'team_owners',planning:'all_members'})).status).toBe(200)
  await unchanged(()=>guestCall('/issue-templates','POST',teamInput),403)
  const tokenRace=await f.issueToken(['issues:write'])
  const withdrawn=beforeCommit(sql=>/insert into ["`]?issues/i.test(sql),async()=>{expect((await f.call('/settings/integrations/tokens/'+tokenRace.credential.id,'DELETE')).status).toBe(200)})
  await unchanged(()=>f.api(tokenRace.token,'/issues','POST',selection,{DB:withdrawn}),401)
  const viewer=await invite(['synthetic-vector-1611','example.test'].join('@'),f.cookie,'viewer')
  await unchanged(()=>request('/api/issues','POST',selection,viewer),403)
  await unchanged(()=>request('/api/issue-templates','POST',input,viewer),403)
  const failing={...input,name:'synthetic-vector-1612',subissues:[...input.subissues,{title:'synthetic-vector-1613'}]}
  const failMade=await f.call('/issue-templates','POST',failing);expect(failMade.status).toBe(201);const failTemplate=await failMade.json() as any
  await env.DB.prepare("CREATE TRIGGER synthetic_template_failure BEFORE INSERT ON issues WHEN NEW.title='synthetic-vector-1613' BEGIN SELECT RAISE(ABORT,'synthetic-template-storage-refusal'); END").run()
  const before=await snapshot(),failed=await f.call('/issues','POST',{...selection,templateId:failTemplate.id});expect(failed.status).toBe(500);expect(await snapshot()).toEqual(before)
  await env.DB.prepare('DROP TRIGGER synthetic_template_failure').run()
  // Current property access is checked before any parent or child is persisted.
  expect((await f.call('/settings/labels/'+label.id,'DELETE')).status).toBe(200)
  await unchanged(()=>f.call('/issues','POST',selection),400)
  expect((await f.call('/settings/teams/'+team.id+'/members/'+guestId,'DELETE')).status).toBe(200)
  await unchanged(()=>guestCall('/issues','POST',{...selection,templateId:teamTemplate.id,templateVersion:2}),404)
  expect((await f.call('/settings/integrations/tokens/'+token.credential.id,'DELETE')).status).toBe(200)
  await unchanged(()=>api('/issue-templates'),401)
  expect((await f.call('/issue-templates/'+template.id,'DELETE',{expectedVersion:1})).status).toBe(200)
  expect((await f.call('/issues/'+native.identifier)).status).toBe(200)
},90000)
