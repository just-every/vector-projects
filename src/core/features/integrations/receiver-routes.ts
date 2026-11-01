import {receiveError} from './errors/receiver';
import {receiveSlackEvent} from './slack-app/events';
import {completeInstall} from './slack-app/install';
import {receiveProviderEvents} from '../email-intake/provider-events';
import { Hono } from 'hono';
import type { AppEnvironment } from '../../app/bindings';
import { IntegrationError } from './errors';
import { ingestSource } from './source-ingest';
import { receiveSourceWebhook } from './source-webhook';
import { receiveGithub } from './github/receiver';
import { receiveSlackAction } from './slack-dm/interactive';
export function createIntegrationReceivers(){
 const app=new Hono<AppEnvironment>();
 app.onError((error,c)=>error instanceof IntegrationError?c.json({error:error.code,message:error.message},error.status,{'Cache-Control':'no-store'}):c.json({error:'integration_unavailable'},503,{'Cache-Control':'no-store'}));
 app.post('/errors/:provider/:team',async c=>c.json(await receiveError(c.env,c.req.raw,c.req.param('provider'),c.req.param('team'))));
 app.post('/sources/:id/events',async c=>c.json(await ingestSource(c.env,c.req.raw,c.req.param('id'))));
 app.post('/sources/:id/receive/:token',async c=>c.json(await receiveSourceWebhook(c.env,c.req.raw,c.req.param('id'),c.req.param('token')),200,{'Cache-Control':'no-store'}));
 app.post('/github/:id',async c=>c.json(await receiveGithub(c.env,c.req.raw,c.req.param('id'))));
 app.get('/slack/oauth/callback',async c=>{await completeInstall(c.env,c.req.raw);c.header('Referrer-Policy','no-referrer');c.header('Cache-Control','no-store');return c.redirect('/app/settings/connections',303);});
 app.post('/slack/events',async c=>c.json(await receiveSlackEvent(c.env,c.req.raw),200,{'Cache-Control':'no-store'}));
 app.post('/slack/interactive',async c=>{await receiveSlackAction(c.env,c.req.raw,work=>c.executionCtx.waitUntil(work));return c.body(null,200,{'Cache-Control':'no-store'});});
 app.post('/sendgrid/events/:teamId',c=>receiveProviderEvents(c.env,c.req.raw,c.req.param('teamId')));
 return app;
}
