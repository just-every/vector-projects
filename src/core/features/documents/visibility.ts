import {visibleTeam} from '../roles/visibility-sql';

/** Recipient admission matches native document parent visibility, evaluated in
 * the same statement snapshot as the mention's receipt and follower writes. */
export const visibleDocument=(person:string,document:string)=>`(
 (${document}.parent_kind='issue' AND EXISTS(SELECT 1 FROM main.issues parent WHERE parent.id=${document}.parent_id AND ${visibleTeam(person,'parent.team_id')})) OR
 (${document}.parent_kind='team' AND ${visibleTeam(person,document+'.parent_id')}) OR
 (${document}.parent_kind='project' AND EXISTS(SELECT 1 FROM main.projects parent WHERE parent.id=${document}.parent_id AND parent.workspace_id=${person}.workspace_id
   AND (EXISTS(SELECT 1 FROM main.issues child WHERE child.project_id=parent.id AND ${visibleTeam(person,'child.team_id')})
     OR (${person}.role<>'guest' AND NOT EXISTS(SELECT 1 FROM main.issues child WHERE child.project_id=parent.id))))) OR
 (${document}.parent_kind='initiative' AND ${person}.role<>'guest' AND EXISTS(SELECT 1 FROM main.initiatives parent WHERE parent.id=${document}.parent_id AND parent.workspace_id=${person}.workspace_id)))`;
