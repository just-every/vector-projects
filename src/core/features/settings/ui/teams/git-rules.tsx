import { z } from 'zod';
import { ApiError, fetchJson } from '../../../../app/api-client';
import { gitRuleSchema, type GitRule, type GitTrigger } from '../../../integrations/github/rule-schema';
import { useGithubRules } from '../../../integrations/ui/github-rules';
import { SelectField } from '../fields/select-field';
import { SwitchField } from '../fields/switch-field';
import { TextField } from '../fields/text-field';
import { Refusal } from '../fields/use-autosave';

const names: Record<GitTrigger, string> = { draft: 'Draft PR opened', review: 'Review requested', merged: 'PR merged', deploy: 'Production deployed' };
const receipt = z.object({ saved: z.boolean(), rule: gitRuleSchema });

/** A team's Git rules: four triggers, each a status choice stored as it changes; the production environment and the reopen switch. */
export function GitRules({ teamId }: { teamId: string }) {
  const resource = useGithubRules();
  const team = resource.data?.teams.find(item => item.id === teamId);
  if (resource.error) return <p role="alert">{resource.error.message}</p>;
  if (!team) return null;
  const rules = team.rules;
  const deploy = rules.find(rule => rule.trigger === 'deploy');
  // Each rule has its own version, kept current from the answer to its last save.
  async function put(rule: GitRule, change: { statusId?: string | null; allowReopen?: boolean; environment?: string }) {
    try {
      const saved = await fetchJson('/api/settings/teams/' + teamId, receipt, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ githubAutomation: {
          trigger: rule.trigger, statusId: change.statusId === undefined ? rule.statusId : change.statusId,
          allowReopen: change.allowReopen === undefined ? Boolean(rule.allowReopen) : change.allowReopen,
          expectedVersion: rule.version, environment: change.environment ?? rule.environment,
        } }),
      });
      resource.publishReceipt(current => ({ teams: current!.teams.map(item => item.id !== teamId ? item
        : { ...item, rules: item.rules.map(old => old.trigger === rule.trigger ? saved.rule : old) }) }));
      return saved.rule;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) { resource.reload(); throw new Refusal('This rule changed in the meantime. Retry to save your choice on top of the latest.'); }
      if (error instanceof ApiError && error.status === 403) throw new Refusal('You no longer have permission to change this team’s rules.');
      throw error;
    }
  }
  async function reopenAll(next: boolean) {
    // One switch for the team's rules: each rule is stored in turn, from the version the last answer gave it.
    for (const rule of rules) if (Boolean(rule.allowReopen) !== next) await put(rule, { allowReopen: next });
  }
  return <section className="team-block" aria-label="Git automation">
    <h2 className="group-heading">Git automation</h2>
    <div className="git-rules">
      {rules.map(rule => <SelectField key={rule.trigger} label={names[rule.trigger]} value={rule.statusId ?? ''}
        options={[{ value: '', label: 'Do not move' }, ...team.statuses.map(status => ({ value: status.id, label: status.name }))]}
        save={next => put(rule, { statusId: next || null })} />)}
      {deploy && <TextField label="Environment" value={deploy.environment} hint="The environment that counts as production."
        save={async next => { if (!next.trim()) throw new Refusal('Enter an environment name, such as production.'); await put(deploy, { environment: next.trim() }); }} />}
    </div>
    <SwitchField label="Allow these rules to reopen completed issues" value={rules.every(rule => Boolean(rule.allowReopen))} save={reopenAll} />
  </section>;
}
