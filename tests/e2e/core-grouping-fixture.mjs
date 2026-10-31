import assert from 'node:assert/strict';

export async function groupingFixture(owner) {
  const marker = 'synthetic-vector-' + Date.now();
  const prefix = 'VG' + marker.slice(-6).replaceAll(/\d/g, n => String.fromCharCode(65 + Number(n)));
  const teams = [];
  for (const [n, isPrivate] of [false, true].entries()) {
    const name = `${marker}-team-${n}`;
    teams.push((await owner('/settings/teams', 'POST', { name, identifierPrefix: prefix + String.fromCharCode(65 + n), isPrivate })).teams.find(t => t.name === name));
  }
  const operator = (await owner('/options')).operator;
  const projectName = marker + '-project';
  const project = (await owner('/settings/projects', 'POST', { name: projectName, leadOperatorId: operator.id })).projects.find(p => p.name === projectName);
  const milestones = [];
  for (let n = 0; n < 2; n++) {
    const detail = await owner(`/settings/projects/${project.id}/milestones`, 'POST', { name: 'Same milestone' });
    milestones.push(detail.milestones.at(-1));
  }
  const parents = [];
  for (const team of [teams[0], teams[0], teams[1]]) parents.push(await owner('/issues', 'POST', {
    teamId: team.id, title: team.id === teams[1].id ? 'Private parent title ' + marker : 'Same parent title', priority: 'low',
  }, 201));
  const issues = [];
  for (let n = 0; n < 55; n++) {
    let issue = await owner('/issues', 'POST', {
      teamId: teams[n === 53 ? 1 : 0].id, title: `${marker} ${n}`, priority: 'high', projectId: project.id,
      milestoneId: n < 51 ? milestones[0].id : n === 51 ? milestones[1].id : null,
    }, 201);
    const parent = parents[n < 51 ? 0 : n === 51 ? 1 : 2];
    if (n < 54) issue = await owner(`/issues/${issue.identifier}/parent`, 'PATCH', { expectedVersion: issue.version, parentIdentifier: parent.identifier });
    issues.push(issue);
  }
  await owner('/issues', 'POST', { teamId: teams[0].id, title: marker + ' excluded', priority: 'low' }, 201);
  assert.equal(new Set(issues.map(i => i.id)).size, 55);
  return { marker, teams, milestones, parents, issues };
}
