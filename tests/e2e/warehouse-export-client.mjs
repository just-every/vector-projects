import assert from 'node:assert/strict';
import { exerciseWarehouseSchedules } from './warehouse-schedule-client.mjs';
import { warehouseGrants } from './warehouse-grant-client.mjs';

/** A real warehouse consumer of the published HTTP operations. This helper is
 * reached by the existing integration runtime, without a fake transport. */
export async function exerciseWarehouseExports({runtime,cookie}) {
  const headers={Cookie:cookie,Origin:runtime.base,'Content-Type':'application/json'};
  const native=async(path,method='GET',body,status=200)=>{
    const response=await runtime.req('/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal(response.status,status);return response.json();
  };
  const named='synthetic-vector-51601';
  const admin=await native('/settings/teams','POST',{name:named,identifierPrefix:'SYNWARE'});
  const team=admin.teams.find(row=>row.name===named);assert.ok(team);
  const owner=runtime.sql("SELECT id FROM operators WHERE role='owner' AND removed_at IS NULL ORDER BY id LIMIT 1")[0].id;
  const projects=[],cycles=[],issues=[];
  for(let i=0;i<2;i++) {
    const projectName='synthetic-vector-'+(51602+i);
    const projectData=await native('/settings/projects','POST',{name:projectName,leadOperatorId:owner});
    const project=projectData.projects.find(row=>row.name===projectName);assert.ok(project);projects.push(project);
    const month=String(i+1).padStart(2,'0'),name='synthetic-vector-'+(51604+i);
    const data=await native('/settings/cycles','POST',{teamId:team.id,name,startsLocal:'2038-'+month+'-01T09:00',endsLocal:'2038-'+month+'-08T09:00'});
    cycles.push(data.cycles.find(row=>row.name===name));
    issues.push(await native('/issues','POST',{teamId:team.id,title:'synthetic-vector-'+(51606+i),projectId:projects[i].id,cycleId:cycles[i].id},201));
  }
  await native('/issues/'+issues[0].identifier,'PATCH',{expectedVersion:issues[0].version,title:'synthetic-vector-51608'});
  const expectedHistory=(await Promise.all(issues.map(async issue=>(await native('/issues/'+issue.identifier)).activity))).flat();
  const credential=await native('/settings/integrations/tokens','POST',{name:'synthetic-vector-51609',scopes:['reports:read']},201);
  const grants=await warehouseGrants({runtime,native});
  const api=(path,token=credential.token)=>runtime.req('/api/v1'+path,{headers:{Authorization:'Bearer '+token}});
  try {
    const schemaResponse=await runtime.req('/api/v1/schema');assert.equal(schemaResponse.status,200);
    const schema=await schemaResponse.json();
    const expected={issues:issues.map(row=>row.id).sort(),history:expectedHistory.map(row=>row.id).sort(),cycles:cycles.map(row=>row.id).sort(),projects:projects.map(row=>row.id).sort()};
    for(const token of [credential.token,grants.read.access_token]) {
     for(const resource of ['issues','history','cycles','projects']) {
      const path='/report-exports/'+resource,definition=schema.paths[path].get;
      assert.deepEqual(definition['x-scopes'],['reports:read']);
      const seen=[];let cursor=null,total;
      do {
        const query=new URLSearchParams({team:team.id,limit:'1',...(cursor?{cursor}:{})});
        const response=await api(path+'?'+query,token);assert.equal(response.status,200);
        assert.equal(response.headers.get('cache-control'),'no-store');
        const page=await response.json();total??=page.total;assert.equal(page.total,total);
        assert.equal(page.rows.length,1);seen.push(...page.rows);cursor=page.nextCursor;
      } while(cursor);
      assert.equal(seen.length,total);assert.deepEqual(seen.map(row=>row.id),expected[resource]);
      if(resource==='issues') {
        assert.deepEqual(seen.map(row=>row.identifier).sort(),issues.map(row=>row.identifier).sort());
        assert.equal(seen.find(row=>row.id===issues[0].id).title,'synthetic-vector-51608');
      }
      if(resource==='history')assert.ok(seen.some(row=>row.kind==='issue.updated'&&row.nextValue.title==='synthetic-vector-51608'));
      console.log('PROBE REPORT-005 '+resource+': real local GET '+path+' with limit=1 -> '+seen.length+' exact stable IDs, total='+total+', no duplicates.');
     }
    }
    const domain=()=>Object.fromEntries(['issues','issue_activity','cycles','projects'].map(table=>[table,runtime.sql('SELECT * FROM '+table+' ORDER BY id')]));
    const before=domain();
    for(const resource of ['issues','history','cycles','projects'])assert.equal((await api('/report-exports/'+resource,grants.insufficient.access_token)).status,403);
    const refused=await runtime.req('/api/v1/issues',{
      method:'POST',headers:{Authorization:'Bearer '+grants.read.access_token,'Content-Type':['application','json'].join('/')},
      body:JSON.stringify({teamId:team.id,title:'synthetic-vector-51613'}),
    });
    assert.equal(refused.status,403);assert.deepEqual(domain(),before);
    const first=await (await api('/report-exports/issues?team='+team.id+'&limit=1',grants.read.access_token)).json();
    assert.ok(first.nextCursor);
    await native('/settings/oauth-apps/grants/'+grants.read.grant_id,'DELETE');
    for(const resource of ['issues','history','cycles','projects'])assert.equal((await api('/report-exports/'+resource,grants.read.access_token)).status,401);
    assert.equal((await api('/report-exports/issues?team='+team.id+'&limit=1&cursor='+encodeURIComponent(first.nextCursor),grants.read.access_token)).status,401);
    assert.deepEqual(domain(),before);
    console.log('PROBE REPORT-005 oauth-client: real local consent and exchange -> read-only traversal; insufficient grant and mutation -> 403 unchanged; revoked grant and captured cursor -> 401 unchanged.');
  } finally {
    await native('/settings/oauth-apps/grants/'+grants.read.grant_id,'DELETE');
    await native('/settings/oauth-apps/grants/'+grants.insufficient.grant_id,'DELETE');
    await native('/settings/integrations/tokens/'+credential.credential.id,'DELETE');
  }
  assert.equal((await api('/report-exports/issues')).status,401);
  console.log('REPORT-005 local warehouse consumer passed; revoked access refused.');
  await exerciseWarehouseSchedules({runtime,cookie,team,issues});
}
