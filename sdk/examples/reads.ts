// These are example projections checked at runtime, not additional schema types.
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid API object');
  return value as Record<string, unknown>;
}

export function issueIdentity(value: unknown) {
  const row = record(value);
  if (typeof row.id !== 'string' || typeof row.identifier !== 'string' || typeof row.title !== 'string') {
    throw new Error('API response is missing its issue identity or title');
  }
  return {id:row.id, identifier:row.identifier, title:row.title};
}

export function issueSnapshot(value: unknown) {
  const row = record(value), identity = issueIdentity(row);
  if (!Number.isSafeInteger(row.version) || Number(row.version) < 0) throw new Error('Invalid issue version');
  return {...identity, version:Number(row.version)};
}

/** Collect before returning: an invalidated or refused page yields no snapshot. */
export async function pages<T extends {id:string}>(
  read: (cursor?: string) => Promise<unknown>, field: string, parse: (value:unknown) => T,
) {
  const items: T[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined, total: number | undefined;
  for (let count = 0; count < 1000; count++) {
    const page = record(await read(cursor)), rows = page[field];
    if (!Array.isArray(rows) || !Number.isSafeInteger(page.total) || Number(page.total) < 0 ||
        (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor))) {
      throw new Error('Invalid paginated API response');
    }
    if (total !== undefined && page.total !== total) throw new Error('Snapshot changed; restart the read');
    total = Number(page.total);
    for (const value of rows) {
      const item = parse(value);
      if (ids.has(item.id)) throw new Error('Duplicate API identity; restart the read');
      ids.add(item.id); items.push(item);
    }
    if (page.nextCursor === null) {
      if (items.length !== total) throw new Error('Incomplete API snapshot');
      return items;
    }
    if (!rows.length || cursors.has(page.nextCursor as string)) throw new Error('Pagination made no progress');
    cursor = page.nextCursor as string; cursors.add(cursor);
  }
  throw new Error('Example page budget exhausted; narrow the filter');
}
