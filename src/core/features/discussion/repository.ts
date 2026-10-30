import { validDescriptionAnchor, type ThreadAnchorInput } from "./anchors";
import { DescriptionAnchorError } from "./anchor-error";
import { issueReferenceStatements } from "../issue-references/repository";
import { currentAgentActor, agentActivity } from '../agent-door/attribution';
import { commentStatements, mentionStatements, finalizeEvent } from '../notifications/events';
import { IssueAccessError, requireIssueAccess } from '../issues/access';
import { MutationAccessError, RestoreReservationError, isMutationAccessError, mutationDatabase } from "../auth/mutation-database";
import { createUlid } from "../../shared/ids";
import { reopenStatements, threadRoot } from "./threads";
import {
  commentLinkErasureStatements,
  namedLinksStatement,
} from "../links/repository";
import type { NamedLink } from '../links/schema';
import { liveComment, moderatorSql, requireCommentChange } from "./permissions";
import { commentVersionSql, CommentVersionError } from "./revision";

async function requireDiscussionMutationAccess(db: D1Database, identifier: string, actor: string) {
  try {
    await requireIssueAccess(db, identifier, actor);
  } catch (error) {
    // A preflight removal and a transaction-fence denial share the same public
    // mutation contract. An active actor outside the workspace remains a 404.
    if (error instanceof IssueAccessError && error.code === "unauthenticated")
      throw new MutationAccessError();
    throw error;
  }
}

export async function findIssue(db: D1Database, identifier: string) {
  return db
    .prepare("SELECT id,identifier FROM issues WHERE identifier=?")
    .bind(identifier)
    .first<{ id: string; identifier: string }>();
}
export async function discussion(db: D1Database, issueId: string, actor?: string) {
  return discussionProjection(await Promise.all(discussionReadStatements(db, issueId, actor).map(statement => statement.all())));
}

export function discussionReadStatements(db: D1Database, issueId: string, actor?: string) {
  return [
    db
      .prepare(
        `SELECT c.id,c.parent_comment_id AS parentId,c.body,${commentVersionSql} AS version,c.edited_at AS editedAt,c.deleted_at AS deletedAt,c.created_at AS createdAt,COALESCE((SELECT a.actor_name FROM issue_activity a WHERE a.issue_id=c.issue_id AND json_extract(a.next_value_json,'$.id')=c.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1),c.imported_author_name,o.name) AS actor,c.imported_author_name IS NOT NULL AS imported,
 c.resolved_at AS resolvedAt,r.name AS resolvedBy,COALESCE(c.document_anchor,c.description_anchor) AS anchor,
 (c.actor_operator_id=? AND o.role<>'viewer' AND c.imported_author_name IS NULL AND c.deleted_at IS NULL) AS canEdit,
 (c.deleted_at IS NULL AND ((c.actor_operator_id=? AND o.role<>'viewer' AND c.imported_author_name IS NULL) OR ${moderatorSql})) AS canDelete
 FROM issue_comments c JOIN operators o ON o.id=c.actor_operator_id LEFT JOIN operators r ON r.id=c.resolved_by_operator_id
 WHERE c.issue_id=? ORDER BY c.created_at,c.id`,
      )
      .bind(actor ?? null, actor ?? null, actor ?? null, issueId),
    db
      .prepare(
        "SELECT id,name,content_type AS contentType,bytes,state,removal_requested_at AS removalPending,cleanup_error AS cleanupError,created_at AS createdAt FROM issue_files WHERE issue_id=? AND (deleted_at IS NULL OR (removal_requested_at IS NOT NULL AND removal_confirmed_at IS NULL)) ORDER BY created_at,id",
      )
      .bind(issueId),
    namedLinksStatement(db, issueId),
  ] as const;
}

