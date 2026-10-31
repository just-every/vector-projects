import {triageCreationStatements} from '../triage-responsibility/repository';
import { issueReferenceStatements } from "../issue-references/repository";
import { followStatements, mentionStatements, finalizeEvent } from '../notifications/events';
import { mutationDatabase, isMutationAccessError } from '../auth/mutation-database'
import { creationGuard, creationError, allocateIssueSequence } from '../issues/create-guard'
import { drizzle } from "drizzle-orm/d1";
import { createUlid } from "../../shared/ids";
import { currentAgentActor, agentActivity } from '../agent-door/attribution';
import {
  defaultStatus,
  requireActiveTeam,
} from "../issues/repository";
import { IssueMutationError } from "../issues/errors";
import type { OperatorIntakeInput } from "./input";

/** Identifier reservations survive failed persistence. Issue, evidence and
 * activity share one guarded batch and never target an archived team. */
export async function createOperatorIntake(
  db: D1Database,
  actor: string,
  input: OperatorIntakeInput,
  now = new Date(),
  onCommit?: (db: D1Database, created: { id: string; identifier: string }) => D1PreparedStatement[],
  sourceActor?: { name: string },
) {
  db = mutationDatabase(db, actor);
  const orm = drizzle(db);
  let team;
  try { team = await requireActiveTeam(orm, input.teamId); } catch(error) { return creationError(db,input.teamId,error,true); }
  const status = await defaultStatus(orm, team.id, "intake");
  const at = now.toISOString();
  let allocation:{sequence:number;prefix:string};
  try { allocation = await allocateIssueSequence(db,actor,team.workspaceId,team.id,at); } catch(error) {
    if (isMutationAccessError(error)) throw new Error("The team or operator is no longer available for intake.", { cause: error });
    return creationError(db,team.id,error,true);
  }
  const identifier = `${allocation.prefix}-${allocation.sequence}`;

  const issueId = createUlid(now);
  const evidenceId = createUlid(now);
  const activityId = createUlid(now);
  const observedAt = input.observedAt
    ? new Date(input.observedAt).toISOString()
    : at;
  const summary = input.summary || input.title;
  const issue = db
    .prepare(
      `INSERT INTO issues
    (id,identifier,origin_prefix,sequence_number,team_id,title,description,status_id,priority,
     expected_outcome,customer_impact,custom_fields_json,version,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,'none',?,?,'{}',1,?,?
    FROM teams t JOIN workflow_statuses s ON s.team_id=t.id
    JOIN operators o ON o.workspace_id=t.workspace_id
    WHERE t.id=? AND t.archived_at IS NULL AND s.id=? AND s.category='intake'
    AND o.id=? AND o.removed_at IS NULL RETURNING id`,
    )
    .bind(
      issueId,
      identifier,
      allocation.prefix,
      allocation.sequence,
      team.id,
      input.title,
      input.description,
      status.id,
      input.expectedOutcome,
      input.customerImpact,
      at,
      at,
      team.id,
      status.id,
      actor,
    );
  const evidence = db
    .prepare(
      `INSERT INTO evidence_revisions
    (id,issue_id,source_name,origin_kind,actor_operator_id,observed_at,received_at,summary,
     link,measurements_json,customer_reports_json,assertions_json,created_at,updated_at)
    SELECT ?,id,'Operator report','operator',?,?,?,?,?,?,?,'{}',?,? FROM issues WHERE id=?`,
    )
    .bind(
      evidenceId,
      actor,
      observedAt,
      at,
      summary,
      input.link,
      JSON.stringify(input.measurements),
      JSON.stringify(input.customerReports),
      at,
      at,
      issueId,
    );
  const activity = db
    .prepare(
      `INSERT INTO issue_activity
    (id,issue_id,actor_operator_id,kind,previous_value_json,next_value_json,created_at,updated_at,actor_name,agent_id,agent_operation_id,agent_approvers_json)
    SELECT ?,id,?,'issue.created',NULL,?,?,?,?,?,?,? FROM issues WHERE id=?`,
    )
    .bind(
      activityId,
      actor,
      JSON.stringify({
        identifier,
        title: input.title,
        teamId: team.id,
        statusId: status.id,
        evidenceRevisionId: evidenceId,
        originKind: sourceActor ? "source" : "operator",
      }),
      at,
      at,
      currentAgentActor()?.actor.label??null,
      agentActivity().agentId,
      agentActivity().agentOperationId,
      agentActivity().agentApproversJson,
      issueId,
    );
  // Source custody still uses the current configured operator's authority;
  // notification attribution and actor exclusion name the actual source.
  const event = { id: activityId, issueId, actor: sourceActor ? null : actor, actorName: sourceActor?.name, at };
  const triage = await triageCreationStatements(db,event,team.id);
  let result;
  try { result = await db.batch<{ id: string }>([creationGuard(db,actor,team.workspaceId,team.id,status.id,{projectId:null,cycleId:null,labelIds:[]},status.category,allocation.prefix),issue,evidence,activity,...triage,...followStatements(db,event,[actor]),...mentionStatements(db,event,input.description),...issueReferenceStatements(db,{...event,actor},input.description),...finalizeEvent(db,event),...(onCommit?.(db,{id:issueId,identifier}) ?? [])]); }
  catch (error) { return creationError(db,team.id,error,true); }
  // The indexed issue insert returns its own identity independently of trigger writes.
  if (result[1].results.length !== 1 || result[1].results[0].id !== issueId)
    throw new IssueMutationError(
      "invalid_option",
      "The team or operator is no longer available for intake.",
    );
  return { identifier };
}

export type EvidenceMetadata = {
  id: string;
  origin_kind: "source" | "operator";
  actor_operator_id: string | null;
  actor: string | null;
  link: string | null;
  customer_reports_json: string;
  source_id:string|null;source_record_id:string|null;source_revision_id:string|null;
};
export function evidenceMetadataStatement(db: D1Database, issueId: string) {
  return db
      .prepare(
        `SELECT e.id,e.origin_kind,e.actor_operator_id,o.name AS actor,e.link,e.customer_reports_json,e.source_id,e.source_record_id,e.source_revision_id
    FROM evidence_revisions e LEFT JOIN operators o ON o.id=e.actor_operator_id WHERE e.issue_id=?`,
      )
      .bind(issueId);
}
