import { env } from 'cloudflare:workers';
import { expect, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { scheduled } from '../../src/core/app/scheduled';
import { bindings, invite, actor, request } from './base-auth-fixture';
import { parseCsv } from '../../src/core/features/data/import/csv';
import type { setupIntegrations } from './integration-fixture';

export const bucketScheduleInput={name:'synthetic-vector-51700',kind:'bucket',configuration:{endpoint:'https://'+'1'.repeat(32)+'.r2.cloudflarestorage.com',region:'auto',bucket:'synthetic-vector-51700',prefix:'vector',format:'json'},credentials:{accessKeyId:'synthetic-vector-51701',secretAccessKey:'synthetic-vector-51702'},consent:true,enabled:false};
const read=async(response:Response,status=200):Promise<any>=>{expect(response.status,await response.clone().text()).toBe(status);return response.json();};
const address=(n:number)=>['synthetic-vector-'+n,'vector.test'].join(String.fromCharCode(64));

/** One populated public-door journey exercises the scheduler and the actual
 * S3 wire protocol at its network edge, including stop and current authority. */
export async function warehouseScheduleJourney(f:Awaited<ReturnType<typeof setupIntegrations>>) {
  const state=await f.mutate('/settings/teams','POST',{name:'synthetic-vector-51703',identifierPrefix:'SYNBUCK'});
  const team=state.teams.find(row=>row.name==='synthetic-vector-51703')!;
  const project=(await f.mutate('/settings/projects','POST',{name:'synthetic-vector-51712',leadOperatorId:f.owner})).projects.find(row=>row.name==='synthetic-vector-51712')!;
  const cycle=(await f.mutate('/settings/cycles','POST',{teamId:team.id,name:'synthetic-vector-51713',startsLocal:'2032-01-01T09:00',endsLocal:'2032-01-08T09:00'})).cycles.find(row=>row.name==='synthetic-vector-51713')!;
  const issues=[await f.create({teamId:team.id,title:'synthetic-vector-51704',projectId:project.id,cycleId:cycle.id}),await f.create({teamId:team.id,title:'synthetic-vector-51705'})];
  const input={...bucketScheduleInput,configuration:{...bucketScheduleInput.configuration,team:team.id}};
  const objects:{key:string;records:any[]}[]=[];
  let responseStatus=200;
  const network=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    const destination=new URL(String(url)),headers=new Headers(init?.headers),body=String(init?.body);
    expect(destination.origin).toBe(input.configuration.endpoint);expect(init?.method).toBe('PUT');expect(init?.redirect).toBe('manual');
    const auth=headers.get('authorization')!,match=/^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(auth)!;
    expect(Boolean(match)).toBe(true);expect(match[1]===input.credentials.accessKeyId).toBe(true);
    const names=match[3].split(';'),canonical=['PUT',destination.pathname,'',names.map(name=>name+':'+headers.get(name)+'\n').join(''),match[3],createHash('sha256').update(body).digest('hex')].join('\n');
    let key:Buffer=Buffer.from('AWS4'+input.credentials.secretAccessKey);
    for(const part of match[2].split('/'))key=createHmac('sha256',key).update(part).digest();
    const signature=createHmac('sha256',key).update(['AWS4-HMAC-SHA256',headers.get('x-amz-date'),match[2],createHash('sha256').update(canonical).digest('hex')].join('\n')).digest('hex');
    expect(signature===match[4]).toBe(true);
    expect(body.includes(input.credentials.secretAccessKey)||body.includes(input.credentials.accessKeyId)).toBe(false);
    if(responseStatus===200) {
      const csv=headers.get('content-type')==='text/csv';
      const records=csv?parseCsv(body).rows.map(({values})=>({resource:values[0],id:values[1],operation:values[2],row:JSON.parse(values[3])})):JSON.parse(body).records;
      objects.push({key:destination.pathname,records});
    }
    return new Response(null,{status:responseStatus,headers:responseStatus===302?{Location:'https://forbidden.example.test'}:{}});
  });
  try {
    const before=(await env.DB.prepare('SELECT count(*) n FROM vector_report_exports').first<number>('n'))!;
    await read(await f.call('/settings/report-exports','POST',{...input,consent:false}),400);
    await read(await f.call('/settings/report-exports','POST',{...input,configuration:{...input.configuration,endpoint:'https://127.0.0.1/'}}),400);
    expect(await env.DB.prepare('SELECT count(*) n FROM vector_report_exports').first<number>('n')).toBe(before);
    const profile=await read(await f.call('/settings/report-exports','POST',input),201);
    const now=new Date('2030-01-01T00:00:00Z');
    await scheduled({scheduledTime:now.getTime()},bindings);expect(objects).toHaveLength(0);
    await read(await f.call('/settings/report-exports/'+profile.id,'PATCH',{expectedVersion:1,enabled:true,consent:true}));
    await Promise.all([scheduled({scheduledTime:now.getTime()},bindings),scheduled({scheduledTime:now.getTime()},bindings)]);
    expect(objects).toHaveLength(1);
    expect(objects[0].records.filter(row=>row.resource==='issues').map(row=>row.id).sort()).toEqual(issues.map(row=>row.id).sort());
    expect(objects[0].records.every(row=>row.operation==='upsert')).toBe(true);
    expect(objects[0].records.filter(row=>row.resource==='projects').map(row=>row.id)).toEqual([project.id]);
    expect(objects[0].records.filter(row=>row.resource==='cycles').map(row=>row.id)).toEqual([cycle.id]);
    const firstHistory=objects[0].records.filter(row=>row.resource==='history').map(row=>row.id);
    expect(firstHistory.length).toBeGreaterThan(0);
    await read(await f.call('/issues/'+issues[0].identifier,'PATCH',{expectedVersion:issues[0].version,title:'synthetic-vector-51706'}));
    f.restart();
    const second=now.getTime()+3600000;
    await scheduled({scheduledTime:second-1},bindings);expect(objects).toHaveLength(1);
    await scheduled({scheduledTime:second},bindings);expect(objects).toHaveLength(2);
    expect(objects[1].records.filter(row=>row.resource==='issues')).toEqual([expect.objectContaining({id:issues[0].id,operation:'upsert',row:expect.objectContaining({title:'synthetic-vector-51706'})})]);
    expect(objects[1].records.filter(row=>row.resource==='history')).toHaveLength(1);
    expect(objects[1].records.some(row=>firstHistory.includes(row.id))).toBe(false);
    await scheduled({scheduledTime:second},bindings);expect(objects).toHaveLength(2);
    await scheduled({scheduledTime:second+3600000},bindings);expect(objects[2].records).toEqual([]);
    const listed=await read(await f.call('/settings/report-exports'));
    expect(listed.runs.filter((row:any)=>row.exportId===profile.id).map((row:any)=>row.rowCount).sort((a:number,b:number)=>a-b)).toEqual([0,2,objects[0].records.length]);
    expect(JSON.stringify(listed).includes(input.credentials.secretAccessKey)||JSON.stringify(listed).includes(input.credentials.accessKeyId)).toBe(false);
    // A definite redirect never forwards the signed request or advances hashes.
    responseStatus=302;
    const checkpoint=(await env.DB.prepare('SELECT * FROM vector_report_export_rows ORDER BY resource,row_id').all()).results;
    await scheduled({scheduledTime:second+7200000},bindings);
    expect((await read(await f.call('/settings/report-exports'))).schedules.find((row:any)=>row.id===profile.id)).toMatchObject({state:'failed',lastError:'export_redirect_refused'});
    expect((await env.DB.prepare('SELECT * FROM vector_report_export_rows ORDER BY resource,row_id').all()).results).toEqual(checkpoint);
    responseStatus=503;
    await scheduled({scheduledTime:second+10800000},bindings);
    expect((await read(await f.call('/settings/report-exports'))).schedules.find((row:any)=>row.id===profile.id)).toMatchObject({state:'uncertain',lastError:'export_transport_uncertain'});
    responseStatus=200;
    await scheduled({scheduledTime:second+14400000},bindings);expect(objects).toHaveLength(3);
    await read(await f.call('/settings/report-exports/'+profile.id,'PATCH',{expectedVersion:2,enabled:false,consent:true}));
    const staleProfile=await env.DB.prepare('SELECT * FROM vector_report_exports WHERE id=?').bind(profile.id).first();
    const staleAudit=await env.DB.prepare('SELECT count(*) n FROM audit_records').first<number>('n');
    await read(await f.call('/settings/report-exports/'+profile.id,'PATCH',{expectedVersion:2,enabled:true,consent:true}),409);
    expect(await env.DB.prepare('SELECT * FROM vector_report_exports WHERE id=?').bind(profile.id).first()).toEqual(staleProfile);
    expect(await env.DB.prepare('SELECT count(*) n FROM audit_records').first<number>('n')).toBe(staleAudit);
    const adminCookie=await invite(address(51707),f.cookie,'admin'),adminId=await actor(adminCookie);
    const admin=(path:string,method='GET',body?:unknown)=>request('/api'+path,method,body,adminCookie);
    const own=await read(await admin('/settings/report-exports','POST',{...input,enabled:true}),201);
    const tick=second+18000000;
    await scheduled({scheduledTime:tick},bindings);expect(objects).toHaveLength(4);
    await read(await f.call('/settings/teams/'+team.id+'/privacy','PUT',{isPrivate:true}));
    await scheduled({scheduledTime:tick+3600000},bindings);expect(objects).toHaveLength(5);
    expect(objects[4].records).toHaveLength(objects[3].records.length);
    expect(objects[4].records.every(row=>row.operation==='delete'&&row.row===null)).toBe(true);
    for(const issue of issues)expect(JSON.stringify(objects[4].records)).not.toContain(issue.identifier);
    const hiddenReceipts=await read(await admin('/settings/report-exports'));
    expect(hiddenReceipts.runs.filter((row:any)=>row.exportId===own.id).map((row:any)=>row.rowCount)).toEqual([null,null]);
    const ownerReceipts=await read(await f.call('/settings/report-exports'));
    expect(ownerReceipts.runs.filter((row:any)=>row.exportId===own.id).every((row:any)=>row.rowCount>0)).toBe(true);
    await read(await f.call('/settings/teams/'+team.id+'/privacy','PUT',{isPrivate:false}));
    let version=1;
    for(const [index,role] of ['member','guest','viewer'].entries()) {
      await read(await f.call('/settings/operators/'+adminId+'/role','PATCH',{role,...(role==='guest'?{teamIds:[team.id]}:{})}));
      const domain=(await env.DB.prepare('SELECT * FROM issues ORDER BY id').all()).results;
      await read(await admin('/settings/report-exports'),403);
      await read(await admin('/settings/report-exports','POST',input),403);
      await read(await admin('/settings/report-exports/'+own.id,'PATCH',{expectedVersion:1,enabled:false,consent:true}),403);
      await Promise.all([scheduled({scheduledTime:tick+7200000},bindings),scheduled({scheduledTime:tick+7200000},bindings)]);expect(objects).toHaveLength(5);
      expect(await env.DB.prepare("SELECT count(*) n FROM vector_report_export_runs WHERE export_id=? AND state='held'").bind(own.id).first<number>('n')).toBe(index+1);
      expect((await env.DB.prepare('SELECT * FROM issues ORDER BY id').all()).results).toEqual(domain);
      await read(await f.call('/settings/operators/'+adminId+'/role','PATCH',{role:'admin'}));
      await read(await admin('/settings/report-exports/'+own.id,'PATCH',{expectedVersion:version++,enabled:true,consent:true}));
    }
    // Disabling and restoring a schedule never replays its previously exported
    // bodies. Missing installation credentials keeps it inert after review.
    await env.DB.prepare("DELETE FROM vector_integration_secret_keys WHERE identity=?").bind('report-export:'+own.id).run();
    await scheduled({scheduledTime:tick+10800000},bindings);expect(objects).toHaveLength(5);
    expect((await read(await f.call('/settings/report-exports'))).schedules.find((row:any)=>row.id===own.id)).toMatchObject({requiresReentry:true,state:'held'});
    const csv=await read(await f.call('/settings/report-exports','POST',{...input,configuration:{...input.configuration,format:'csv'},enabled:true}),201);
    await scheduled({scheduledTime:tick+14400000},bindings);
    const csvObject=objects.find(row=>row.key.includes(csv.id))!;
    expect(csvObject.key.endsWith('.csv')).toBe(true);
    expect(csvObject.records.filter(row=>row.resource==='issues').map(row=>row.id).sort()).toEqual(issues.map(row=>row.id).sort());
    expect(csvObject.records.find(row=>row.id===issues[0].id).row.title).toBe('synthetic-vector-51706');
    await read(await f.call('/settings/report-exports/'+csv.id,'DELETE'));
    expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    console.log('PROBE REPORT-005 incremental-bucket: native Settings consent and real Worker cron -> signed R2 PutObject; second hourly run has exactly one changed issue and its new history; repeated and concurrent ticks send once, unsafe roles and missing credentials send nothing.');
  } finally {network.mockRestore();}
}
