import { z } from 'zod';
import { equalSignature, hmac, sha256 } from '../../../../vendor/base/integrations/core/crypto';
import { IntegrationError } from '../integrations/errors';
import { PaginationInvalidated } from '../issues/list-revision';

const payload = z.object({
  after: z.string().min(1).max(512),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

function signingKey(secret: string | undefined) {
  if (!secret || secret.length < 32) throw new IntegrationError(503, 'export_signing_unavailable');
  return new TextEncoder().encode(secret);
}

/** A cursor conveys a position, never authority. Its MAC also prevents editing
 * that position or manufacturing a cursor for another actor or resource. */
export async function readExportCursor(cursor: string | undefined, scope: string, secret: string | undefined) {
  if (!cursor) return '';
  const [body, signature, extra] = cursor.split('.');
  if (!body || !signature || extra !== undefined) throw new IntegrationError(400, 'invalid_cursor');
  const expected = await hmac(signingKey(secret), 'vector-report-export:' + body);
  if (!equalSignature(signature, expected)) throw new IntegrationError(400, 'invalid_cursor');
  let value: z.infer<typeof payload>;
  try { value = payload.parse(JSON.parse(atob(body))); }
  catch { throw new IntegrationError(400, 'invalid_cursor'); }
  if (value.scope !== scope) throw new PaginationInvalidated();
  return value.after;
}

export async function exportCursor(after: string, scope: string, secret: string | undefined) {
  const body = btoa(JSON.stringify({ after, scope }));
  return body + '.' + await hmac(signingKey(secret), 'vector-report-export:' + body);
}
export const exportScope = (value: unknown) => sha256(JSON.stringify(value));
