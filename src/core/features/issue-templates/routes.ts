import type { Hono, Context } from 'hono'
import { SettingsError } from '../settings/repository'
import { z } from 'zod'
import type { AppEnvironment } from '../../app/bindings'
import { readRequestJson } from '../../app/input'
import { templateInputSchema } from './schema'
import { listTemplates,readTemplate,saveTemplate,deleteTemplate } from './repository'
export function addIssueTemplateRoutes(app:Hono<AppEnvironment>) {
  const action=(run:(c:Context<AppEnvironment>)=>Promise<Response>)=>async(c:Context<AppEnvironment>)=>{try{return await run(c)}catch(e){if(e instanceof SettingsError)return c.json({error:e.code,message:e.message},e.status);if(e instanceof z.ZodError)return c.json({error:'invalid_request',issues:e.issues},400);throw e}}
  app.get('/issue-templates',action(async c=>c.json(await listTemplates(c.env.DB,c.get('operatorId')))))
  app.get('/issue-templates/:id',action(async c=>c.json(await readTemplate(c.env.DB,c.get('operatorId'),c.req.param('id')!))))
  app.post('/issue-templates',action(async c=>c.json(await saveTemplate(c.env.DB,c.get('operatorId'),templateInputSchema.parse(await readRequestJson(c.req.raw))),201)))
  app.put('/issue-templates/:id',action(async c=>{
    const {expectedVersion,...input}=z.object({expectedVersion:z.number().int().positive()}).passthrough().parse(await readRequestJson(c.req.raw))
    return c.json(await saveTemplate(c.env.DB,c.get('operatorId'),templateInputSchema.parse(input),c.req.param('id')!,expectedVersion))
  }))
  app.delete('/issue-templates/:id',action(async c=>{
    const {expectedVersion}=z.object({expectedVersion:z.number().int().positive()}).strict().parse(await readRequestJson(c.req.raw))
    return c.json(await deleteTemplate(c.env.DB,c.get('operatorId'),c.req.param('id')!,expectedVersion))
  }))
}
