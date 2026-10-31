import {tokenScopes as coreScopes} from './scopes';
import {releaseScopes} from '../releases/scopes';
import {initiativeScopes} from '../initiatives/scopes';
import {agentScopes} from '../agent-door/scopes';
/** Additive feature registration leaves the shared core registry unchanged. */
export const tokenScopes=["issue-templates:read", "issue-templates:write", ...coreScopes,...releaseScopes,...initiativeScopes,...agentScopes] as const;
