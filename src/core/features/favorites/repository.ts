import { browseActor } from "../issues/browse-access";
import { visibilityDatabase } from "../roles/visibility-database";
import type {
  FavoriteSelection,
  FavoriteSubject,
  FavoriteWrite,
  Favorites,
} from "./schema";

export class FavoriteError extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
// Each branch reads the same admission CTEs as its native subject door. Never
// persist a title or fall back to a previously captured title on withdrawal.
const subjects = `SELECT 'issue' AS kind,i.id AS subjectId,i.title,'/app/issues/'||i.identifier AS href
  FROM issues i JOIN teams t ON t.id=i.team_id JOIN operators actor ON actor.workspace_id=t.workspace_id AND actor.id=? AND actor.removed_at IS NULL
  UNION ALL SELECT 'project',p.id,p.name,'/app/projects/'||p.id
  FROM projects p JOIN operators actor ON actor.workspace_id=p.workspace_id AND actor.id=? AND actor.removed_at IS NULL
  UNION ALL SELECT 'view',v.id,v.name,'/app/views/'||v.id
  FROM saved_views v JOIN operators actor ON actor.workspace_id=v.workspace_id AND actor.id=? AND actor.removed_at IS NULL
  WHERE v.owner_operator_id=actor.id OR v.is_shared=1`;

export async function favoriteSubject(
  source: D1Database,
  actor: string,
  kind: string,
  key: string,
): Promise<FavoriteSubject> {
  const db = visibilityDatabase(source, actor);
  await browseActor(db, actor);
  const row = await db
    .prepare(
      `SELECT * FROM (${subjects}) WHERE kind=? AND
    (subjectId=? OR (kind='issue' AND href='/app/issues/'||?))`,
    )
    .bind(actor, actor, actor, kind, key, key)
    .first<FavoriteSubject>();
  if (!row)
    throw new FavoriteError(404, "not_found", "This favorite is unavailable.");
  return row;
}
export async function readFavorites(
  source: D1Database,
  actor: string,
  current?: FavoriteSelection,
): Promise<Favorites> {
  const db = visibilityDatabase(source, actor);
  await browseActor(db, actor);
  // One SQL snapshot resolves identities and visibility before returning any
  // title, including after a project loses its last visible team contribution.
  const row = await db
    .prepare(
      `WITH favorite_subjects AS (${subjects})
    SELECT COALESCE(f.version,0) AS version,
    COALESCE(f.folders_json,'[]') AS folders,
    COALESCE((SELECT json_group_array(json(item)) FROM (
      SELECT json_object('kind',s.kind,'subjectId',s.subjectId,'title',s.title,'href',s.href,
        'folderId',json_extract(e.value,'$.folderId')) AS item
      FROM json_each(f.entries_json) e JOIN favorite_subjects s
        ON s.kind=json_extract(e.value,'$.kind') AND s.subjectId=json_extract(e.value,'$.subjectId')
      ORDER BY CAST(e.key AS INTEGER))), '[]') AS entries,
    (SELECT json_object('kind',kind,'subjectId',subjectId,'title',title,'href',href)
      FROM favorite_subjects WHERE kind=? AND
        (subjectId=? OR (kind='issue' AND href='/app/issues/'||?))) AS current
    FROM operators actor LEFT JOIN member_favorites f ON f.operator_id=actor.id AND f.workspace_id=actor.workspace_id
    WHERE actor.id=? AND actor.removed_at IS NULL`,
    )
    .bind(
      actor,
      actor,
      actor,
      current?.kind ?? null,
      current?.key ?? null,
      current?.key ?? null,
      actor,
    )
    .first<{
      version: number;
      folders: string;
      entries: string;
      current: string | null;
    }>();
  if (!row)
    throw new FavoriteError(404, "not_found", "Favorites are unavailable.");
  return {
    version: row.version,
    folders: JSON.parse(row.folders),
    entries: JSON.parse(row.entries),
    ...(current
      ? { current: row.current ? JSON.parse(row.current) : null }
      : {}),
  };
}
export async function writeFavorites(
  source: D1Database,
  actor: string,
  input: FavoriteWrite,
  current?: FavoriteSelection,
): Promise<Favorites> {
  const db = visibilityDatabase(source, actor);
  const access = await browseActor(db, actor);
  const encoded = JSON.stringify(input.entries);
  // The native mutation wrapper fences session and current role. Both version
  // admission and subject admission live in the write statement, so concurrent
  // or replayed writes cannot overwrite a newer collection.
  const result = await db
    .prepare(
      `INSERT INTO member_favorites(operator_id,workspace_id,version,folders_json,entries_json)
    SELECT ?,?,1,?,? WHERE
      COALESCE((SELECT version FROM member_favorites WHERE operator_id=? AND workspace_id=?),0)=?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(
        SELECT 1 FROM (${subjects}) s WHERE s.kind=json_extract(e.value,'$.kind') AND s.subjectId=json_extract(e.value,'$.subjectId')))
    ON CONFLICT(operator_id) DO UPDATE SET version=member_favorites.version+1,
      folders_json=excluded.folders_json,entries_json=excluded.entries_json
      WHERE member_favorites.workspace_id=excluded.workspace_id AND member_favorites.version=?
    RETURNING version`,
    )
    .bind(
      actor,
      access.workspace_id,
      JSON.stringify(input.folders),
      encoded,
      actor,
      access.workspace_id,
      input.expectedVersion,
      encoded,
      actor,
      actor,
      actor,
      input.expectedVersion,
    )
    .all<{ version: number }>();
  if (!result.results.length) {
    const current = await readFavorites(db, actor);
    if (current.version !== input.expectedVersion)
      throw new FavoriteError(
        409,
        "stale_favorites",
        "Favorites changed in another browser. Reload and try again.",
      );
    throw new FavoriteError(
      404,
      "not_found",
      "A favorite is no longer available.",
    );
  }
  return readFavorites(db, actor, current);
}
