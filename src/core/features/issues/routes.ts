import { readDraft, consumeDraftStatements } from '../drafts/repository'
import { requireIssueProjection } from "./projection-access"
import { IssueAccessError } from "./access"
import { readRequestJson } from '../../app/input'
import type { Context } from 'hono'
import {
  acceptIssueInputSchema,
  createIssueInputSchema,
  declineIssueInputSchema,
  deferIssueInputSchema,
} from './input'
import { IssueMutationError } from './errors'
import { acceptIssue, createIssue, declineIssue, deferIssue } from './mutations'
import type { AppEnvironment } from '../../app/bindings'

const issueParamPattern = /^[A-Z]{2,10}-[1-9][0-9]*$/

export async function createIssueRoute(context: Context<AppEnvironment>) {
  const parsed = createIssueInputSchema.safeParse(await requestBody(context))
  if (!parsed.success) return invalidRequest(context, parsed.error.issues)
  const draftId = context.req.header('x-vector-draft-id');
  const revision = Number(context.req.header('x-vector-draft-revision'));
  const reference = draftId ? { id: draftId, revision } : undefined;
  if (reference) {
    const draft = await readDraft(context.env.DB, context.get('operatorId'), reference.id);
    if (!Number.isSafeInteger(revision) || !draft || draft.revision !== revision || draft.values.teamId !== parsed.data.teamId)
      return context.json({ error: 'draft_changed', message: 'This draft changed or was removed. Reopen it before submitting.', draft }, 409);
  }
  return respondToMutation(
    context,
    async () => ({
      issue: await createIssue(
        context.env.DB,
        context.get('operatorId'),
        parsed.data,
        new Date(),
        context.get('drainNotifications'),
        reference ? db => consumeDraftStatements(db, context.get('operatorId'), parsed.data.teamId, reference) : undefined,
      ),
      outcome: 'written' as const,
    }),
    201,
  )
}

export async function acceptIssueRoute(context: Context<AppEnvironment>) {
  return decide(context, acceptIssueInputSchema, (input) =>
    acceptIssue(
      context.env.DB,
      context.get('operatorId'),
      context.req.param('identifier') ?? '',
      input,
    ),
  )
}

export async function deferIssueRoute(context: Context<AppEnvironment>) {
  return decide(context, deferIssueInputSchema, (input) =>
    deferIssue(
      context.env.DB,
      context.get('operatorId'),
      context.req.param('identifier') ?? '',
      input,
    ),
  )
}

export async function declineIssueRoute(context: Context<AppEnvironment>) {
  return decide(context, declineIssueInputSchema, (input) =>
    declineIssue(
      context.env.DB,
      context.get('operatorId'),
      context.req.param('identifier') ?? '',
      input,
    ),
  )
}

async function decide<T>(
  context: Context<AppEnvironment>,
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: unknown } }
  },
  mutate: (
    input: T,
  ) => Promise<{ issue: { version: number; identifier: string }; outcome: 'written' | 'stale' }>,
) {
  const identifier = context.req.param('identifier') ?? ''
  if (!issueParamPattern.test(identifier))
    return invalidRequest(context, [{ message: 'Invalid issue identifier.' }])
  const parsed = schema.safeParse(await requestBody(context))
  if (!parsed.success) return invalidRequest(context, parsed.error.issues)
  return respondToMutation(context, () => mutate(parsed.data), 200)
}

async function respondToMutation(
  context: Context<AppEnvironment>,
  mutate: () => Promise<{
    issue: { version: number; identifier: string }
    outcome: 'written' | 'stale'
  }>,
  writtenStatus: 200 | 201,
) {
  try {
    const result = await mutate()
    const page = writtenStatus === 201 && result.outcome === 'written' && context.req.header('x-vector-page') === 'issue'
    if (page) context.set('mutationPageProjection', true)
    await requireIssueProjection(context, result.issue.identifier)
    if (page) {
      const { readPageResources } = await import('../../app/page-resources.server')
      const operator = context.get('operator')
      const href = '/app/issues/' + result.issue.identifier
      const { readAppearance } = await import('../settings/appearance')
      const [resources, { theme }, name] = await Promise.all([readPageResources(context.env, context.req.raw, operator, href,
        { ['/api/issues/' + result.issue.identifier]: result.issue }), readAppearance(context.env.DB, operator.id),
        context.env.DB.prepare('SELECT name FROM operators WHERE id=?').bind(operator.id).first<string>('name')])
      await requireIssueProjection(context, result.issue.identifier)
      context.set('mutationPageProjection', true)
      return context.json({ ...result.issue, page: { id: operator.id, name: name!, resources, theme,
        editorConfigured: Boolean(context.env.RER_MANAGEMENT_ORIGIN && context.env.RER_INSTALLATION_ID) } }, 201)
    }
    return result.outcome === 'stale'
      ? context.json(
          {
            error: 'stale_version',
            issue: result.issue,
            version: result.issue.version,
          },
          409,
        )
      : context.json(result.issue, writtenStatus)
  } catch (error) {
    if (error instanceof IssueAccessError) return context.json({error:error.code,message:error.message},error.status)
    if (!(error instanceof IssueMutationError)) throw error
    if (error.code === 'issue_not_found')
      return context.json({ error: 'not_found', message: error.message }, 404)
    return context.json(
      { error: 'invalid_request', message: error.message },
      error.code === 'invalid_transition' ? 409 : 400,
    )
  }
}

async function requestBody(context: Context<AppEnvironment>): Promise<unknown> {
  return readRequestJson(context.req.raw)
}

function invalidRequest(context: Context<AppEnvironment>, issues: unknown) {
  return context.json({ error: 'invalid_request', issues }, 400)
}
