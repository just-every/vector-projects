import { expect } from 'vitest'
import { env } from 'cloudflare:workers'
import type { setupIntegrations } from './integration-fixture'
import type { IssueTemplate,TemplateInput } from '../../src/core/features/issue-templates/schema'

type Call=(path:string,method?:string,body?:unknown)=>Promise<Response>
export async function proveWorkspaceTemplates(f:Awaited<ReturnType<typeof setupIntegrations>>,template:IssueTemplate,input:TemplateInput,api:Call,unchanged:(run:()=>Promise<Response>,status:number)=>Promise<void>) {
  const sourceStatus=f.initial.teams[0].statuses.find(s=>s.category==='unstarted')!
  // Both save doors refuse parent and child team statuses without a partial write.
  for(const save of [f.call,api])for(const properties of [
    {defaults:{...input.defaults,statusId:sourceStatus.id}},
    {subissues:input.subissues.map(child=>({...child,statusId:sourceStatus.id}))},
  ]) {
    await unchanged(()=>save('/issue-templates','POST',{...input,...properties}),400)
    await unchanged(()=>save('/issue-templates/'+template.id,'PUT',{...input,...properties,expectedVersion:template.version}),400)
  }
  const state=await f.mutate('/settings/teams','POST',{name:'synthetic-vector-1650',identifierPrefix:'QA'})
  const team=state.teams.find(t=>t.identifierPrefix==='QA')!,status=team.statuses.find(s=>s.category==='backlog')!
  // Reproduce content saved by the earlier implementation, then use public creation doors.
  await env.DB.prepare('UPDATE issue_templates SET defaults_json=?,subissues_json=? WHERE id=?').bind(
    JSON.stringify({...input.defaults,statusId:sourceStatus.id}),
    JSON.stringify(input.subissues.map(child=>({...child,statusId:sourceStatus.id}))),template.id,
  ).run()
  const seen=new Set<string>()
  for(const create of [f.call,api]) {
    const before=await env.DB.prepare('SELECT count(*) n FROM issues').first<number>('n')
    const response=await create('/issues','POST',{teamId:team.id,templateId:template.id,templateVersion:template.version})
    expect(response.status,await response.clone().text()).toBe(201)
    const parent=await response.json() as any
    expect(parent).toMatchObject({title:input.defaults.title,description:input.defaults.description,team:{id:team.id},status:{id:status.id}})
    const graph=await (await f.call('/issues/'+parent.identifier+'/subissues')).json() as any
    expect(graph.children.map((child:any)=>child.title)).toEqual(input.subissues.map(child=>child.title))
    for(const [index,child] of graph.children.entries()) {
      const detail=await (await f.call('/issues/'+child.identifier)).json() as any
      expect(detail).toMatchObject({id:child.id,identifier:child.identifier,title:input.subissues[index].title,description:input.subissues[index].description,team:{id:team.id},status:{id:status.id},parent:{identifier:parent.identifier}})
    }
    for(const issue of [parent,...graph.children]){expect(seen.has(issue.id)).toBe(false);seen.add(issue.id)}
    expect(await env.DB.prepare('SELECT count(*) n FROM issues').first<number>('n')).toBe(before!+3)
  }
  // The legacy status was ignored, while explicitly supplied destination status still wins.
  const typed=team.statuses.find(s=>s.category==='unstarted')!
  const explicit=await api('/issues','POST',{teamId:team.id,templateId:template.id,templateVersion:template.version,statusId:typed.id})
  expect(explicit.status).toBe(201);expect((await explicit.json() as any).status.id).toBe(typed.id)
  // Restore the current definition for the existing stale/version and authority proofs.
  await env.DB.prepare('UPDATE issue_templates SET defaults_json=?,subissues_json=? WHERE id=?').bind(JSON.stringify(input.defaults),JSON.stringify(input.subissues),template.id).run()
}
