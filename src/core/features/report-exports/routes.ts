import type { Hono } from 'hono';
import type { AppEnvironment } from '../../app/bindings';
import { readExport } from './read';
import { exportQuery, exportResources } from './schema';

/** REPORT-005's dedicated read adapter shares token and current role admission
 * with the public API, without admitting bearer access to archives or files. */
export function addReportExportApi(app: Hono<AppEnvironment>) {
  for (const resource of exportResources) {
    app.get('/report-exports/' + resource, async c => c.json(await readExport(
      c.env.DB, c.get('operatorId'), resource, exportQuery.parse(c.req.query()), c.env.SESSION_SECRET,
    )));
  }
}
