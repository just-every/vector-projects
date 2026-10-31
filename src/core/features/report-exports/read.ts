import { IntegrationError } from '../integrations/errors';
import { PaginationInvalidated } from '../issues/list-revision';
import { publicActivityValue } from '../issue-undo/public-activity';
import { exportCursor, exportScope, readExportCursor } from './cursor';
import type { ExportQuery, ExportResource } from './schema';

/** Receives the API's visibility-scoped database. Every source below is scoped
 * before joining, counting or paging; no portable archive authority is used. */
const projections: Record<ExportResource, string> = {
  issues: `SELECT i.id,i.identifier,i.team_id AS teamId,i.title,i.description,
    s.id AS statusId,s.name AS status,s.category AS statusCategory,i.priority,
    i.assignee_operator_id AS assigneeOperatorId,p.id AS projectId,c.id AS cycleId,
    i.start_date AS startDate,i.due_date AS dueDate,i.estimate,i.version,
    i.completed_at AS completedAt,i.canceled_at AS canceledAt,i.archived_at AS archivedAt,
    i.created_at AS createdAt,i.updated_at AS updatedAt
    FROM issues i JOIN workflow_statuses s ON s.id=i.status_id
    LEFT JOIN projects p ON p.id=i.project_id LEFT JOIN cycles c ON c.id=i.cycle_id
    WHERE (? IS NULL OR i.team_id=?)`,
  history: `SELECT a.id,a.issue_id AS issueId,i.identifier AS issueIdentifier,i.team_id AS teamId,
    a.kind,a.actor_operator_id AS actorId,COALESCE(a.actor_name,o.name,'Unknown operator') AS actor,
    a.previous_value_json AS previousValue,a.next_value_json AS nextValue,
    a.created_at AS createdAt,a.updated_at AS updatedAt
    FROM issue_activity a JOIN issues i ON i.id=a.issue_id LEFT JOIN operators o ON o.id=a.actor_operator_id
    WHERE (? IS NULL OR i.team_id=?)`,
  cycles: `SELECT id,team_id AS teamId,name,starts_at AS startsAt,ends_at AS endsAt,capacity,
    closed_at AS closedAt,created_at AS createdAt,updated_at AS updatedAt FROM cycles
    WHERE (? IS NULL OR team_id=?)`,
  projects: `SELECT p.id,p.name,p.description,p.lead_operator_id AS leadOperatorId,
    p.start_date AS startDate,p.target_date AS targetDate,p.priority,p.lifecycle,
    p.archived_at AS archivedAt,p.created_at AS createdAt,p.updated_at AS updatedAt
    FROM projects p WHERE (? IS NULL OR EXISTS(SELECT 1 FROM issues i WHERE i.project_id=p.id AND i.team_id=?))`,
};

/** Include membership even for public teams: changing authority must restart
 * an export even when its current visible row count happens to be unchanged. */
async function authority(db: D1Database, actor: string) {
  const [people, teams, memberships] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id,workspace_id,role,updated_at FROM operators WHERE id=? AND removed_at IS NULL').bind(actor),
    db.prepare('SELECT id,is_private,updated_at FROM teams ORDER BY id'),
    db.prepare('SELECT team_id,role,created_at FROM team_members WHERE operator_id=? ORDER BY team_id').bind(actor),
  ]);
  const person = people.results[0];
  if (!person || !['owner', 'admin'].includes(String(person.role))) throw new IntegrationError(403, 'forbidden');
  return exportScope([person, teams.results, memberships.results]);
}

export async function readExport(db: D1Database, actor: string, resource: ExportResource, query: ExportQuery, secret: string | undefined) {
  const admission = await authority(db, actor);
  const scope = await exportScope([actor, resource, query.team ?? null, query.limit, admission]);
  const after = await readExportCursor(query.cursor, scope, secret);
  const cte = `WITH export_rows AS (${projections[resource]}) `;
  // Both statements share the scoped batch snapshot. Memory and response size
  // are bounded by the page, rather than loading the entire warehouse first.
  const [count, page] = await db.batch<Record<string, unknown>>([
    db.prepare(cte + 'SELECT count(*) AS total FROM export_rows').bind(query.team ?? null, query.team ?? null),
    db.prepare(cte + 'SELECT * FROM export_rows WHERE id>? ORDER BY id LIMIT ?')
      .bind(query.team ?? null, query.team ?? null, after, query.limit + 1),
  ]);
  if (await authority(db, actor) !== admission) throw new PaginationInvalidated();
  const rows = page.results.slice(0, query.limit).map(row => resource !== 'history' ? row : {
    ...row,
    previousValue: row.previousValue === null ? null : publicActivityValue(JSON.parse(String(row.previousValue))),
    nextValue: row.nextValue === null ? null : publicActivityValue(JSON.parse(String(row.nextValue))),
  });
  return {
    resource, rows, total: Number(count.results[0].total),
    nextCursor: page.results.length > query.limit ? await exportCursor(String(rows.at(-1)!.id), scope, secret) : null,
  };
}
