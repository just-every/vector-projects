import inventory from '../archive-inventory.json';
import type { Json, D1Sql } from '../../../../../vendor/base/import-kit/src/d1/index';

// Each owned relation participates in the same full-value predicate. Incoming
// relationships are guarded separately on reversal, since later entries in the
// accepted batch may legitimately point at an earlier imported issue.
export const nativeRelations = {
  labels:['issue_labels','issue_id','label_id'],
  // Write recorded history before activity, whose trigger creates a revision
  // only when the initial description has not already been recorded.
  descriptionRevisions:['issue_description_revisions','issue_id','id'],
  activity:['issue_activity','issue_id','id'],
  parent:['issue_parents','issue_id','issue_id'],
  dependencies:['issue_dependencies','blocked_issue_id','blocking_issue_id'],
  comments:['issue_comments','issue_id','id'],
  files:['issue_files','issue_id','id'],
  links:['issue_links','issue_id','id'],
  evidence:['evidence_revisions','issue_id','id'],
  decisions:['intake_decisions','issue_id','id'],
  followers:['issue_followers','issue_id','operator_id'],
  mentions:['issue_mentions','issue_id','operator_id'],
  mutes:['issue_notification_mutes','issue_id','operator_id'],
  deferralOrigins:['issue_deferral_origins','issue_id','issue_id'],
  notifications:['notifications','issue_id','id'],
  notificationSnoozes:['notification_snoozes','issue_id','notification_id'],
  personalReminders:['issue_reminders','issue_id','id'],
  notificationCandidates:['notification_candidates','issue_id','event_id'],
} as const;
export type NativeIssueValue = { issue: Record<string,Json>; manualOrder?: Record<string,Json>[]; related?: Record<string,Json>[] } & Record<keyof typeof nativeRelations,Record<string,Json>[]>;
const quote = (value: string) => '"'+value.replaceAll('"','""')+'"';
const columns = (table: string) => {
  const value=(inventory as Record<string,string[]>)[table];
  if (!value) throw Error('unclassified_import_relation');
  return [...value].sort();
};
// New nullable columns join an issue's value only once set, preserving the
// exact shape of retained pre-feature snapshots. Build keys in canonical order
// before removing absent fields so a set date matches the publication guard.
const optional: Record<string,string[]> = {
  issues:['archived_at','milestone_id','start_date'], issue_comments:['description_anchor','document_anchor'],
  issue_activity:['agent_id','agent_operation_id','agent_approvers_json'],
};
const object = (table: string,alias: string) => {
  const extra=optional[table]??[];
  const base='json_object('+columns(table).flatMap(name=>["'"+name+"'",alias+'.'+quote(name)]).join(',')+')';
  // Merge-patch removes null-valued keys and retains existing non-null keys in
  // place. Keep the full snapshot once rather than doubling its SQL per column.
  return extra.length ? `json_patch(${base},json_object(${extra.flatMap(name=>["'"+name+"'",alias+'.'+quote(name)]).join(',')}))` : base;
};
const relation = (table: string,key: string,order: string) => `(SELECT json_group_array(json(value)) FROM (SELECT ${object(table,'r')} AS value FROM ${quote(table)} r WHERE r.${quote(key)}=i.id ORDER BY r.${quote(order)}))`;
export const legacySnapshotExpression = 'json_object('+[
  ['issue',object('issues','i')],
  ...Object.entries(nativeRelations).map(([name,[table,key,order]])=>[name,relation(table,key,order)]),
].sort(([a],[b])=>a<b?-1:a>b?1:0).flatMap(([name,expression])=>["'"+name+"'",'json('+expression+')']).join(',')+')';
// Optional keys preserve the exact shape of retained pre-feature snapshots.
function extendedSnapshot(manual:boolean,related:boolean) {
  return 'json_object('+[
    ['issue',object('issues','i')],
    ...Object.entries(nativeRelations).map(([name,[table,key,order]])=>[name,relation(table,key,order)]),
    ...(manual?[['manualOrder',relation('manual_order_entries','issue_id','scope_key')]]:[]),
    ...(related?[['related',relation('issue_relations','first_issue_id','second_issue_id')]]:[]),
  ].sort(([a],[b])=>a<b?-1:a>b?1:0).flatMap(([name,expression])=>["'"+name+"'",'json('+expression+')']).join(',')+')';
}
export const snapshotExpression = `CASE WHEN EXISTS(SELECT 1 FROM issue_relations WHERE first_issue_id=i.id)
  THEN CASE WHEN EXISTS(SELECT 1 FROM manual_order_entries WHERE issue_id=i.id) THEN ${extendedSnapshot(true,true)} ELSE ${extendedSnapshot(false,true)} END
  ELSE CASE WHEN EXISTS(SELECT 1 FROM manual_order_entries WHERE issue_id=i.id) THEN ${extendedSnapshot(true,false)} ELSE ${legacySnapshotExpression} END END`;

export function emptyIssueValue(issue: Record<string,Json>): NativeIssueValue {
  return { issue,...Object.fromEntries(Object.keys(nativeRelations).map(name=>[name,[]])) } as NativeIssueValue;
}
/** `when`, if given, inserts the row only while its condition holds. */
export function insertNative(table: string,value: Record<string,Json>,when?: D1Sql): D1Sql {
  const fields=Object.keys(value).sort();
  if (fields.some(name=>!columns(table).includes(name))) throw Error('unknown_import_column');
  const values=fields.map(()=>'?').join(','),params=fields.map(name=>value[name]);
  if (when) return {sql:`INSERT INTO ${quote(table)}(${fields.map(quote).join(',')}) SELECT ${values} WHERE ${when.sql}`,params:[...params,...(when.params??[])]};
  return {sql:`INSERT INTO ${quote(table)}(${fields.map(quote).join(',')}) VALUES(${values})`,params};
}
