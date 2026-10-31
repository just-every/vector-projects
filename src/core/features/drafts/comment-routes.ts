import type { Hono } from 'hono';
import type { AppEnvironment } from '../../app/bindings';
import { readRequestJson } from '../../app/input';
import { requireIssueProjection } from '../issues/projection-access';
import { discussionAccess } from '../discussion/access';
import { threadRoot, ThreadError } from '../discussion/threads';
import { draftRevisionSchema } from './schema';
import { commentDraftCreateSchema, commentDraftWriteSchema } from './comment-schema';
import { listCommentDrafts, readCommentDraft, saveCommentDraft, discardCommentDraft } from './comment-repository';

export function addCommentDraftRoutes(app: Hono<AppEnvironment>) {
  app.get('/comment-drafts', async c => c.json({ drafts: await listCommentDrafts(c.env.DB,c.get('operatorId')) }));
  app.post('/issues/:identifier/comment-drafts', discussionAccess(async c => {
    c.set('mutationPageProjection',true);
    const input = commentDraftCreateSchema.safeParse(await readRequestJson(c.req.raw));
    if (!input.success) return c.json({ error: 'invalid_request' },400);
    const issue = await requireIssueProjection(c,c.req.param('identifier') ?? '');
    if (input.data.parentId) {
      try { await threadRoot(c.env.DB,issue.id,input.data.parentId); }
      catch (error) { if (error instanceof ThreadError) return c.json({error:'not_found'},404); throw error; }
    }
    const result = await saveCommentDraft(c.env.DB,c.get('operatorId'),{id:input.data.id,revision:0},input.data.body,
      input.data.anchor,{ issueId:issue.id,parentId:input.data.parentId });
    return c.json({ draft:result.draft },result.written ? 201 : 409);
  }));
  for (const method of ['PATCH','DELETE'] as const) app.on(method,'/comment-drafts/:id',discussionAccess(async c => {
    c.set('mutationPageProjection',true);
    const body = await readRequestJson(c.req.raw);
    const write = method === 'PATCH' ? commentDraftWriteSchema.safeParse(body) : null;
    const input = write ?? draftRevisionSchema.safeParse(body);
    if (!input.success) return c.json({ error:'invalid_request' },400);
    const current = await readCommentDraft(c.env.DB,c.get('operatorId'),c.req.param('id') ?? '');
    if (!current) return c.json({ draft:null },409);
    await requireIssueProjection(c,current.identifier);
    const ref = {id:current.id,revision:input.data.revision};
    const result = write?.success ? await saveCommentDraft(c.env.DB,c.get('operatorId'),ref,write.data.body,write.data.anchor)
      : await discardCommentDraft(c.env.DB,c.get('operatorId'),ref);
    return c.json({ draft:result.draft },result.written ? 200 : 409);
  }));
}
