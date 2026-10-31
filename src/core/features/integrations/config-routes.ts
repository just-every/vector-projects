import {addErrorRoutes} from './errors/routes';
import {addSlackAppRoutes} from './slack-app/routes';
import {addChannelRoutes} from './channels/routes';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnvironment } from '../../app/bindings';
import { readRequestJson } from '../../app/input';
import { integrationOwner,guardedSql,ownerPredicate } from './authority';
import { ownerTokens } from './tokens';
import { recordDevMint } from './dev-credentials';
import { tokenInput,sourceConfigInput,rotationInput,destinationInput,githubInput } from './config-input';
import { registerSource,rotateSource,registerDestination,registerGithub,revokeConfiguration } from './config-storage';
import { reenterCredential } from './reenter';
import { replaceSourceWebhook } from './source-webhook-config';
import { deliveryConfigured } from './outbound';
import { configureDelivery, deliverySetupInput } from './delivery-setup';
import { sendTestWebhook } from './test-webhook';
import { subscriptionInput, updateSubscriptions } from './subscriptions';
import { deliveryResult } from './delivery-result';
import { NativeWebhookRepository } from './outbound-repository';
import { destinationSigningProblems } from './destination-signing';
import { IntegrationError } from './errors';
import {IssueAccessError} from '../issues/access';
import { requireIssueProjection } from '../issues/projection-access';
import { githubIssueProjection } from './github-read';
const inputHelp:Record<string,string>={name:'Enter a name for this connection.',sourceId:'Use a source ID with letters, numbers, dots, underscores or hyphens.',teamId:'Choose a team for new reports.',repository:'Enter the GitHub owner and repository separated by /, for example just-every/run-vector.',overlapHours:'Choose a whole number of hours from 0 to 24.',accountId:'Enter the 32-character Cloudflare account ID.',apiToken:'Enter the Cloudflare read-only API token.',scopes:'Choose at least one API permission.',expiresAt:'Choose a valid future expiry date.'};
function parse<T>(schema:z.ZodType<T>,value:unknown){const result=schema.safeParse(value);if(!result.success)throw new IntegrationError(400,'invalid_integration_input',inputHelp[String(result.error.issues[0]?.path[0])]??'Check the form values and try again.');return result.data;}
const id=z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const personalTokens='SELECT namespace,token_id AS id,name,scopes,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,NOT EXISTS(SELECT 1 FROM integration_tokens t WHERE t.namespace=b.namespace AND t.id=b.token_id) AS requiresReentry FROM vector_integration_tokens b WHERE workspace_id=? AND operator_id=? AND namespace NOT LIKE \'oauth:%\' ORDER BY created_at DESC LIMIT 100';
export function addIntegrationConfigRoutes(app:Hono<AppEnvironment>){
 addErrorRoutes(app);
 addChannelRoutes(app);
 addSlackAppRoutes(app);
 app.get('/settings/integrations',async c=>{
  const owner=await integrationOwner(c.env,c.req.raw,c.get('documentProjection')?c.get('operator'):undefined),sql=guardedSql(c.env.DB,ownerPredicate(owner));
  const rows=await sql.batch([
   {sql:`SELECT id,source_id AS sourceId,name,team_id AS teamId,enabled,revoked_at AS revokedAt,NOT EXISTS(SELECT 1 FROM vector_integration_secret_keys k WHERE k.identity='source:'||vector_integration_sources.id AND k.slot='current') AS requiresReentry,NOT EXISTS(SELECT 1 FROM vector_integration_secret_keys k WHERE k.identity='source-url:'||vector_integration_sources.id AND k.slot='current') AS webhookRequiresReentry FROM vector_integration_sources WHERE workspace_id=? AND NOT EXISTS(SELECT 1 FROM vector_error_connections e WHERE e.source_id=vector_integration_sources.id) ORDER BY name,id LIMIT 100`,params:[owner.workspace]},
   {sql:`SELECT id,name,url,enabled,event_kinds AS events,team_ids AS teamIds,revoked_at AS revokedAt,(SELECT count(*) FROM vector_webhook_events e WHERE e.destination_id=vector_webhook_destinations.id AND e.enqueued_at IS NULL AND NOT EXISTS(SELECT 1 FROM vector_webhook_restore_holds h WHERE h.namespace=e.workspace_id AND h.id=e.id) AND NOT EXISTS(SELECT 1 FROM vector_webhook_erasures h WHERE h.namespace=e.workspace_id AND h.id=e.id)) AS waitingEvents FROM vector_webhook_destinations WHERE workspace_id=? AND kind='webhook' ORDER BY name,id LIMIT 100`,params:[owner.workspace]},
   {sql:`SELECT id,name,repository,enabled,revoked_at AS revokedAt,(SELECT max(d.received_at) FROM vector_github_deliveries d WHERE d.repository_id=vector_github_repositories.id) AS lastReceivedEventAt,NOT EXISTS(SELECT 1 FROM vector_integration_secret_keys k WHERE k.identity='github:'||vector_github_repositories.id AND k.slot='current') AS requiresReentry FROM vector_github_repositories WHERE workspace_id=? ORDER BY name,id LIMIT 100`,params:[owner.workspace]},
   {sql:personalTokens,params:[owner.workspace,owner.id]},
   {sql:`SELECT d.id,d.state,d.attempts,d.next_at AS nextAt,d.created_at AS createdAt,COALESCE(e.event,json_extract(d.envelope,'$.event')) AS event,COALESCE(t.name,'Removed destination') AS destinationName,(SELECT a.outcome FROM integration_attempts a WHERE a.namespace=d.namespace AND a.delivery_id=d.id ORDER BY a.number DESC LIMIT 1) AS outcome,EXISTS(SELECT 1 FROM vector_webhook_erasures h WHERE h.namespace=d.namespace AND h.id=d.id) AS erased FROM integration_deliveries d LEFT JOIN vector_webhook_events e ON e.id=d.id AND e.workspace_id=d.namespace LEFT JOIN vector_webhook_destinations t ON t.id=COALESCE(e.destination_id,json_extract(d.envelope,'$.destinationId')) AND t.workspace_id=d.namespace WHERE d.namespace=? AND json_extract(d.envelope,'$.protocol')<>'slack_dm' ORDER BY d.created_at DESC,d.id LIMIT 100`,params:[owner.workspace]},
   {sql:'SELECT e.id,e.event,e.created_at AS createdAt,e.enqueued_at AS enqueuedAt,EXISTS(SELECT 1 FROM vector_webhook_restore_holds h WHERE h.namespace=e.workspace_id AND h.id=e.id) AS held,EXISTS(SELECT 1 FROM vector_webhook_erasures h WHERE h.namespace=e.workspace_id AND h.id=e.id) AS erased FROM vector_webhook_events e WHERE e.workspace_id=? AND e.event<>\'slack.dm\' ORDER BY created_at DESC,id LIMIT 100',params:[owner.workspace]},
  ]);
  const problems=await destinationSigningProblems(c.env,owner.workspace),destinations=(rows[1] as {id:string;events:string;teamIds:string}[]).map(row=>({...row,events:JSON.parse(row.events),teamIds:JSON.parse(row.teamIds),signingProblem:problems.get(row.id)??null,requiresReentry:problems.has(row.id)?1:0}));
  return c.json({sources:(rows[0] as {id:string}[]).map(row=>({...row,workspaceId:owner.workspace,receiver:c.env.APP_ORIGIN+'/api/integrations/sources/'+row.id+'/events'})),destinations,github:(rows[2] as {id:string}[]).map(row=>({...row,receiver:c.env.APP_ORIGIN+'/api/integrations/github/'+row.id})),tokens:rows[3],deliveries:rows[4].map(row=>{const {outcome,...delivery}=row;return {...delivery,...deliveryResult(String(row.state),outcome?JSON.parse(String(outcome)):null)};}),events:rows[5],outboundConfigured:await deliveryConfigured(c.env,owner.workspace),outboundSetupAvailable:true});
 });
 app.post('/settings/integrations/delivery',async c=>c.json(await configureDelivery(c.env,await integrationOwner(c.env,c.req.raw),parse(deliverySetupInput,await readRequestJson(c.req.raw)))));
 app.post('/settings/integrations/destinations/:id/test',async c=>c.json(await sendTestWebhook(c.env,await integrationOwner(c.env,c.req.raw),parse(id,c.req.param('id')))));
 app.post('/settings/integrations/tokens',async c=>{const owner=await integrationOwner(c.env,c.req.raw);const issued=await ownerTokens(c.env.DB,owner).issue(owner,parse(tokenInput,await readRequestJson(c.req.raw)));await recordDevMint(c.env.DB,owner.fence.sessionId,issued.credential.id);return c.json(issued,201);});
 // A member's own tokens: the personal half of Settings → Integrations (ROLE-008 row "Open Settings pages").
 app.get('/settings/integrations/tokens',async c=>{const owner=await integrationOwner(c.env,c.req.raw,c.get('documentProjection')?c.get('operator'):undefined);const [tokens]=await guardedSql(c.env.DB,ownerPredicate(owner)).batch([{sql:personalTokens,params:[owner.workspace,owner.id]}]);return c.json({tokens});});
 app.get('/settings/integrations/tokens/usage',async c=>{const owner=await integrationOwner(c.env,c.req.raw,c.get('documentProjection')?c.get('operator'):undefined);return c.json({usage:await ownerTokens(c.env.DB,owner).usage(owner)});});
 app.delete('/settings/integrations/tokens/:id',async c=>{
  const owner=await integrationOwner(c.env,c.req.raw),selected=c.req.param('id');
  const [tokens]=await guardedSql(c.env.DB,ownerPredicate(owner)).batch([{
   sql:'SELECT t.id FROM integration_tokens t JOIN vector_integration_tokens b ON b.namespace=t.namespace AND b.token_id=t.id WHERE t.namespace=? AND t.id=? AND b.workspace_id=? AND b.operator_id=?',
   params:['vector:'+owner.workspace+':'+owner.id,selected,owner.workspace,owner.id],
  }]);
  if(!tokens.length)throw new IntegrationError(404,'token_not_found');
  return c.json(await ownerTokens(c.env.DB,owner).revoke(owner,selected));
 });
 app.post('/settings/integrations/sources',async c=>c.json(await registerSource(c.env,await integrationOwner(c.env,c.req.raw),parse(sourceConfigInput,await readRequestJson(c.req.raw))),201));
 app.post('/settings/integrations/sources/:id/rotate',async c=>{const input=parse(rotationInput,await readRequestJson(c.req.raw));return c.json(await rotateSource(c.env,await integrationOwner(c.env,c.req.raw),parse(id,c.req.param('id')),input.overlapHours));});
 app.post('/settings/integrations/sources/:id/webhook-url',async c=>c.json(await replaceSourceWebhook(c.env,await integrationOwner(c.env,c.req.raw),parse(id,c.req.param('id'))),201));
 app.post('/settings/integrations/destinations',async c=>c.json(await registerDestination(c.env,await integrationOwner(c.env,c.req.raw),parse(destinationInput,await readRequestJson(c.req.raw))),201));
 app.put('/settings/integrations/destinations/:id/subscriptions',async c=>c.json(await updateSubscriptions(c.env,await integrationOwner(c.env,c.req.raw),parse(id,c.req.param('id')),parse(subscriptionInput,await readRequestJson(c.req.raw)))));
 app.post('/settings/integrations/github',async c=>c.json(await registerGithub(c.env,await integrationOwner(c.env,c.req.raw),parse(githubInput,await readRequestJson(c.req.raw))),201));
 for(const [kind,path] of [['source','sources'],['destination','destinations'],['github','github']] as const)app.delete('/settings/integrations/'+path+'/:id',async c=>c.json(await revokeConfiguration(c.env,await integrationOwner(c.env,c.req.raw),kind,parse(id,c.req.param('id')))));
 for(const [kind,path] of [['destination','destinations'],['github','github']] as const)app.post('/settings/integrations/'+path+'/:id/reenter',async c=>c.json(await reenterCredential(c.env,await integrationOwner(c.env,c.req.raw),kind,parse(id,c.req.param('id'))),201));
 app.post('/settings/integrations/deliveries/:id/resolve',async c=>{
  const input=parse(z.object({kind:z.enum(['accepted','rejected']),evidenceCode:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/)}).strict(),await readRequestJson(c.req.raw)),owner=await integrationOwner(c.env,c.req.raw),delivery=c.req.param('id');if(!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(delivery))throw new IntegrationError(400,'invalid_delivery_id');
  try{await new NativeWebhookRepository(guardedSql(c.env.DB,ownerPredicate(owner)),owner.workspace).resolve(delivery,{kind:input.kind,code:input.evidenceCode},Date.now());}catch{throw new IntegrationError(409,'delivery_not_uncertain');}return c.json({resolved:true,state:input.kind});
 });
 app.get('/issues/:identifier/github',async c=>{
  try{
   const issue=await requireIssueProjection(c,c.req.param('identifier'));
   const projection=await githubIssueProjection(c.env.DB,issue.id);
   await requireIssueProjection(c,issue.identifier);return c.json(projection,200,{'Cache-Control':'no-store'});
  }catch(error){if(error instanceof IssueAccessError)return c.json({error:error.code,message:error.message},error.status,{'Cache-Control':'no-store'});throw error;}
 });
}
