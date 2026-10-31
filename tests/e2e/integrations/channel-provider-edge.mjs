import {videoProviderEdge} from "./video-provider-edge.mjs";
import {reportProviderEdge} from './report-provider-edge.mjs';
// Synthetic Slack/Discord network edge for the built-Worker journey only.
import {appendFileSync,readFileSync} from 'node:fs';
export const slackAppFixture={appId:'synthetic-vector-32010',clientId:'synthetic-vector-32011',clientSecret:'synthetic-vector-32012',signingSecret:'synthetic-vector-32013',botToken:'synthetic-vector-32014',teamId:'TSYNTHETIC33001',memberId:'USYNTHETIC33001',intakeChannel:'CSYNTHETIC33001',botId:'USYNTHETIC33002'};
export async function channelProviderEdge(request){
 const report=await reportProviderEdge(request);if(report)return report;
 const video=await videoProviderEdge(request);if(video)return video;
 const url=new URL(request.url);
 if(url.hostname==='api.sendgrid.com'&&url.pathname==='/v3/mail/send'){appendFileSync(process.env.VECTOR_CHANNEL_EDGE,JSON.stringify({method:'sendgrid',body:await request.json()})+'\n');return new Response(null,{status:202,headers:{'X-Message-Id':'synthetic-vector-'+crypto.randomUUID()}});}
 if(url.hostname==='sentry.io'&&/^\/api\/0\/issues\/[0-9]+\/events\/latest\/$/.test(url.pathname)&&request.method==='GET'){if(request.headers.get('Authorization')!=='Bearer synthetic-vector-8201')return new Response(null,{status:401});return Response.json({release:{version:'synthetic-vector-8203'}});}
 if(url.hostname==='sentry.io'&&/^\/api\/0\/issues\/[0-9]+\/$/.test(url.pathname)&&request.method==='PUT'){
  if(request.headers.get('Authorization')!=='Bearer synthetic-vector-8201')return new Response(null,{status:401});
  const body=await request.json();appendFileSync(process.env.VECTOR_CHANNEL_EDGE,JSON.stringify({method:'sentry.resolve',record:url.pathname.split('/')[4],body})+'\n');return Response.json({status:'resolved'});
 }
 if(url.hostname==='api.datadoghq.com'&&url.pathname==='/api/v1/integration/webhooks/configuration/webhooks'&&request.method==='POST'){
  if(request.headers.get('DD-API-KEY')!=='synthetic-vector-8211'||request.headers.get('DD-APPLICATION-KEY')!=='synthetic-vector-8212')return new Response(null,{status:403});
  const {custom_headers,...body}=await request.json();appendFileSync(process.env.VECTOR_CHANNEL_EDGE,JSON.stringify({method:'datadog.register',body})+'\n');return Response.json({});
 }
 const body=request.method==='GET'?Object.fromEntries(url.searchParams):request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(await request.text())):await request.json(),method=url.hostname==='slack.com'?url.pathname.slice(5):'discord';
 if(!['apps.manifest.create','oauth.v2.access','auth.test','auth.revoke','conversations.info','conversations.create','chat.postMessage','users.lookupByEmail','conversations.open','chat.update','discord'].includes(method))throw Error('Unexpected provider fixture endpoint');
 appendFileSync(process.env.VECTOR_CHANNEL_EDGE,JSON.stringify({method,body})+'\n');
 if(method==='apps.manifest.create')return Response.json(request.headers.get('Authorization')==='Bearer synthetic-vector-32016'?{ok:false,error:'invalid_auth'}:{ok:true,app_id:slackAppFixture.appId,credentials:{client_id:slackAppFixture.clientId,client_secret:slackAppFixture.clientSecret,signing_secret:slackAppFixture.signingSecret}});
 if(method==='oauth.v2.access')return Response.json({ok:true,token_type:'bot',app_id:slackAppFixture.appId,scope:'chat:write,channels:manage,channels:read,im:write,users:read.email,app_mentions:read,channels:history,commands,links:read,links:write',access_token:slackAppFixture.botToken});
 if(method==='auth.test')return Response.json(request.headers.get('Authorization')==='Bearer synthetic-vector-1850'?{ok:true,team:'Harbor Slack',team_id:'TSYNTHETICB'}:{ok:true,team:'Delivery workspace',team_id:slackAppFixture.teamId});
 if(method==='auth.revoke')return Response.json({ok:true,revoked:true});
 if(method==='conversations.info')return Response.json({ok:true,channel:{id:body.channel,name:request.headers.get('Authorization')==='Bearer synthetic-vector-1850'?'checkout-updates':'delivery',is_channel:true,is_member:true,is_archived:false,is_shared:false,is_ext_shared:false,is_org_shared:false,is_pending_ext_shared:false}});
 // The journey lists the Slack accounts that exist for an email; any other email has none.
 if(method==='users.lookupByEmail'){let users={};try{users=JSON.parse(readFileSync(process.env.VECTOR_CHANNEL_EDGE+'.users','utf8'));}catch{}return Response.json(users[body.email]?{ok:true,user:users[body.email]}:{ok:false,error:'users_not_found'});}
 if(method==='conversations.open')return Response.json({ok:true,channel:{id:'D'+String(body.users).slice(1)}});
 if(method==='chat.update')return Response.json({ok:true,channel:body.channel,ts:body.ts});
 if(method==='conversations.create')return Response.json({ok:true,channel:{id:'C'+body.name.replaceAll('-','').toUpperCase(),name:body.name}});
 if(method==='chat.postMessage')return Response.json(body.channel==='CREFUSED'?{ok:false,error:'not_in_channel'}:{ok:true,ts:'123.456'});
 if(!['discord.com','discordapp.com'].includes(url.hostname))throw Error('Unexpected fixture host');
 return Response.json({id:'fixture-message',content:body.content});
}
