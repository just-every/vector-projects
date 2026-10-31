import { env } from 'cloudflare:workers';
import { expect, vi } from 'vitest';
import { scheduled } from '../../src/core/app/scheduled';
import { bindings } from './base-auth-fixture';
import type { setupIntegrations } from './integration-fixture';

const json=async(response:Response,status=200):Promise<any>=>{expect(response.status,await response.clone().text()).toBe(status);return response.json();};
export async function warehouseSheetsJourney(f:Awaited<ReturnType<typeof setupIntegrations>>) {
  const team=(await f.mutate('/settings/teams','POST',{name:'synthetic-vector-51801',identifierPrefix:'SYNSHEET'})).teams.find(row=>row.name==='synthetic-vector-51801')!;
  const issues=[await f.create({teamId:team.id,title:'synthetic-vector-51802',priority:'high'}),await f.create({teamId:team.id,title:'synthetic-vector-51803',priority:'high'})];
  const view=await json(await f.call('/views','POST',{name:'synthetic-vector-51804',query:{team:team.id,priority:'high',sort:'oldest'},layout:'list'}),201);
  const configuration={viewId:view.id,spreadsheetId:'synthetic-vector-51805',sheet:"Vector's export"};
  const credentials={clientId:'synthetic-vector-51806',clientSecret:'synthetic-vector-51807',refreshToken:'synthetic-vector-51808'};
  const grant='synthetic-vector-51809';
  const values:string[][][]=[];let refreshes=0,mode='ok';
  const network=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const url=new URL(String(input)),headers=new Headers(init?.headers);
    expect(init?.redirect).toBe('manual');expect(headers.has('cookie')).toBe(false);
    if(url.href==='https://oauth2.googleapis.com/token') {
      expect(init?.method).toBe('POST');expect(headers.get('authorization')).toBeNull();
      const body=new URLSearchParams(String(init?.body));
      expect(Object.fromEntries(body)).toEqual({grant_type:'refresh_token',client_id:credentials.clientId,client_secret:credentials.clientSecret,refresh_token:credentials.refreshToken});
      refreshes++;return Response.json({access_token:grant,token_type:'Bearer',expires_in:3600});
    }
    expect(url.href).toBe('https://sheets.googleapis.com/v4/spreadsheets/'+configuration.spreadsheetId+'/values:batchUpdate');
    expect(headers.get('authorization')==='Bearer '+grant).toBe(true);
    expect(init?.method).toBe('POST');const body=JSON.parse(String(init?.body));
    expect(body.valueInputOption).toBe('RAW');expect(body.includeValuesInResponse).toBe(false);
    expect(body.data).toHaveLength(1);expect(body.data[0].range).toBe("'Vector''s export'!A1:L"+(values.length<2?3:2));
    expect(body.data[0].majorDimension).toBe('ROWS');
    expect(String(init?.body).includes(credentials.refreshToken)||String(init?.body).includes(credentials.clientSecret)).toBe(false);
    if(mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://forbidden.example.test'}});
    values.push(body.data[0].values);
    return Response.json({spreadsheetId:configuration.spreadsheetId,totalUpdatedCells:36});
  });
  try {
    const profile=await json(await f.call('/settings/report-exports','POST',{name:'synthetic-vector-51810',kind:'sheets',configuration,credentials,consent:true,enabled:true}),201);
    const now=Date.parse('2031-01-01T00:00:00Z');
    await scheduled({scheduledTime:now},bindings);
    expect(refreshes).toBe(1);expect(values).toHaveLength(1);
    expect(values[0][0]).toEqual(['Identifier','Title','Status','Priority','Team','Assignee','Start date','Due date','Labels','Parent','Blocked','Checklist']);
    expect(values[0].slice(1).map(row=>row[0])).toEqual(issues.map(row=>row.identifier));
    expect(values[0].slice(1).map(row=>row[1])).toEqual(['synthetic-vector-51802','synthetic-vector-51803']);
    expect(values[0][1].slice(2,6)).toEqual([team.statuses.find(row=>row.category==='backlog')!.name,'high',team.name,'']);
    await json(await f.call('/issues/'+issues[0].identifier,'PATCH',{expectedVersion:issues[0].version,title:'=synthetic-vector-51811'}));
    await json(await f.call('/issues/'+issues[1].identifier,'PATCH',{expectedVersion:issues[1].version,priority:'low'}));
    f.restart();
    await scheduled({scheduledTime:now+3599999},bindings);expect(values).toHaveLength(1);
    await Promise.all([scheduled({scheduledTime:now+3600000},bindings),scheduled({scheduledTime:now+3600000},bindings)]);
    expect(values).toHaveLength(2);expect(refreshes).toBe(2);
    expect(values[1][1].slice(0,2)).toEqual([issues[0].identifier,'=synthetic-vector-51811']);
    expect(values[1][2]).toEqual(Array(12).fill(''));
    expect(JSON.stringify(values[1])).not.toContain(issues[1].identifier);
    mode='redirect';
    await scheduled({scheduledTime:now+7200000},bindings);
    const failure=(await json(await f.call('/settings/report-exports'))).schedules.find((row:any)=>row.id===profile.id);
    expect(failure).toMatchObject({state:'failed',lastError:'export_redirect_refused'});
    const before=(await env.DB.prepare('SELECT last_rows,last_columns FROM vector_report_exports WHERE id=?').bind(profile.id).first());
    expect(before).toEqual({last_rows:2,last_columns:12});
    mode='ok';
    await json(await f.call('/views/'+view.id,'DELETE'));
    const count=refreshes;
    await scheduled({scheduledTime:now+10800000},bindings);
    expect(refreshes).toBe(count);expect(values).toHaveLength(2);
    expect((await json(await f.call('/settings/report-exports'))).schedules.find((row:any)=>row.id===profile.id).lastError).toBe('export_view_unavailable');
    await json(await f.call('/settings/report-exports/'+profile.id,'DELETE'));
    expect(await env.DB.prepare("SELECT 1 FROM vector_integration_secret_keys WHERE identity=?").bind('report-export:'+profile.id).first()).toBeNull();
    console.log('PROBE REPORT-005 sheets: native saved list and hourly Worker cron -> genuine Google token refresh and values.batchUpdate; second sync updates the changed issue and blanks the departed row, with RAW values, one call under concurrency, redirect refusal and no call for an unavailable view.');
  }finally{network.mockRestore();}
}
