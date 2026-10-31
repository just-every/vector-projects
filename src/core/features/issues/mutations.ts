import { getIssueDetail } from './service'
import { createIssueRecord, writeIntakeDecision } from './repository'
import type { AcceptIssueInput, CreateIssueInput, DeclineIssueInput, DeferIssueInput } from './input'

export async function createIssue(binding: D1Database, actorOperatorId: string, input: CreateIssueInput, now = new Date(), onCommitted?: () => Promise<unknown>, commitStatements?: (db: D1Database, identifier: string) => D1PreparedStatement[]) {
  const created = await createIssueRecord(binding, { actorOperatorId, input, now, commitStatements })
  // Mail settlement and the fresh detail read are independent after commit.
  const [issue] = await Promise.all([getIssueDetail(binding, created.identifier, now), onCommitted?.()])
  if (!issue) throw new Error(`Created issue ${created.identifier} could not be read.`)
  return issue
}

export async function acceptIssue(binding: D1Database, actorOperatorId: string, identifier: string, input: AcceptIssueInput, now = new Date()) {
  return decisionResult(binding, actorOperatorId, identifier, input, 'accepted', now)
}

export async function deferIssue(binding: D1Database, actorOperatorId: string, identifier: string, input: DeferIssueInput, now = new Date()) {
  return decisionResult(binding, actorOperatorId, identifier, input, 'deferred', now)
}

export async function declineIssue(binding: D1Database, actorOperatorId: string, identifier: string, input: DeclineIssueInput, now = new Date()) {
  return decisionResult(binding, actorOperatorId, identifier, input, 'declined', now)
}

async function decisionResult(
  binding: D1Database,
  actorOperatorId: string,
  identifier: string,
  input: AcceptIssueInput | DeferIssueInput | DeclineIssueInput,
  kind: 'accepted' | 'deferred' | 'declined',
  now: Date,
) {
  const result = await writeIntakeDecision(binding, { actorOperatorId, expectedVersion: input.expectedVersion, identifier, input, kind, now })
  const issue = await getIssueDetail(binding, result.identifier, now)
  if (!issue) throw new Error(`Issue ${result.identifier} could not be read after its decision.`)
  return { ...result, issue }
}
