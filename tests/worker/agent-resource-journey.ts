import {expect} from 'vitest';
import {createServerApp} from '../../src/core/app/server';
import {agentResponse} from '../../src/core/features/agent-door/runtime';
import {bindings,origin} from './base-auth-fixture';
import type {Person} from './role-fixture';

/** The existing private-team journey also crosses the mounted MCP door. */
export async function agentResourceClient(member:Pick<Person,'cookie'|'call'>,owner:Pick<Person,'cookie'>) {
  const app=createServerApp();
  const send=async(path:string,init:RequestInit)=>{
    const headers=new Headers(init.headers);
    headers.set('Host',new URL(origin).host);
    const request=new Request(origin+path,{...init,headers});
    return await agentResponse(bindings,request) ?? app.request(request,undefined,bindings);
  };
  const policy=await send('/agents/api/policy',{
    method:'PUT',headers:{Origin:origin,Cookie:owner.cookie,'Content-Type':'application/json'},
    body:JSON.stringify({document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'autonomous'}],spend:{none:true}}}),
  });
  expect(policy.status,await policy.clone().text()).toBe(200);
  const issue=async(scopes:string[])=>{
    const response=await member.call('/settings/integrations/tokens','POST',{name:'synthetic-vector-3301',scopes});
    expect(response.status).toBe(201);
    return (await response.json() as {token:string}).token;
  };
  const evidence=await issue(['evidence:read','issues:write','comments:write']),noEvidence=await issue(['issues:read']);
  let id=0;
  const rpc=async(method:string,params:object,token=evidence)=>{
    const response=await send('/mcp',{
      method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25','Mcp-Method':method},
      body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),
    });
    return {status:response.status,body:await response.json() as any,challenge:response.headers.get('www-authenticate')};
  };
  const read=async(uri:string)=>rpc('resources/read',{uri});
  return {
    async hidden(uri:string,title:string) {
      const response=await read(uri);
      expect(response.body.error?.data?.code).toBe('resource_unavailable');
      expect(response.body.result).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(title);
    },
    async visible(uri:string,identifier:string) {
      const response=await read(uri);
      expect(response.status).toBe(200);
      expect(response.body.error).toBeUndefined();
      const content=response.body.result.contents[0];
      expect(content.uri).toBe(uri);
      expect(content._meta['com.runeditrun/untrusted']).toBe(true);
      expect(JSON.parse(content.text).identifier).toBe(identifier);
    },
    async write(teamId:string,intakeKey=crypto.randomUUID()) {
      const created=await rpc('tools/call',{name:'vector.intake.intake_creation',arguments:{teamId,title:'synthetic-vector-3302',summary:'synthetic-vector-3303',idempotency_key:intakeKey}});
      expect(created.status).toBe(200);
      expect(created.body.result?.isError).not.toBe(true);
      const result=created.body.result.structuredContent;
      const link=created.body.result.content.find((item:any)=>item.type==='resource_link');
      expect(link).toMatchObject({uri:'vector://issue/'+result.id,name:result.identifier});
      const returned=await read(link.uri);
      expect(returned.status).toBe(200);
      const record=JSON.parse(returned.body.result.contents[0].text);
      expect(record).toMatchObject({id:result.id,identifier:result.identifier,title:'synthetic-vector-3302'});
      expect(record.evidence).toEqual(expect.arrayContaining([expect.objectContaining({summary:'synthetic-vector-3303',originKind:'operator'})]));
      const commented=await rpc('tools/call',{name:'vector.issue.comment',arguments:{identifier:result.identifier,body:'synthetic-vector-3305',idempotency_key:crypto.randomUUID()}});
      expect(commented.status).toBe(200);
      expect(commented.body.result?.isError).not.toBe(true);
      const commentLink=commented.body.result.content.find((item:any)=>item.uri==='vector://comment/'+commented.body.result.structuredContent.commentId);
      expect(commentLink).toMatchObject({type:'resource_link',name:result.identifier+' comment'});
      const commentRead=await read(commentLink.uri);
      expect(commentRead.status).toBe(200);
      expect(JSON.parse(commentRead.body.result.contents[0].text)).toMatchObject({id:commented.body.result.structuredContent.commentId,body:'synthetic-vector-3305',canEdit:1});
      expect(commentRead.body.result.contents[0]._meta['com.runeditrun/untrusted']).toBe(true);
      for(const uri of [link.uri,commentLink.uri]){
        const refused=await rpc('resources/read',{uri},noEvidence);
        expect(refused.status).toBe(403);
        expect(refused.body.error.data.code).toBe('insufficient_scope');
        expect(refused.challenge).toContain('evidence:read');
        expect(refused.body.result).toBeUndefined();
      }
      return [link.uri,commentLink.uri] as string[];
    },
  };
}
