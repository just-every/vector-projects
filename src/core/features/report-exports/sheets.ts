import type { WorkerBindings } from '../../app/bindings';
import type { IssueListData } from '../issues/list-schema';
import { listIssues } from '../issues/list';
import { getView } from '../views/service';
import { visibilityDatabase } from '../roles/visibility-database';
import { IntegrationError } from '../integrations/errors';
import type { sheetsConfiguration, sheetsCredentials } from './schedule-schema';
import type { z } from 'zod';

type Row=IssueListData['issues'][number];
/** The properties rendered by the current native list: identity and title,
 * status, priority, team, assignee, dates, labels, parent, blocked and checklist.
 * No descriptions, private references, credentials or attachment data. */
const columns:[string,(row:Row)=>string][]=[
  ['Identifier',row=>row.identifier],['Title',row=>row.title],['Status',row=>row.status.name],
  ['Priority',row=>row.priority],['Team',row=>row.team.name],['Assignee',row=>row.assignee?.name??''],
  ['Start date',row=>row.startDate??''],['Due date',row=>row.dueDate??''],
  ['Labels',row=>row.labels.map(label=>label.name).join(', ')],['Parent',row=>row.parent?.identifier??''],
  ['Blocked',row=>row.blocked?'Yes':'No'],['Checklist',row=>row.checklist?.total?row.checklist.completed+' of '+row.checklist.total:''],
];

export async function sheetSnapshot(env:WorkerBindings,actor:string,viewId:string,now:Date) {
  const db=visibilityDatabase(env.DB,actor);
  let view:Awaited<ReturnType<typeof getView>>;
  try{view=await getView(db,actor,viewId);}catch{throw new IntegrationError(403,'export_view_unavailable');}
  // List properties are implemented; board-specific property selection remains
  // a VIEW-008 receiving duty, rather than an invented export configuration.
  if(view.layout!=='list')throw new IntegrationError(409,'export_view_layout_unavailable');
  const values=[columns.map(([name])=>name)];
  let offset=0,revision='';
  for(;;) {
    const page=await listIssues(db,actor,{...view.query,offset,revision,pageSize:100},now);
    revision=page.revision;
    values.push(...page.issues.map(row=>columns.map(([,value])=>value(row))));
    offset+=page.issues.length;
    if(offset>20000)throw new IntegrationError(409,'export_capacity_exceeded');
    if(offset===page.total)break;
    if(!page.issues.length)throw new IntegrationError(409,'export_data_changed');
  }
  return {view,values};
}

async function providerJson(url:string,init:RequestInit) {
  let response:Response;
  try{response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)});}
  catch{throw new IntegrationError(503,'export_transport_uncertain');}
  if(!response.ok) {
    await response.body?.cancel();
    throw new IntegrationError(response.status>=500?503:400,response.status>=500?'export_transport_uncertain':response.status>=300&&response.status<400?'export_redirect_refused':'export_provider_refused');
  }
  // Provider text is never logged or retained. Bound even a successful body.
  const reader=response.body?.getReader();if(!reader)throw new IntegrationError(503,'export_transport_uncertain');
  let text='',size=0;const decoder=new TextDecoder();
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)throw Error();text+=decoder.decode(part.value,{stream:true});}return JSON.parse(text+decoder.decode());}
  catch{throw new IntegrationError(503,'export_transport_uncertain');}
  finally{await reader.cancel().catch(()=>{});}
}
export async function refreshSheetsToken(credentials:z.output<typeof sheetsCredentials>) {
  const result=await providerJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:credentials.clientId,client_secret:credentials.clientSecret,refresh_token:credentials.refreshToken}).toString()});
  if(typeof result.access_token!=='string'||!result.access_token||/[\r\n\x00]/.test(result.access_token)||result.access_token.length>4096||result.token_type!=='Bearer')throw new IntegrationError(503,'export_transport_uncertain');
  return result.access_token as string;
}
export async function putSheet(config:z.output<typeof sheetsConfiguration>,token:string,values:string[][],previousRows:number,previousColumns:number) {
  const rows=Math.max(previousRows,values.length),cols=Math.max(previousColumns,values[0].length);
  if(rows>20001||cols>26)throw new IntegrationError(409,'export_capacity_exceeded');
  const padded=Array.from({length:rows},(_,row)=>Array.from({length:cols},(_,column)=>values[row]?.[column]??''));
  const range="'"+config.sheet.replaceAll("'","''")+"'!A1:"+String.fromCharCode(64+cols)+rows;
  const body=JSON.stringify({valueInputOption:'RAW',includeValuesInResponse:false,data:[{range,majorDimension:'ROWS',values:padded}]});
  if(new TextEncoder().encode(body).byteLength>1024*1024)throw new IntegrationError(409,'export_capacity_exceeded');
  const result=await providerJson('https://sheets.googleapis.com/v4/spreadsheets/'+config.spreadsheetId+'/values:batchUpdate',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,
  });
  if(result.spreadsheetId!==config.spreadsheetId||result.totalUpdatedCells!==rows*cols)throw new IntegrationError(503,'export_transport_uncertain');
}
