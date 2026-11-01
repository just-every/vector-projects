import {Link} from '@tanstack/react-router';
import './github-rules.css';
import {z} from 'zod';
import {useApiResource} from '../../../app/api-client';
import {gitRuleSchema as ruleSchema} from '../github/rule-schema';
const teamSchema=z.object({id:z.string(),name:z.string(),statuses:z.array(z.object({id:z.string(),name:z.string()})),rules:z.array(ruleSchema)});
const schema=z.object({teams:z.array(teamSchema)});
/** The Git rules of every team the viewer may change; the rules themselves are edited in each team's Automation tab. */
export function useGithubRules(){
 return useApiResource('/api/github/automation',schema);
}
export type GithubRulesResource=ReturnType<typeof useGithubRules>;
/** Connections' pointer to where a team's Git rules live. */
export function GithubRules(){
 return <p><Link className="github-rules-teams-link" to="/app/settings/teams">Manage Git automation rules in Teams</Link></p>;
}
