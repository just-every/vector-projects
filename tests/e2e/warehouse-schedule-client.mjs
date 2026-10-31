import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Real local clients use the documented Settings door and the emitted
 * Worker's scheduled handler; only the provider network edge is a fixture. */
export async function exerciseWarehouseSchedules({runtime,cookie,team,issues}) {
  const headers={Cookie:cookie,Origin:runtime.base,'Content-Type':'application/json'};
  const native=async(path,method='GET',body,status=200)=>{
    const response=await runtime.req('/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal(response.status,status);return response.json();
  };
  for(const issue of issues) {
    const current=await native('/issues/'+issue.identifier);
    await native('/issues/'+issue.identifier,'PATCH',{expectedVersion:current.version,priority:'high'});
  }
  const bucket=await native('/settings/report-exports','POST',{
    name:'synthetic-vector-51901',kind:'bucket',configuration:{endpoint:'https://'+'1'.repeat(32)+'.r2.cloudflarestorage.com',region:'auto',bucket:'synthetic-vector-51902',team:team.id},
    credentials:{accessKeyId:'synthetic-vector-51903',secretAccessKey:'synthetic-vector-51904'},consent:true,enabled:true,
  },201);
  const view=await native('/views','POST',{name:'synthetic-vector-51910',query:{team:team.id,priority:'high',sort:'oldest'},layout:'list'},201);
  const sheet=await native('/settings/report-exports','POST',{
    name:'synthetic-vector-51911',kind:'sheets',configuration:{viewId:view.id,spreadsheetId:'synthetic-vector-51905',sheet:'Vector'},
    credentials:{clientId:'synthetic-vector-51906',clientSecret:'synthetic-vector-51907',refreshToken:'synthetic-vector-51908'},consent:true,enabled:true,
  },201);
  const receipts=async()=>String(await readFile(process.env.VECTOR_CHANNEL_EDGE,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const tick=async(time)=>{const result=await runtime.req('/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *')+'&time='+time);assert.equal(result.status,200);await result.text();};
  const epoch=Date.parse('2039-01-01T00:00:00Z');
  try {
    await tick(epoch);
    let records=await receipts(),buckets=records.filter(row=>row.method==='report.bucket'&&row.key.includes(bucket.id)),sheets=records.filter(row=>row.method==='report.sheets');
    assert.equal(buckets.length,1);assert.equal(sheets.length,1);
    assert.deepEqual(buckets[0].body.records.filter(row=>row.resource==='issues').map(row=>row.id).sort(),issues.map(row=>row.id).sort());
    assert.deepEqual(sheets[0].body.data[0].values.slice(1).map(row=>row[0]),issues.map(row=>row.identifier));
    let current=await native('/issues/'+issues[0].identifier);
    await native('/issues/'+issues[0].identifier,'PATCH',{expectedVersion:current.version,title:'synthetic-vector-51912'});
    current=await native('/issues/'+issues[1].identifier);
    await native('/issues/'+issues[1].identifier,'PATCH',{expectedVersion:current.version,priority:'low'});
    await tick(epoch+3599999);
    assert.equal((await receipts()).filter(row=>row.method==='report.bucket'&&row.key.includes(bucket.id)).length,1);
    await tick(epoch+3600000);await tick(epoch+3600000);
    records=await receipts();buckets=records.filter(row=>row.method==='report.bucket'&&row.key.includes(bucket.id));sheets=records.filter(row=>row.method==='report.sheets');
    assert.equal(buckets.length,2);assert.equal(sheets.length,2);
    const delta=buckets[1].body.records;
    assert.equal(delta.length,4);assert.equal(delta.filter(row=>row.resource==='history').length,2);
    assert.deepEqual(delta.filter(row=>row.resource==='issues').map(row=>row.id).sort(),issues.map(row=>row.id).sort());
    assert.equal(delta.find(row=>row.id===issues[0].id).row.title,'synthetic-vector-51912');
    assert.equal(sheets[1].body.valueInputOption,'RAW');
    assert.deepEqual(sheets[1].body.data[0].values[1].slice(0,2),[issues[0].identifier,'synthetic-vector-51912']);
    assert.deepEqual(sheets[1].body.data[0].values[2],Array(12).fill(''));
    const status=await native('/settings/report-exports');
    assert.deepEqual(status.runs.filter(row=>[bucket.id,sheet.id].includes(row.exportId)).map(row=>row.state),Array(4).fill('succeeded'));
    console.log('PROBE REPORT-005 scheduled-client: real local Settings and emitted cron -> two signed bucket exports (second: four changed records) and two Google batch updates (changed title retained, departed row blank); repeated hour emits no additional transfer.');
  }finally{
    await native('/settings/report-exports/'+bucket.id,'DELETE');
    await native('/settings/report-exports/'+sheet.id,'DELETE');
  }
}
