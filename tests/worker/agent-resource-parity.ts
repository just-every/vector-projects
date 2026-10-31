import {env} from 'cloudflare:workers';
import {expect} from 'vitest';
import {agentRequest} from './agent-resource-journey';
import {origin} from './base-auth-fixture';
import {snapshot,type roleWorkspace,type Person} from './role-fixture';

type Workspace=Awaited<ReturnType<typeof roleWorkspace>>;
async function json(response:Response,status=200):Promise<any>{
  expect(response.status,await response.clone().text()).toBe(status);
  return response.json();
}

/** Native records and independently authenticated callers, with no projection mocks. */
export async function resourceParityJourney(w:Workspace) {
  const owner=w.people.owner,member=w.member;
  expect(owner.cookie).not.toBe(member.cookie);
  expect((await json(await owner.call('/session'))).role).toBe('owner');
  expect((await json(await member.call('/session'))).role).toBe('member');
  const team=(await json(await owner.call('/settings/teams','POST',{
    name:'synthetic-vector-3401',identifierPrefix:'SYNRES',isPrivate:true,
  }))).teams.find((team:any)=>team.name==='synthetic-vector-3401');
  await json(await owner.call(`/settings/teams/${team.id}/members/${member.id}`,'PUT',{role:'member'}));
  const issue=await json(await owner.call('/intake','POST',{
    teamId:team.id,title:'synthetic-vector-3402',description:'synthetic-vector-3403',
    summary:'synthetic-vector-3404',measurements:{delay:0,confirmed:true},
    customerReports:[{customer:'synthetic-vector-3405',summary:'synthetic-vector-3406',link:null}],
  }),201);
  const path=`/issues/${issue.identifier}`;
  const root=await json(await owner.call(path+'/comments','POST',{body:'synthetic-vector-3407'}),201);
  const reply=await json(await member.call(path+'/comments','POST',{body:'synthetic-vector-3408',parentId:root.id}),201);
  await json(await member.call(path+'/comments/'+reply.id,'PATCH',{body:'synthetic-vector-3409'}));
  await json(await owner.call(path+'/comments/'+root.id+'/resolution','POST',{resolved:true}));
  const deleted=await json(await member.call(path+'/comments','POST',{body:'synthetic-vector-3410'}),201);
  await json(await member.call(path+'/comments/'+deleted.id,'DELETE'));
  await json(await agentRequest('/agents/api/policy',{
    method:'PUT',headers:{Origin:origin,Cookie:owner.cookie,'Content-Type':'application/json'},
    body:JSON.stringify({document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'autonomous'}],spend:{none:true}}}),
  }));
  let id=0;
  const client=async(person:Person)=>{
    const {token}=await json(await person.call('/settings/integrations/tokens','POST',{
      name:'synthetic-vector-3411',scopes:['evidence:read'],
    }),201);
    return async(uri:string)=>{
      const response=await agentRequest('/mcp',{method:'POST',headers:{Origin:origin,
        Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',
        'MCP-Protocol-Version':'2025-11-25','Mcp-Method':'resources/read'},
        body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'resources/read',params:{uri}})});
      return {status:response.status,body:await response.json() as any};
    };
  };
  const readers=await Promise.all([client(owner),client(member)]);
  for(const [index,person] of [owner,member].entries()){
    const read=readers[index];
    const native=await json(await person.call(path));
    const projection=await read('vector://issue/'+issue.id);
    expect(projection.status).toBe(200);
    const content=projection.body.result.contents[0];
    expect(content).toMatchObject({uri:'vector://issue/'+issue.id,mimeType:'application/json',_meta:{'com.runeditrun/untrusted':true}});
    expect(JSON.parse(content.text)).toEqual(native);
    expect(native.evidence).toEqual([expect.objectContaining({summary:'synthetic-vector-3404',actor:expect.any(String),measurements:{delay:0,confirmed:true},customerReports:[expect.objectContaining({summary:'synthetic-vector-3406'})]})]);
    expect(native.activity).toEqual(expect.arrayContaining([expect.objectContaining({kind:'comment.created',actor:expect.any(String)}),expect.objectContaining({kind:'comment.edited',actor:expect.any(String)})]));
    const discussion=await json(await person.call(path+'/discussion'));
    expect(discussion.comments).toHaveLength(3);
    for(const comment of discussion.comments){
      const response=await read('vector://comment/'+comment.id);
      expect(response.status).toBe(200);
      expect(response.body.result.contents[0]._meta['com.runeditrun/untrusted']).toBe(true);
      expect(JSON.parse(response.body.result.contents[0].text)).toEqual(comment);
    }
    expect(discussion.comments.find((c:any)=>c.id===root.id)).toMatchObject({canEdit:index===0?1:0,canDelete:index===0?1:0,resolvedBy:expect.any(String),resolvedAt:expect.any(String)});
    expect(discussion.comments.find((c:any)=>c.id===reply.id)).toMatchObject({body:'synthetic-vector-3409',parentId:root.id,canEdit:index===1?1:0,canDelete:1,editedAt:expect.any(String)});
    expect(discussion.comments.find((c:any)=>c.id===deleted.id)).toMatchObject({body:null,deletedAt:expect.any(String),canEdit:0,canDelete:0});
  }
  await json(await owner.call(`/settings/teams/${team.id}/members/${member.id}`,'DELETE'));
  const tables=['issues','evidence_revisions','issue_comments','issue_activity','issue_followers','notifications','audit_records'];
  const before=await snapshot(tables);
  const auditStart=await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) n FROM agent_door_audit').first<number>('n');
  for(const [kind,existing] of [['issue',issue.id],['comment',reply.id]]){
    const hidden=await readers[1](`vector://${kind}/${existing}`);
    const missing=await readers[1](`vector://${kind}/00000000000000000000000000`);
    expect(hidden.status).toBe(200);
    expect(hidden.body.error).toMatchObject({code:-32602,message:'Resource unavailable',data:{code:'resource_unavailable'}});
    expect(hidden.body.result).toBeUndefined();
    // Only the request ID is normalized; every error and content field survives.
    expect({...hidden,body:{...hidden.body,id:null}}).toEqual({...missing,body:{...missing.body,id:null}});
    for(const secret of [issue.title,issue.description,'synthetic-vector-3404','synthetic-vector-3409'])
      expect(JSON.stringify(hidden.body)).not.toContain(secret);
  }
  expect(await snapshot(tables)).toEqual(before);
  const audits=await env.DB.prepare('SELECT row,evidence FROM agent_door_audit WHERE sequence>? ORDER BY sequence').bind(auditStart).all<{row:string;evidence:string|null}>();
  expect(audits.results).toHaveLength(4);
  for(const record of audits.results){
    expect(JSON.parse(record.row)).toMatchObject({tool:'resources/read',sponsor:{id:member.id},outcome:'refused',code:'resource_unavailable'});
    expect(record.evidence).toBeNull();
    expect(record.row).not.toContain('synthetic-vector-3409');
  }
  // Withdrawal does not make the existing record disappear for its Owner.
  expect((await readers[0]('vector://issue/'+issue.id)).body.result).toBeDefined();
}
