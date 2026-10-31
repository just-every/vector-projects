import { env } from 'cloudflare:workers';
import { expect } from 'vitest';
import { setupIntegrations } from './integration-fixture';
import { actor, bindings, origin, invite, request } from './base-auth-fixture';
import { warehouseGrants } from './warehouse-grant-journey';

const address = (n: number) => ['synthetic-vector-' + n, 'vector.test'].join(String.fromCharCode(64));
async function json(response: Response, status = 200): Promise<any> {
  expect(response.status).toBe(status);
  return response.json();
}

/** Mounted HTTP sanity journey: a populated warehouse consumer and its current
 * authority fences, without borrowing the portable archive door. */
export async function warehouseExportJourney(f: Awaited<ReturnType<typeof setupIntegrations>>) {
  const team = (await f.mutate('/settings/teams', 'POST', {name:'synthetic-vector-51501',identifierPrefix:'SYNWH'})).teams.find(t=>t.name==='synthetic-vector-51501')!;
  const privateTeam = (await f.mutate('/settings/teams', 'POST', {name:'synthetic-vector-51502',identifierPrefix:'SYNHID',isPrivate:true})).teams.find(t=>t.name==='synthetic-vector-51502')!;
  const writer = (await f.issueToken(['projects:write','cycles:write'])).token;
  const project = async (n: number) => json(await f.api(writer,'/projects','POST',{name:'synthetic-vector-'+n,leadOperatorId:f.owner}),201);
  const projects = [await project(51503), await project(51504), await project(51505)];
  const cycle = async (teamId: string,n: number,month: string) => (await json(await f.api(writer,'/cycles','POST',{teamId,name:'synthetic-vector-'+n,startsLocal:'2037-'+month+'-01T09:00',endsLocal:'2037-'+month+'-08T09:00'}),201)).cycle;
  const cycles = [await cycle(team.id,51506,'01'),await cycle(team.id,51507,'02'),await cycle(privateTeam.id,51508,'01')];
  const issues = [
    await f.create({teamId:team.id,title:'synthetic-vector-51509',projectId:projects[0].id,cycleId:cycles[0].id}),
    await f.create({teamId:team.id,title:'synthetic-vector-51510',projectId:projects[1].id,cycleId:cycles[1].id}),
    await f.create({teamId:team.id,title:'synthetic-vector-51511'}),
  ];
  const hidden = await f.create({teamId:privateTeam.id,title:'synthetic-vector-51512',description:'See '+issues[0].identifier,projectId:projects[2].id,cycleId:cycles[2].id});
  const document = await json(await f.call('/documents','POST',{parentKind:'team',parentId:privateTeam.id,title:'synthetic-vector-51513',body:'See '+issues[0].identifier}),201);
  await json(await f.call('/issues/'+issues[1].identifier,'PATCH',{expectedVersion:issues[1].version,title:'synthetic-vector-51514'}));
  const attachmentBody='synthetic-vector-51521';
  const file=await json(await f.app.request(origin+'/api/issues/'+issues[0].identifier+'/files',{method:'POST',headers:{host:new URL(origin).host,Cookie:f.cookie,Origin:origin,'Content-Type':'text/plain','x-file-name':'synthetic-vector-51522.txt'},body:attachmentBody},bindings),201);
  const objectKey='issues/'+issues[0].id+'/'+file.id;
  expect(await (await env.FILES.get(objectKey))!.text()).toBe(attachmentBody);
  const read = await f.issueToken(['reports:read'],'synthetic-vector-51515');
  const old = await f.issueToken(['issues:read','metadata:read'],'synthetic-vector-51516');
  const adminCookie = await invite(address(51517),f.cookie,'admin'),adminId=await actor(adminCookie);
  const adminToken = (await json(await request('/api/settings/integrations/tokens','POST',{name:'synthetic-vector-51518',scopes:['reports:read']},adminCookie),201)).token;
  const grants = await warehouseGrants(f, adminCookie);
  const adminTokens = [adminToken, grants.read.access_token];
  const endpoint = (resource: string,teamId=team.id) => '/report-exports/'+resource+'?team='+teamId+'&limit=1';
  const call = (resource: string, token=read.token, suffix='',teamId=team.id) => f.api(token,endpoint(resource,teamId)+suffix);
  const pages = async (resource: string, token=read.token,teamId=team.id) => {
    const rows: any[]=[];let cursor:string|null=null,total:number|undefined;
    do {
      const page=await json(await call(resource,token,cursor?'&cursor='+encodeURIComponent(cursor):'',teamId));
      expect(page.resource).toBe(resource);total??=page.total;expect(page.total).toBe(total);
      expect(page.rows).toHaveLength(total ? 1 : 0);rows.push(...page.rows);cursor=page.nextCursor;
    } while(cursor);
    expect(rows).toHaveLength(total!);expect(new Set(rows.map(r=>r.id)).size).toBe(rows.length);
    return rows;
  };
  const nativeHistory = (await Promise.all(issues.map(async issue=>(await json(await f.call('/issues/'+issue.identifier))).activity))).flat();
  const expectedIds: Record<string,string[]> = {
    issues:issues.map(i=>i.id).sort(),cycles:cycles.slice(0,2).map(c=>c.id).sort(),
    projects:projects.slice(0,2).map(p=>p.id).sort(),history:nativeHistory.map(a=>a.id).sort(),
  };
  for(const resource of ['issues','history','cycles','projects']) {
    const rows = await pages(resource);
    expect(rows.map(r=>r.id)).toEqual(expectedIds[resource]);
    expect(JSON.stringify(rows).includes(read.token)).toBe(false);
    expect(JSON.stringify(rows).includes(adminToken)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain(attachmentBody);
    expect(JSON.stringify(rows)).not.toContain(objectKey);
    if(resource==='issues') {
      expect(rows.map(r=>r.identifier).sort()).toEqual(issues.map(i=>i.identifier).sort());
      expect(rows.find(r=>r.id===issues[1].id).title).toBe('synthetic-vector-51514');
      expect(rows.find(r=>r.id===issues[0].id)).toMatchObject({projectId:projects[0].id,cycleId:cycles[0].id});
    }
    if(resource==='history') {
      expect(rows.some(r=>r.kind==='issue.updated'&&r.nextValue.title==='synthetic-vector-51514')).toBe(true);
      expect(rows.filter(r=>r.kind==='issue.mentioned').map(r=>r.nextValue.sourceIssueId??r.nextValue.sourceDocumentId).sort()).toEqual([hidden.id,document.id].sort());
      expect(JSON.stringify(rows)).not.toContain('sessionHash');
    }
    const first = await json(await call(resource));expect(first.nextCursor).toEqual(expect.any(String));
    expect((await f.api(read.token,endpoint(resource).replace('limit=1','limit=2')+'&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);
    expect((await call(resource,adminToken,'&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);
    expect((await call(resource,read.token,'&cursor=malformed')).status).toBe(400);
    expect((await call(resource,read.token,'&cursor='+encodeURIComponent(first.nextCursor.slice(0,-1)+(first.nextCursor.endsWith('0')?'1':'0')))).status).toBe(400);
    expect((await f.api(old.token,endpoint(resource))).status).toBe(401);
    const other=resource==='issues'?'cycles':'issues';
    expect((await call(other,read.token,'&cursor='+encodeURIComponent(first.nextCursor))).status).toBe(409);
  }
  const privateReferences=nativeHistory.filter(a=>a.kind==='issue.mentioned').map(a=>a.id);
  expect(privateReferences).toHaveLength(2);
  for (const token of adminTokens) {
    for (const resource of ['issues','history','cycles','projects']) {
      const expected = resource === 'history' ? expectedIds.history.filter(id=>!privateReferences.includes(id)) : expectedIds[resource];
      expect((await pages(resource,token)).map(r=>r.id)).toEqual(expected);
      const hiddenPage=await json(await call(resource,token,'',privateTeam.id));
      expect(hiddenPage).toMatchObject({rows:[],total:0,nextCursor:null});
      expect(JSON.stringify(hiddenPage)).not.toContain(hidden.identifier);
    }
  }
  // Add then withdraw current private-team membership. Old cursors fail even
  // for a public-team query whose visible rows did not change.
  await json(await f.call('/settings/teams/'+privateTeam.id+'/members/'+adminId,'PUT',{role:'member'}));
  const cursors:Record<string,string>={};
  for(const token of adminTokens) {
    for(const resource of ['issues','history','cycles','projects']) {
      cursors[token+resource]=(await json(await call(resource,token))).nextCursor;
      expect((await json(await call(resource,token,'',privateTeam.id))).total).toBeGreaterThan(0);
    }
    expect((await pages('history',token)).map(r=>r.id)).toEqual(expectedIds.history);
  }
  await json(await f.call('/settings/teams/'+privateTeam.id+'/members/'+adminId,'DELETE'));
  for(const token of adminTokens) {
    for(const resource of ['issues','history','cycles','projects']) {
      expect((await call(resource,token,'&cursor='+encodeURIComponent(cursors[token+resource]))).status).toBe(409);
      expect(await pages(resource,token,privateTeam.id)).toEqual([]);
    }
    expect((await pages('history',token)).map(r=>r.id)).toEqual(expectedIds.history.filter(id=>!privateReferences.includes(id)));
  }
  const tables=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name NOT IN ('integration_token_usage','access_rate_limits') ORDER BY name").all<{name:string}>()).results;
  const storage=async()=>Object.fromEntries(await Promise.all(tables.map(async({name})=>[name,(await env.DB.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()).results.map(row=>JSON.stringify(row)).sort()])));
  // Retained credentials cannot bypass a role change. Guest and Viewer tokens
  // were issued while eligible, then used under their new current roles.
  for(const role of ['member','guest','viewer']) {
    await json(await f.call('/settings/operators/'+adminId+'/role','PATCH',{role,...(role==='guest'?{teamIds:[team.id]}:{})}));
    const roleBefore=await storage();
    for(const resource of ['issues','history','cycles','projects']) {
      expect((await call(resource,adminToken)).status).toBe(403);
      expect((await call(resource,grants.read.access_token)).status).toBe(role==='member'?403:401);
    }
    expect(await storage()).toEqual(roleBefore);
    await json(await f.call('/settings/operators/'+adminId+'/role','PATCH',{role:'admin'}));
  }
  const before = await storage();
  for(const resource of ['issues','history','cycles','projects']) {
    await pages(resource);
    expect((await call(resource,grants.insufficient.access_token)).status).toBe(403);
    for(const query of ['?limit=0','?limit=101','?limit=1&extra=1','?team=foreign','?cursor='])expect((await f.api(read.token,'/report-exports/'+resource+query)).status).toBe(400);
    expect((await f.api(read.token,'/report-exports/'+resource,'POST',{})).status).toBe(404);
  }
  expect((await f.api(read.token,'/issues','POST',{teamId:team.id,title:'synthetic-vector-51519'})).status).toBe(401);
  expect((await f.api(read.token,'/projects','POST',{name:'synthetic-vector-51520',leadOperatorId:f.owner})).status).toBe(401);
  expect((await f.api(grants.read.access_token,'/issues','POST',{teamId:team.id,title:'synthetic-vector-51526'})).status).toBe(403);
  expect((await f.api(grants.read.access_token,'/projects','POST',{name:'synthetic-vector-51527',leadOperatorId:f.owner})).status).toBe(403);
  expect((await f.api(grants.read.access_token,'/portability/exports')).status).toBe(404);
  expect((await f.api(read.token,'/portability/exports')).status).toBe(404);
  expect(await storage()).toEqual(before);
  const captured=(await json(await call('issues'))).nextCursor;
  expect(captured).toEqual(expect.any(String));
  const nativeBytes=await f.app.request(origin+'/api/issues/'+issues[0].identifier+'/files/'+file.id,{headers:{host:new URL(origin).host,Authorization:'Bearer '+read.token}},bindings);
  expect(nativeBytes.status).toBe(401);
  await json(await f.call('/settings/integrations/tokens/'+read.credential.id,'DELETE'));
  const revoked=await storage();
  for(const resource of ['issues','history','cycles','projects'])expect((await call(resource)).status).toBe(401);
  expect((await call('issues',read.token,'&cursor='+encodeURIComponent(captured))).status).toBe(401);
  expect(await storage()).toEqual(revoked);
  const grantCursor=(await json(await call('issues',grants.read.access_token))).nextCursor;
  await json(await f.call('/settings/oauth-apps/grants/'+grants.read.grant_id,'DELETE'));
  f.restart();
  const grantRevoked=await storage();
  for(const resource of ['issues','history','cycles','projects'])expect((await call(resource,grants.read.access_token)).status).toBe(401);
  expect((await call('issues',grants.read.access_token,'&cursor='+encodeURIComponent(grantCursor))).status).toBe(401);
  expect(await storage()).toEqual(grantRevoked);
  const capturedAdmin=(await json(await call('issues',adminToken))).nextCursor;
  await json(await f.call('/settings/operators/'+adminId,'DELETE'));
  const removed=await storage();
  for(const resource of ['issues','history','cycles','projects'])expect((await call(resource,adminToken)).status).toBe(401);
  expect((await call('issues',adminToken,'&cursor='+encodeURIComponent(capturedAdmin))).status).toBe(401);
  expect((await f.api(grants.insufficient.access_token,'/issues')).status).toBe(401);
  expect(await storage()).toEqual(removed);
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  console.log('PROBE REPORT-005 paged-api: mounted HTTP export traversed exact issue, history, cycle and project IDs and totals; malformed and foreign cursors, changed visibility, role, scope and revocation refused; domain storage unchanged.');
  console.log('PROBE REPORT-005 oauth-grant: separately consented read grant -> exact paged rows; private-team withdrawal invalidates cursors and omits hidden history; role loss, missing scope, writes and revoked grant refused with unchanged storage across restart.');
}
