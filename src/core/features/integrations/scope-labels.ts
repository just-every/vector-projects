import {tokenScopes} from './feature-scopes';

export const scopeLabels:Record<(typeof tokenScopes)[number],string>={
 'reports:read':'Read warehouse exports as an Owner or Admin',
 'issues:read':'Read issues you can access',
 'issues:write':'Create and update issues',
 'comments:write':'Add comments',
 'metadata:read':'Read workspace metadata',
 'projects:read':'Read projects you can access',
 'projects:write':'Create and update projects',
 'comments:read':'Read comments you can access',
 'comments:edit':'Edit your comments',
 'comments:delete':'Delete comments your role allows',
 'projects:delete':'Delete projects',
 'milestones:read':'Read project milestones',
 'milestones:write':'Create and update milestones',
 'milestones:delete':'Delete milestones',
 'cycles:read':'Read cycles',
 'cycles:write':'Create cycles',
 'labels:read':'Read workspace labels',
 'labels:write':'Manage labels',
 'teams:write':'Manage teams',
 'releases:read':'Read releases you can access',
 'releases:write':'Create and update releases',
 'initiatives:read':'Read initiatives you can access',
 'initiatives:write':'Create and update initiatives',
 'evidence:read':'Read agent evidence you can access',
};
export function scopeDescription(serialized:string){
 const scopes=JSON.parse(serialized) as (typeof tokenScopes)[number][];
 return new Intl.ListFormat(undefined,{style:'long',type:'conjunction'}).format(
  scopes.map(scope=>scopeLabels[scope][0].toLowerCase()+scopeLabels[scope].slice(1)),
 );
}
