import type { Hono } from 'hono';
import type { AppEnvironment } from '../../app/bindings';
import { readRequestJson } from '../../app/input';
import { draftWriteSchema, draftRevisionSchema } from './schema';
import { listDrafts, readDraft, saveDraft, discardDraft } from './repository';

export function addDraftRoutes(app: Hono<AppEnvironment>) {
  app.get('/drafts', async c => c.json({ drafts: await listDrafts(c.env.DB, c.get('operatorId')) }));
  app.get('/drafts/:id', async c => {
    const draft = await readDraft(c.env.DB, c.get('operatorId'), c.req.param('id'));
    return c.json({ draft }, draft ? 200 : 404);
  });
  app.post('/drafts', async c => {
    c.set('mutationPageProjection', true);
    const parsed = draftWriteSchema.safeParse(await readRequestJson(c.req.raw));
    if (!parsed.success || !parsed.data.id || parsed.data.revision !== undefined) return c.json({ error: 'invalid_request' }, 400);
    const result = await saveDraft(c.env.DB, c.get('operatorId'), parsed.data.values, { id: parsed.data.id, revision: 0 });
    return c.json({ draft: result.draft, ...(!result.written ? { error: result.exists ? 'draft_changed' : 'invalid_request' } : {}) }, result.written ? 201 : result.exists ? 409 : 400);
  });
  app.patch('/drafts/:id', async c => {
    c.set('mutationPageProjection', true);
    const parsed = draftWriteSchema.safeParse(await readRequestJson(c.req.raw));
    if (!parsed.success || !parsed.data.revision || parsed.data.id !== undefined) return c.json({ error: 'invalid_request' }, 400);
    const result = await saveDraft(c.env.DB, c.get('operatorId'), parsed.data.values,
      { id: c.req.param('id'), revision: parsed.data.revision });
    return c.json({ draft: result.draft, ...(!result.written ? { error: 'draft_changed', message: 'This draft changed on another device.' } : {}) }, result.written ? 200 : 409);
  });
  app.delete('/drafts/:id', async c => {
    c.set('mutationPageProjection', true);
    const parsed = draftRevisionSchema.safeParse(await readRequestJson(c.req.raw));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const result = await discardDraft(c.env.DB, c.get('operatorId'), { id: c.req.param('id'), revision: parsed.data.revision });
    return c.json({ draft: result.draft }, result.written ? 200 : 409);
  });
}
