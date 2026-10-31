import { appendFileSync } from 'node:fs';

/** Only the emitted Worker's provider boundary. No application fixture route
 * exists, and authorization headers and refresh credentials are never recorded. */
export async function reportProviderEdge(request) {
  const url=new URL(request.url);
  const record=value=>appendFileSync(process.env.VECTOR_CHANNEL_EDGE,JSON.stringify(value)+'\n');
  if(url.hostname==='1'.repeat(32)+'.r2.cloudflarestorage.com') {
    if(request.method!=='PUT'||!request.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 '))throw Error('Unexpected bucket export protocol');
    record({method:'report.bucket',key:url.pathname,body:await request.json()});
    return new Response(null,{status:200});
  }
  if(url.href==='https://oauth2.googleapis.com/token') {
    if(request.method!=='POST')throw Error('Unexpected refresh protocol');
    const body=new URLSearchParams(await request.text());
    if(body.get('grant_type')!=='refresh_token'||body.get('client_id')!=='synthetic-vector-51906'||body.get('client_secret')!=='synthetic-vector-51907'||body.get('refresh_token')!=='synthetic-vector-51908')return new Response(null,{status:400});
    record({method:'report.refresh'});
    return Response.json({access_token:'synthetic-vector-51909',token_type:'Bearer',expires_in:3600});
  }
  if(url.hostname==='sheets.googleapis.com') {
    if(url.pathname!=='/v4/spreadsheets/synthetic-vector-51905/values:batchUpdate'||request.method!=='POST'||request.headers.get('authorization')!=='Bearer synthetic-vector-51909')throw Error('Unexpected spreadsheet export protocol');
    const body=await request.json();
    record({method:'report.sheets',body});
    return Response.json({spreadsheetId:'synthetic-vector-51905',totalUpdatedCells:body.data[0].values.reduce((sum,row)=>sum+row.length,0)});
  }
}