export function discussionProjection([comments, files, links]: readonly D1Result[]) {
  return {
    comments: (comments.results as Record<string, unknown>[]).map((row): Record<string, unknown> => ({ ...row, anchor: typeof row.anchor === "string" ? JSON.parse(row.anchor) : null })),
    files: files.results as Record<string, unknown>[],
    links: links.results as NamedLink[],
  };
}
function activity(
  db: D1Database,
  actor: string,
  kind: string,
  issueId: string,
  id: string,
  now: string,
  activityId = createUlid(new Date(now)),
) {
  return db
    .prepare(
      "INSERT INTO issue_activity(id,issue_id,actor_operator_id,kind,previous_value_json,next_value_json,created_at,updated_at,actor_name,agent_id,agent_operation_id,agent_approvers_json) VALUES(?,?,?,?,NULL,?,?,?,?,?,?,?)",
    )
    .bind(
      activityId,
      issueId,
      actor,
      kind,
      JSON.stringify({ id }),
      now,
      now,
      currentAgentActor()?.actor.label ?? null,
      agentActivity().agentId,
      agentActivity().agentOperationId,
      agentActivity().agentApproversJson,
    );
}
export async function addComment(
  db: D1Database,
  issueId: string,
  actor: string,
  body: string,
  parentId?: string,
  onCommit?: (db: D1Database, commentId: string) => D1PreparedStatement[],
  anchorInput?: ThreadAnchorInput,
) {
  db = mutationDatabase(db, actor);
  const id = createUlid(new Date()),
    now = new Date().toISOString();
  const activityId = createUlid(new Date());
  const event = { id: activityId, issueId, actor, at: now };
  const issue = await db.prepare('SELECT identifier FROM issues WHERE id=?').bind(issueId).first<{identifier:string}>();
  if (!issue) throw new Error('Issue is unavailable.');
  await requireDiscussionMutationAccess(db,issue.identifier,actor);
  const documentInput = anchorInput && 'documentId' in anchorInput ? anchorInput : null;
  const anchor = anchorInput ? validDescriptionAnchor(documentInput
    ? { ...documentInput, expectedDescription: documentInput.expectedBody }
    : anchorInput as import('./anchors').DescriptionAnchorInput) : null;
  if (anchorInput && (!anchor || parentId)) throw new DescriptionAnchorError(400, "Select current source text to start a thread.");
  if (documentInput && anchor) anchor.documentId = documentInput.documentId;
  const checkSource = async () => {
    if (documentInput) {
      const current = await db.prepare("SELECT body,version FROM documents WHERE id=? AND parent_kind='issue' AND parent_id=?")
        .bind(documentInput.documentId,issueId).first<{body:string;version:number}>();
      if (!current) throw new DescriptionAnchorError(400, "The document must belong to this issue.", 'document');
      if (current.body !== documentInput.expectedBody || current.version !== documentInput.expectedVersion)
        throw new DescriptionAnchorError(409, "The document changed. Select its current text again.", 'document');
    } else if (anchorInput && 'expectedDescription' in anchorInput) {
      const current = await db.prepare('SELECT description FROM issues WHERE id=?').bind(issueId).first<{description:string}>();
      if (current?.description !== anchorInput.expectedDescription) throw new DescriptionAnchorError(409, "The description changed. Select its current text again.");
    }
  };
  await checkSource();
  const thread = parentId ? await threadRoot(db, issueId, parentId) : null;
  try {
  await db.batch([
    ...(documentInput ? [db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM documents WHERE id=? AND parent_kind='issue' AND parent_id=? AND version=? AND body=?) THEN 1 ELSE json('document anchor changed') END")
      .bind(documentInput.documentId,issueId,documentInput.expectedVersion,documentInput.expectedBody)]
      : anchorInput && 'expectedDescription' in anchorInput ? [db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM issues WHERE id=? AND description=?) THEN 1 ELSE json('description anchor changed') END").bind(issueId, anchorInput.expectedDescription)] : []),
    db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM issues i JOIN teams t ON t.id=i.team_id JOIN operators o ON o.workspace_id=t.workspace_id WHERE i.id=? AND o.id=? AND o.removed_at IS NULL) THEN 1 ELSE json('discussion access denied') END`).bind(issueId,actor),
    // A new reply reopens a resolved thread, recorded before the reply itself.
    ...(thread ? reopenStatements(db, issueId, thread, actor, now) : []),
    db
      .prepare(
        "INSERT INTO issue_comments(id,issue_id,actor_operator_id,body,parent_comment_id,created_at,updated_at,description_anchor,document_anchor) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .bind(id, issueId, actor, body, thread, now, now, anchor && !documentInput ? JSON.stringify(anchor) : null, documentInput ? JSON.stringify(anchor) : null),
    activity(db, actor, "comment.created", issueId, id, now, activityId),
    ...commentStatements(db,event), ...mentionStatements(db,event,body,id), ...issueReferenceStatements(db,event,body,{kind:"comment",id}), ...finalizeEvent(db,event),
    ...(onCommit?.(db,id) ?? []),
  ]);
  } catch (error) {
    if (!anchorInput || isMutationAccessError(error) || error instanceof RestoreReservationError) throw error;
    await requireDiscussionMutationAccess(db, issue.identifier, actor);
    await checkSource();
    throw error;
  }
  return id;
}
export async function changeComment(
  db: D1Database,
  issue: { id: string; identifier: string },
  id: string,
  actor: string,
  body: string | null,
  expectedVersion?: number,
) {
  db = mutationDatabase(db, actor);
  await requireDiscussionMutationAccess(db,issue.identifier,actor);
  const now = new Date().toISOString();
  const activityId = createUlid(new Date());
  const event = { id: activityId, issueId: issue.id, actor, at: now };
  const row = await liveComment(db, issue.id, id, actor);
  if (!row) return false;
  requireCommentChange(row, body === null ? "delete" : "edit");
  const mutation =
    body === null
      ? db
          .prepare(
            "UPDATE issue_comments SET body=NULL,deleted_at=?,updated_at=? WHERE id=? AND issue_id=? AND deleted_at IS NULL RETURNING id",
          )
          .bind(now, now, id, issue.id)
      : db
          .prepare(
            "UPDATE issue_comments SET body=?,edited_at=?,updated_at=? WHERE id=? AND issue_id=? AND deleted_at IS NULL RETURNING id",
          )
          .bind(body, now, now, id, issue.id);
  const statements = [
    // Abort the entire batch before activity, audit, links, mentions or mail
    // intent can change. This read and the mutation share one D1 transaction.
    ...(expectedVersion === undefined ? [] : [db.prepare(`SELECT CASE WHEN EXISTS(
      SELECT 1 FROM issue_comments c WHERE c.id=? AND c.issue_id=? AND c.deleted_at IS NULL
      AND ${commentVersionSql}=?) THEN 1 ELSE json('comment revision mismatch') END`)
      .bind(id, issue.id, expectedVersion)]),
    db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM issues i JOIN teams t ON t.id=i.team_id JOIN operators o ON o.workspace_id=t.workspace_id WHERE i.id=? AND o.id=? AND o.removed_at IS NULL) THEN 1 ELSE json('discussion access denied') END`).bind(issue.id,actor),
    db
      .prepare(
        `INSERT INTO issue_activity(id,issue_id,actor_operator_id,kind,next_value_json,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM issue_comments WHERE id=? AND issue_id=? AND deleted_at IS NULL)`,
      )
      .bind(
        activityId,
        issue.id,
        actor,
        body === null ? "comment.deleted" : "comment.edited",
        JSON.stringify({ id }),
        now,
        now,
        id,
        issue.id,
      ),
    db
      .prepare(
        `INSERT INTO audit_records(id,actor_operator_id,action,subject_identifier,subject_id,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM issue_comments WHERE id=? AND issue_id=? AND deleted_at IS NULL)`,
      )
      .bind(
        createUlid(new Date()),
        actor,
        body === null ? "comment.deleted" : "comment.edited",
        issue.identifier,
        id,
        now,
        now,
        id,
        issue.id,
      ),
    ...(body === null
      ? commentLinkErasureStatements(db, issue, id, actor, now)
      : []),
    ...mentionStatements(db,event,body,id),
  ];
  const mutationIndex = statements.length;
  let receipts: D1Result<{ id: string }>[];
  try {
    receipts = await db.batch<{ id: string }>([
      ...statements, mutation, ...issueReferenceStatements(db,event,body,{kind:"comment",id}), ...finalizeEvent(db,event),
    ]);
  } catch (error) {
    // Preserve authority/storage failures. A failed revision guard rolls back
    // every statement; re-read only to distinguish stale from deleted state.
    if (expectedVersion === undefined || isMutationAccessError(error) || error instanceof RestoreReservationError) throw error;
    await requireDiscussionMutationAccess(db, issue.identifier, actor);
    const current = await db.prepare(`SELECT ${commentVersionSql} AS version
      FROM issue_comments c WHERE c.id=? AND c.issue_id=? AND c.deleted_at IS NULL`)
      .bind(id, issue.id).first<{ version: number }>();
    if (!current) return false;
    if (current.version !== expectedVersion) throw new CommentVersionError();
    throw error;
  }
  // Index triggers add writes to D1 meta.changes; only RETURNING identifies
  // whether this live comment survived the transaction guard.
  const rows = receipts[mutationIndex].results;
  return rows.length === 1 && rows[0].id === id;
}
export async function addFile(
  db: D1Database,
  issue: { id: string; identifier: string },
  actor: string,
  file: {
    id: string;
    name: string;
    contentType: string;
    bytes: number;
    key: string;
    sha256: string;
  },
) {
  db = mutationDatabase(db, actor);
  await requireDiscussionMutationAccess(db, issue.identifier, actor);
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO issue_files(id,issue_id,actor_operator_id,name,content_type,bytes,blob_key,state,writer_settled,content_sha256,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,'pending',0,?,?,? WHERE EXISTS(SELECT 1 FROM issues i JOIN teams t ON t.id=i.team_id JOIN operators o ON o.workspace_id=t.workspace_id WHERE i.id=? AND o.id=? AND o.removed_at IS NULL) AND COALESCE((SELECT SUM(bytes) FROM issue_files WHERE removal_confirmed_at IS NULL),0)+COALESCE((SELECT SUM(bytes) FROM detached_file_removals WHERE removal_confirmed_at IS NULL),0)+?<=10737418240`,
    )
    .bind(
      file.id,
      issue.id,
      actor,
      file.name,
      file.contentType,
      file.bytes,
      file.key,
      file.sha256,
      now,
      now,
      issue.id,
      actor,
      file.bytes,
    )
    .run();
  if (result.meta.changes !== 1)
    await requireDiscussionMutationAccess(db, issue.identifier, actor);
  return result.meta.changes === 1;
}
export async function finalizeFile(
  db: D1Database,
  issueId: string,
  id: string,
  actor: string,
) {
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO issue_activity(id,issue_id,actor_operator_id,kind,next_value_json,created_at,updated_at) SELECT ?,?,?,'file.created',?,?,? WHERE EXISTS(SELECT 1 FROM issue_files WHERE id=? AND state='pending' AND deleted_at IS NULL AND removal_requested_at IS NULL)`,
      )
      .bind(
        createUlid(new Date()),
        issueId,
        actor,
        JSON.stringify({ id }),
        now,
        now,
        id,
      ),
    db
      .prepare(
        "UPDATE issue_files SET state='ready',writer_settled=1,updated_at=? WHERE id=? AND state='pending' AND deleted_at IS NULL AND removal_requested_at IS NULL",
      )
      .bind(now, id),
    db.prepare("UPDATE issue_files SET writer_settled=1 WHERE id=?").bind(id),
    db.prepare("UPDATE detached_file_removals SET writer_settled=1 WHERE id=? AND issue_id=?").bind(id, issueId),
  ]);
  return result[1].meta.changes === 1;
}
export async function failFile(
  db: D1Database,
  id: string,
  writerSettled = false,
) {
  await db.batch([db
    .prepare(
      "UPDATE issue_files SET state='failed',writer_settled=?,updated_at=? WHERE id=? AND state='pending' AND deleted_at IS NULL",
    )
    .bind(writerSettled ? 1 : 0, new Date().toISOString(), id),
    db.prepare("UPDATE detached_file_removals SET writer_settled=MAX(writer_settled,?),updated_at=? WHERE id=? AND removal_confirmed_at IS NULL").bind(writerSettled ? 1 : 0, new Date().toISOString(), id),
  ]);
}
export async function findFile(db: D1Database, issueId: string, id: string) {
  return db
    .prepare(
      "SELECT id,name,content_type,bytes,blob_key,state,deleted_at,removal_requested_at FROM issue_files WHERE id=? AND issue_id=? AND (deleted_at IS NULL OR (removal_requested_at IS NOT NULL AND removal_confirmed_at IS NULL))",
    )
    .bind(id, issueId)
    .first<{
      id: string;
      name: string;
      content_type: string;
      bytes: number;
      blob_key: string;
      state: string;
      deleted_at: string | null;
      removal_requested_at: string | null;
    }>();
}
