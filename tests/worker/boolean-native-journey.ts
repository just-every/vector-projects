import { expect, vi } from 'vitest';
import { roleWorkspace, resetLimits, snapshot } from './role-fixture';

/** One populated native-filter journey; each query traverses the mounted list. */
export async function nativeBooleanJourney() {
  // Sign-in reads the newest captured mail, so the workspace is made on the real clock.
  const f = await roleWorkspace(), owner = f.people.owner, marker = 'synthetic-vector-133';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-31T16:00:00.000Z'));
  try {
    const send = async (path: string, method = 'GET', body?: unknown, status = 200) => {
      await resetLimits();
      const response = await owner.call(path, method, body);
      expect(response.status, await response.clone().text()).toBe(status);
      return response.json() as Promise<any>;
    };
    await send('/settings', 'PATCH', { timezone: 'America/New_York', reminderTime: '09:00' });
    const projectState = await send('/settings/projects', 'POST', { name: marker, leadOperatorId: owner.id });
    const project = projectState.projects.find((p: any) => p.name === marker);
    const milestone = (await send(`/settings/projects/${project.id}/milestones`, 'POST', { name: marker })).milestones[0];
    const labelState = await send('/settings/labels', 'POST', { name: marker, color: '#2563eb' });
    const label = labelState.labels.find((l: any) => l.name === marker);
    const cycleState = await send('/settings/cycles', 'POST', { teamId: f.team.id, name: marker, startsLocal: '2026-10-30T00:00', endsLocal: '2026-11-10T00:00' });
    const cycle = cycleState.cycles.find((c: any) => c.name === marker);
    const options = await send('/options');
    const status = options.statuses.find((s: any) => s.teamId === f.team.id && s.category === 'unstarted');
    const create = (suffix: string, extra: Record<string, unknown> = {}) => send('/issues', 'POST', {
      teamId: f.team.id, statusId: status.id, title: marker + suffix, ...extra,
    }, 201);
    const chosen = await create(' chosen "AND"', {
      priority: 'high', assigneeOperatorId: f.member.id, projectId: project.id, milestoneId: milestone.id,
      cycleId: cycle.id, labelIds: [label.id], estimate: 8, startDate: '2026-11-01', dueDate: '2026-11-05',
      description: 'A quoted "OR" and a literal percent % with Unicode café', expectedOutcome: 'Ship safely', customerImpact: 'Keeps work visible',
    });
    const blank = await create(' blank');
    const older = await create(' older', { estimate: 3, dueDate: '2026-11-06' });
    const done = await create(' done', { statusId: options.statuses.find((s: any) => s.teamId === f.team.id && s.category === 'completed').id });
    await send('/issues/' + chosen.identifier + '/parent', 'PATCH', { expectedVersion: chosen.version, parentIdentifier: blank.identifier });
    const read = async (expression: string, who = f.member) => {
      await resetLimits();
      const response = await who.call('/issues?' + new URLSearchParams({ q: marker, expression, pageSize: '100' }));
      expect(response.status, expression + ': ' + await response.clone().text()).toBe(200);
      const data: any = await response.json();
      expect(data.total, expression).toBe(data.issues.length);
      expect(data.statusCounts.reduce((n: number, g: any) => n + g.count, 0)).toBe(data.total);
      return data.issues.map((i: any) => i.identifier).sort();
    };
    const only = [chosen.identifier], open = [chosen, blank, older].map(i => i.identifier).sort();
    for (const expression of [
      `team=${f.team.id} AND assignee=${f.member.id}`, `project=${project.id} AND cycle=${cycle.id}`,
      `label=${label.id} AND milestone=${milestone.id}`, `parent=${blank.identifier}`,
      'estimate>=8 AND NOT estimate=none', 'estimate>3 AND estimate<=8', 'start=tomorrow AND due before next Friday',
      'due>=2026-11-05 AND due<2026-11-06', 'start!=none AND due!=none',
      'title~"chosen \\"AND\\""', 'description~"café" AND outcome~"safely" AND impact~"visible"',
      `identifier=${chosen.identifier}`, 'description~"%"',
      'NOT (assignee=none OR project=none OR cycle=none)',
    ]) expect(await read(expression), expression).toEqual(only);
    expect(await read('description=""')).toEqual([blank.identifier, older.identifier].sort());
    expect(await read('assignee=me', f.member)).toEqual(only);
    expect(await read('assignee=me', owner)).toEqual([]);
    expect(await read('NOT estimate>=8')).toEqual([blank.identifier, older.identifier].sort());
    expect(await read('label=none AND parent=none AND milestone=none')).toEqual([blank.identifier, older.identifier].sort());
    expect(await read(`status=${status.id}`)).toEqual(open);
    expect(await read('category=completed')).toEqual([done.identifier]);
    expect(await read('NOT category=completed')).toEqual(open);
    expect(await read('category=completed OR priority=high')).toEqual([chosen.identifier, done.identifier].sort());
    expect(await read('created=2026-10-31 AND updated in the last 7 days')).toEqual(open);
    const persistedExpression = `(${`project=${project.id}`} OR category=completed) AND due!=none`;
    const view = await send('/views', 'POST', { name: marker, query: { q: marker, expression: persistedExpression } }, 201);
    expect((await send('/views/' + view.id)).query.expression).toBe(persistedExpression);
    expect(await read(view.query.expression)).toEqual(only);
    // These instants straddle local midnight and the autumn DST change.
    const atMidnight = await create(' midnight');
    await import('cloudflare:workers').then(({ env }) => env.DB.prepare('UPDATE issues SET created_at=?,updated_at=? WHERE id=?').bind('2026-11-01T03:59:59.000Z', '2026-11-02T04:59:59.000Z', atMidnight.id).run());
    expect(await read(`identifier=${atMidnight.identifier} AND created=2026-10-31 AND updated=2026-11-01`)).toEqual([atMidnight.identifier]);
    expect(await read(`identifier=${atMidnight.identifier} AND (created=2026-11-01 OR updated=2026-11-02)`)).toEqual([]);
    expect(await read('completed on today')).toEqual([done.identifier]);
    expect(await read('NOT (completed=none OR completed<today)')).toEqual([done.identifier]);
    const canceled = await create(' canceled', { statusId: options.statuses.find((s: any) => s.teamId === f.team.id && s.category === 'canceled').id });
    expect(await read('canceled on today')).toEqual([canceled.identifier]);
    const intake = await send('/intake', 'POST', { teamId: f.team.id, title: marker + ' deferred' }, 201);
    await send('/issues/' + intake.identifier + '/defer', 'POST', { expectedVersion: intake.version, returnAt: '2026-11-01T18:00:00.000Z' });
    expect(await read('deferred=tomorrow')).toEqual([intake.identifier]);
    expect(await read('deferred within "last 7 days"')).toEqual([]);
    const literal = await create(' literal none', { expectedOutcome: 'none' });
    expect(await read('outcome="none"')).toEqual([literal.identifier]);
    expect(await read('outcome=none')).not.toContain(literal.identifier);
    await send('/settings', 'PATCH', { timezone: 'America/Havana', reminderTime: '09:00' });
    const firstMidnight = await create(' repeated midnight first'), secondMidnight = await create(' repeated midnight second');
    const { env } = await import('cloudflare:workers');
    await env.DB.batch([
      env.DB.prepare('UPDATE issues SET created_at=? WHERE id=?').bind('2026-11-01T04:30:00.000Z', firstMidnight.id),
      env.DB.prepare('UPDATE issues SET created_at=? WHERE id=?').bind('2026-11-01T05:30:00.000Z', secondMidnight.id),
    ]);
    expect(await read('created=2026-11-01 AND title~"repeated midnight"')).toEqual([firstMidnight.identifier, secondMidnight.identifier].sort());
    const beforeGap = await create(' midnight gap before'), afterGap = await create(' midnight gap after');
    await env.DB.batch([
      env.DB.prepare('UPDATE issues SET created_at=? WHERE id=?').bind('2026-03-08T04:59:59.000Z', beforeGap.id),
      env.DB.prepare('UPDATE issues SET created_at=? WHERE id=?').bind('2026-03-08T05:00:00.000Z', afterGap.id),
    ]);
    expect(await read('created=2026-03-08 AND title~"midnight gap"')).toEqual([afterGap.identifier]);
    expect(await read('created<2026-03-08 AND title~"midnight gap"')).toEqual([beforeGap.identifier]);
    const before = await snapshot(['issues', 'issue_activity', 'saved_views', 'list_preferences']);
    for (const invalid of ['estimate>none', 'estimate=0', 'estimate=101', 'estimate=2.5', 'category=unknown', 'due=2026-02-30', 'due before next Funday', 'updated in the last 0 days', 'updated in the last 1000 days', 'team=all', 'label~"anything"', 'title="unterminated', 'title="x";SELECT 1']) {
      const response = await f.member.call('/issues?' + new URLSearchParams({ expression: invalid }));
      expect(response.status, invalid).toBe(400);
      expect((await f.member.call('/views', 'POST', { name: marker, query: { expression: invalid } })).status, invalid).toBe(400);
    }
    expect(await snapshot(['issues', 'issue_activity', 'saved_views', 'list_preferences'])).toEqual(before);
    console.log('PROBE SEARCH-004 native-fields: mounted issue queries -> exact native field, text, estimate and date sets; saved expression retained; invalid comparisons 400 without writes');
  } finally { vi.useRealTimers(); }
}
