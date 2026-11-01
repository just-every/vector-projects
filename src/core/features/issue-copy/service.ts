import { issueReferenceStatements } from "../issue-references/repository";
import {
  mutationDatabase,
  isMutationAccessError,
} from "../auth/mutation-database";
import { requireIssueAccess } from "../issues/access";
import { requireTeamMoveIssue } from "../team-move/repository";
import { allocateIssueSequence } from "../issues/create-guard";
import { createUlid } from "../../shared/ids";
import { copyIssueSchema, CopyConflict, type CopyIssueInput } from "./schema";
import { readCopySnapshot, copySnapshotSql } from "./snapshot";
import { copyDestination, mapCopyValues } from "./mapping";
import { getIssueDetail } from "../issues/service";

export async function copyIssue(
  source: D1Database,
  identifier: string,
  actor: string,
  request: CopyIssueInput,
) {
  const input = copyIssueSchema.parse(request),
    db = mutationDatabase(source, actor);
  await requireIssueAccess(db, identifier, actor);
  const original = await requireTeamMoveIssue(db, identifier, actor);
  if (original.version !== input.expectedVersion) throw new CopyConflict();
  const teamId = input.teamId ?? original.team_id;
  const [target, snapshot] = await Promise.all([
    copyDestination(db, teamId, original.workspace_id),
    readCopySnapshot(
      db,
      identifier,
      input.includeSubissues,
      input.includeLinks,
    ),
  ]);
  if (snapshot.rows[0]?.version !== input.expectedVersion)
    throw new CopyConflict();
  const now = new Date(),
    at = now.toISOString();
  const plans = await Promise.all(
    snapshot.rows.map(async (row) => ({
      row,
      id: createUlid(now),
      mapped: await mapCopyValues(db, row, teamId, original.workspace_id),
    })),
  );
  // Reserve in order: each durable identifier is used at most once, even when
  // a subsequent snapshot/authority check refuses the atomic copy transaction.
  const allocated = [];
  for (const plan of plans) {
    const sequence = await allocateIssueSequence(
      db,
      actor,
      original.workspace_id,
      teamId,
      at,
    );
    allocated.push({
      ...plan,
      ...sequence,
      identifier: `${sequence.prefix}-${sequence.sequence}`,
    });
  }
  if (allocated.some((plan) => plan.prefix !== target.identifier_prefix))
    throw new CopyConflict();
  const guard = db
    .prepare(
      `SELECT CASE WHEN (${copySnapshotSql()})=? THEN 1 ELSE json('copy snapshot changed') END`,
    )
    .bind(...snapshot.values, snapshot.encoded);
  const writes: D1PreparedStatement[] = [
    guard,
    db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM issues i JOIN teams t ON t.id=i.team_id JOIN operators o ON o.workspace_id=t.workspace_id
      WHERE i.id=? AND t.workspace_id=? AND o.id=? AND o.removed_at IS NULL) THEN 1 ELSE json('copy source access changed') END`)
      .bind(original.id,original.workspace_id,actor),
    db
      .prepare(
        `SELECT CASE WHEN EXISTS(SELECT 1 FROM teams t WHERE t.id=? AND t.workspace_id=? AND t.archived_at IS NULL AND t.identifier_prefix=?)
      AND ?=(SELECT id FROM workflow_statuses WHERE team_id=? AND category='backlog' ORDER BY position,id LIMIT 1)
      THEN 1 ELSE json('copy destination changed') END`,
      )
      .bind(
        teamId,
        original.workspace_id,
        target.identifier_prefix,
        target.status_id,
        teamId,
      ),
  ];
  for (const plan of allocated) {
    const { row, mapped, id } = plan;
    writes.push(
      db
        .prepare(
          `SELECT CASE WHEN
      (? IS NULL OR EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=?))
      AND (? IS NULL OR EXISTS(SELECT 1 FROM project_milestones m JOIN projects p ON p.id=m.project_id WHERE m.id=? AND m.project_id=? AND p.workspace_id=?))
      AND (? IS NULL OR EXISTS(SELECT 1 FROM cycles c JOIN teams t ON t.id=c.team_id WHERE c.id=? AND c.team_id=? AND t.cycles_enabled=1 AND c.closed_at IS NULL))
      AND NOT EXISTS(SELECT value FROM json_each(?) WHERE NOT EXISTS(SELECT 1 FROM labels WHERE id=value AND workspace_id=?))
      THEN 1 ELSE json('copy option changed') END`,
        )
        .bind(
          mapped.projectId,
          mapped.projectId,
          original.workspace_id,
          mapped.milestoneId,
          mapped.milestoneId,
          mapped.projectId,
          original.workspace_id,
          mapped.cycleId,
          mapped.cycleId,
          teamId,
          JSON.stringify(mapped.labels),
          original.workspace_id,
        ),
    );
    writes.push(
      db
        .prepare(
          `INSERT INTO issues(id,identifier,origin_prefix,sequence_number,team_id,title,description,status_id,priority,project_id,milestone_id,cycle_id,start_date,due_date,estimate,expected_outcome,customer_impact,custom_fields_json,version,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        )
        .bind(
          id,
          plan.identifier,
          plan.prefix,
          plan.sequence,
          teamId,
          row.title,
          row.description,
          target.status_id,
          row.priority,
          mapped.projectId,
          mapped.milestoneId,
          mapped.cycleId,
          row.start_date,
          row.due_date,
          row.estimate,
          row.expected_outcome,
          row.customer_impact,
          JSON.stringify(mapped.customFields),
          at,
          at,
        ),
      db
        .prepare(
          `INSERT INTO issue_labels(issue_id,label_id,created_at) SELECT ?,value,? FROM json_each(?)`,
        )
        .bind(id, at, JSON.stringify(mapped.labels)),
    );
    const copiedActivityId = createUlid(now);
    for (const [issueId, kind, next] of [
      [id, "issue.copied_from", { identifier: row.identifier }],
      [row.id, "issue.copied_to", { identifier: plan.identifier }],
    ] as const)
      writes.push(
        db
          .prepare(
            `INSERT INTO issue_activity(id,issue_id,actor_operator_id,kind,next_value_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,
          )
          .bind(
            issueId === id ? copiedActivityId : createUlid(now),
            issueId,
            actor,
            kind,
            JSON.stringify(next),
            at,
            at,
          ),
      );
    writes.push(...issueReferenceStatements(db, { id: copiedActivityId, issueId: id, actor, at }, row.description));
    if (input.includeLinks)
      writes.push(
        db
          .prepare(
            `INSERT INTO issue_links(id,issue_id,actor_operator_id,name,url,created_at,updated_at)
      SELECT ?||upper(hex(randomblob(8))),?,?,json_extract(value,'$.name'),json_extract(value,'$.url'),?,? FROM json_each(?)`,
          )
          .bind(createUlid(now).slice(0, 10), id, actor, at, at, JSON.stringify(row.links)),
      );
  }
  for (const plan of allocated)
    if (plan.row.parent_id) {
      const parent = allocated.find(
        (candidate) => candidate.row.id === plan.row.parent_id,
      );
      if (!parent) throw new Error("A copied sub-issue has no copied parent.");
      writes.push(
        db
          .prepare(
            "INSERT INTO issue_parents(issue_id,parent_issue_id,created_at,position) VALUES(?,?,?,?)",
          )
          .bind(plan.id, parent.id, at, plan.row.position),
      );
    }
  try {
    await db.batch(writes);
  } catch (error) {
    if (isMutationAccessError(error)) throw error;
    await requireIssueAccess(db, identifier, actor);
    if (
      (
        await readCopySnapshot(
          db,
          identifier,
          input.includeSubissues,
          input.includeLinks,
        )
      ).encoded !== snapshot.encoded
    )
      throw new CopyConflict();
    if (/malformed JSON|copy .* changed/.test(String(error)))
      throw new CopyConflict();
    throw error;
  }
  const issue = await getIssueDetail(db, allocated[0].identifier, new Date());
  if (!issue) throw new Error("The committed copy is unavailable.");
  await requireIssueAccess(db, issue.identifier, actor);
  return {
    issue,
    copies: allocated.map((plan) => ({
      fromIdentifier: plan.row.identifier,
      identifier: plan.identifier,
    })),
    mappings: allocated.map((plan) => ({
      identifier: plan.row.identifier,
      status: { from: plan.row.status_id, to: target.status_id },
      labels: plan.mapped.labels.map((id) => ({ from: id, to: id })),
      customFields: Object.keys(plan.mapped.customFields).map((key) => ({
        from: key,
        to: key,
      })),
    })),
    droppedValues: allocated.flatMap((plan) => plan.mapped.dropped),
  };
}
