import { visibleTeam } from '../roles/visibility-sql';
import type { DraftReference } from './schema';
import type { DescriptionAnchorInput } from '../discussion/anchors';
import type { CommentDraft } from './comment-schema';

const select = `SELECT d.id,d.revision,d.body,i.identifier,d.parent_comment_id parentId,d.anchor_json anchor,t.name team,d.updated_at updatedAt
 FROM comment_drafts d JOIN operators o ON o.id=d.author_operator_id AND o.workspace_id=d.workspace_id AND o.removed_at IS NULL
 JOIN issues i ON i.id=d.issue_id JOIN teams t ON t.id=i.team_id AND t.workspace_id=o.workspace_id
 WHERE o.id=? AND d.state='open' AND ${visibleTeam('o','t.id')}`;
type Row = Omit<CommentDraft,'anchor'> & { anchor: string | null };
const project = (row: Row): CommentDraft => ({ ...row, anchor: row.anchor === null ? null : JSON.parse(row.anchor) });
export async function listCommentDrafts(db: D1Database, actor: string) {
  return (await db.prepare(select + ' ORDER BY d.updated_at DESC,d.id DESC').bind(actor).all<Row>()).results.map(project);
}
export async function readCommentDraft(db: D1Database, actor: string, id: string) {
  const row = await db.prepare(select + ' AND d.id=?').bind(actor,id).first<Row>();
  return row ? project(row) : null;
}
/** A quoted description draft keeps its anchor; ordinary comments and replies never gain one. */
export async function saveCommentDraft(db: D1Database, actor: string, reference: DraftReference, body: string,
  anchor?: DescriptionAnchorInput, target?: { issueId: string; parentId?: string }) {
  const at = new Date().toISOString(), quote = anchor ? JSON.stringify(anchor) : null;
  const result = target ? await db.prepare(`INSERT INTO comment_drafts(id,workspace_id,author_operator_id,issue_id,parent_comment_id,anchor_json,body,created_at,updated_at)
    SELECT ?,t.workspace_id,o.id,i.id,?,?,?,?,? FROM issues i JOIN teams t ON t.id=i.team_id
    JOIN operators o ON o.workspace_id=t.workspace_id WHERE i.id=? AND o.id=? AND o.removed_at IS NULL
    ON CONFLICT DO NOTHING RETURNING id`)
    .bind(reference.id,target.parentId ?? null,quote,body,at,at,target.issueId,actor).all()
    : await db.prepare(`UPDATE comment_drafts SET body=?,anchor_json=CASE WHEN anchor_json IS NULL THEN NULL ELSE coalesce(?,anchor_json) END,
      revision=revision+1,updated_at=?
      WHERE id=? AND author_operator_id=? AND revision=? AND state='open'
      AND workspace_id=(SELECT workspace_id FROM operators WHERE id=?) RETURNING id`)
      .bind(body,quote,at,reference.id,actor,reference.revision,actor).all();
  // Another browser may have created the same composer first. Never replace it.
  let draft = await readCommentDraft(db,actor,reference.id);
  if (!draft && target) {
    const row = await db.prepare(select + ' AND d.issue_id=? AND d.parent_comment_id IS ? AND (d.anchor_json IS NOT NULL)=?')
      .bind(actor,target.issueId,target.parentId ?? null,quote === null ? 0 : 1).first<Row>();
    draft = row ? project(row) : null;
  }
  return { written: result.results.length === 1, draft };
}
export async function discardCommentDraft(db: D1Database, actor: string, reference: DraftReference) {
  const result = await db.prepare(`UPDATE comment_drafts SET state='discarded',body=NULL,anchor_json=NULL,revision=revision+1,updated_at=?
    WHERE id=? AND author_operator_id=? AND revision=? AND state='open'
    AND workspace_id=(SELECT workspace_id FROM operators WHERE id=?) RETURNING id`)
    .bind(new Date().toISOString(),reference.id,actor,reference.revision,actor).all();
  return { written: result.results.length === 1, draft: await readCommentDraft(db,actor,reference.id) };
}
export function consumeCommentDraftStatements(db: D1Database, actor: string, issue: string, parent: string | undefined,
  body: string, anchor: string | null, reference: DraftReference) {
  const where = `id=? AND author_operator_id=? AND revision=? AND state='open' AND issue_id=?
    AND parent_comment_id IS ? AND body=? AND anchor_json IS ? AND workspace_id=(SELECT workspace_id FROM operators WHERE id=?)`;
  const values = [reference.id,actor,reference.revision,issue,parent ?? null,body,anchor,actor];
  return [db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM comment_drafts WHERE ${where}) THEN 1 ELSE json('comment draft changed') END`).bind(...values),
    db.prepare(`UPDATE comment_drafts SET state='submitted',body=NULL,anchor_json=NULL,revision=revision+1,updated_at=? WHERE ${where}`)
      .bind(new Date().toISOString(),...values)];
}
