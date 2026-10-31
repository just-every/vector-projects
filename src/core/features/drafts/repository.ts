import { visibleTeam } from '../roles/visibility-sql';
import type { AccountDraft, DraftReference } from './schema';
import type { NewIssueDraft } from '../issues/ui/new-issue-draft';

const select = `SELECT d.id,d.revision,d.body_json,d.updated_at,t.name team FROM issue_drafts d
  JOIN operators o ON o.id=d.author_operator_id AND o.workspace_id=d.workspace_id AND o.removed_at IS NULL
  JOIN teams t ON t.id=d.team_id AND t.workspace_id=o.workspace_id
  WHERE o.id=? AND d.state='open' AND ${visibleTeam('o', 't.id')}`;
type Row = { id: string; revision: number; body_json: string; updated_at: string; team: string };
const project = (row: Row): AccountDraft => ({ id: row.id, revision: row.revision,
  values: JSON.parse(row.body_json), team: row.team, updatedAt: row.updated_at });
export async function listDrafts(db: D1Database, actor: string) {
  return (await db.prepare(select + ' ORDER BY d.updated_at DESC,d.id DESC').bind(actor).all<Row>()).results.map(project);
}
export async function readDraft(db: D1Database, actor: string, id: string) {
  const row = await db.prepare(select + ' AND d.id=?').bind(actor, id).first<Row>();
  return row ? project(row) : null;
}
export async function saveDraft(db: D1Database, actor: string, values: NewIssueDraft, reference: DraftReference) {
  const id = reference.id, at = new Date().toISOString();
  if (reference.revision > 0) {
    const result = await db.prepare(`UPDATE issue_drafts SET body_json=?,team_id=?,revision=revision+1,updated_at=?
      WHERE id=? AND author_operator_id=? AND revision=? AND state='open'
      AND workspace_id=(SELECT workspace_id FROM operators WHERE id=?)
      AND EXISTS(SELECT 1 FROM teams WHERE id=? AND workspace_id=issue_drafts.workspace_id AND archived_at IS NULL) RETURNING id`)
      .bind(JSON.stringify(values), values.teamId, at, id, actor, reference.revision, actor, values.teamId).all();
    return { written: result.results.length === 1, draft: await readDraft(db, actor, id) };
  }
  const created = await db.prepare(`INSERT INTO issue_drafts(id,workspace_id,author_operator_id,team_id,body_json,created_at,updated_at)
    SELECT ?,o.workspace_id,o.id,t.id,?,?,? FROM operators o JOIN teams t ON t.workspace_id=o.workspace_id
    WHERE o.id=? AND o.removed_at IS NULL AND t.id=? AND t.archived_at IS NULL
    ON CONFLICT(id) DO NOTHING RETURNING id`)
    .bind(id, JSON.stringify(values), at, at, actor, values.teamId).all();
  const exists = Boolean(await db.prepare('SELECT 1 FROM issue_drafts WHERE id=?').bind(id).first());
  return { written: created.results.length === 1, exists, draft: await readDraft(db, actor, id) };
}
export async function discardDraft(db: D1Database, actor: string, reference: DraftReference) {
  const result = await db.prepare(`UPDATE issue_drafts SET state='discarded',body_json=NULL,revision=revision+1,updated_at=?
    WHERE id=? AND author_operator_id=? AND state='open' AND revision=?
    AND workspace_id=(SELECT workspace_id FROM operators WHERE id=?) RETURNING id`)
    .bind(new Date().toISOString(), reference.id, actor, reference.revision, actor).all();
  return { written: result.results.length === 1, draft: await readDraft(db, actor, reference.id) };
}
/** Both statements are in the native issue creation batch. An obsolete device
 * aborts the entire batch; a failed issue write leaves the draft open. */
export function consumeDraftStatements(db: D1Database, actor: string, team: string, reference: DraftReference) {
  const where = `id=? AND author_operator_id=? AND revision=? AND state='open' AND team_id=?
    AND workspace_id=(SELECT workspace_id FROM operators WHERE id=?)`;
  const values = [reference.id, actor, reference.revision, team, actor];
  return [db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM issue_drafts WHERE ${where}) THEN 1 ELSE json('draft consumed or changed') END`).bind(...values),
    db.prepare(`UPDATE issue_drafts SET state='submitted',body_json=NULL,revision=revision+1,updated_at=? WHERE ${where}`)
      .bind(new Date().toISOString(), ...values)];
}
