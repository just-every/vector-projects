import type { Hono } from 'hono';
import type { AppEnvironment } from '../../app/bindings';
import { readRequestJson } from '../../app/input';
import { integrationOwner } from '../integrations/authority';
import { IntegrationError } from '../integrations/errors';
import { changeSchedule, createSchedule, scheduleId } from './schedule-schema';
import { createScheduledExport, listSchedules, setScheduleEnabled, revokeSchedule } from './schedules';

export function addExportSettings(app:Hono<AppEnvironment>) {
  const parse=<T>(value:{safeParse(input:unknown):{success:true;data:T}|{success:false}},input:unknown)=>{
    const result=value.safeParse(input);if(!result.success)throw new IntegrationError(400,'invalid_export_configuration');return result.data;
  };
  app.get('/settings/report-exports',async c=>c.json(await listSchedules(c.env,await integrationOwner(c.env,c.req.raw,c.get('documentProjection')?c.get('operator'):undefined))));
  app.post('/settings/report-exports',async c=>c.json(await createScheduledExport(c.env,await integrationOwner(c.env,c.req.raw),parse(createSchedule,await readRequestJson(c.req.raw))),201));
  app.patch('/settings/report-exports/:id',async c=>c.json(await setScheduleEnabled(c.env,await integrationOwner(c.env,c.req.raw),parse(scheduleId,c.req.param('id')),parse(changeSchedule,await readRequestJson(c.req.raw)))));
  app.delete('/settings/report-exports/:id',async c=>c.json(await revokeSchedule(c.env,await integrationOwner(c.env,c.req.raw),parse(scheduleId,c.req.param('id')))));
}
