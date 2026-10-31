import inventory from "../data/archive-inventory.json";
import {
  storedValueSql,
  restoreValueSql,
  type StoredValue,
} from "../../shared/sql/stored-value";

export type ErasureSnapshot = Record<string, Record<string, StoredValue>[]>;
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const captured = (name: string, key: string) =>
  `SELECT ${restoreValueSql("json_extract(value,'$." + key + "')")} FROM json_each(b.value,'$.${name}')`;
const eventIds = "SELECT id FROM erasure_event_ids";
const deliveryIds = "SELECT id FROM erasure_delivery_ids";
const webhookIds = "SELECT id FROM erasure_webhook_ids";
const childIds = "SELECT id FROM erasure_child_ids";
const bodyIdentifier = (value: string) =>
  `json_extract(CASE WHEN json_valid(${value}) THEN ${value} ELSE '{}' END,'$.identifier')`;
const capturedIds = (name: string, key: string) =>
  `(SELECT json_group_array(json_extract(x.value,'$.${key}')) FROM b,json_each(b.value,'$.${name}') x)`;
const ids = (name: string, arrays: string[]) =>
  `${name} AS MATERIALIZED (SELECT DISTINCT ${restoreValueSql("v.value")} id FROM json_each(json_array(${arrays.join(",")})) groups,json_each(groups.value) v)`;
const scopeDefinitions = [
  ids("erasure_event_ids", [
    `(SELECT json_group_array(${storedValueSql("a.id")}) FROM issue_activity a,c WHERE a.issue_id=c.id)`,
    capturedIds("notification_events", "event_id"),
  ]),
  ids("erasure_delivery_ids", [
    `(SELECT json_group_array(${storedValueSql("d.id")}) FROM notification_deliveries d,c WHERE d.identifier=c.identifier OR d.notification_id IN(SELECT id FROM notifications WHERE issue_id=c.id))`,
    capturedIds("notification_deliveries", "id"),
  ]),
  ids("erasure_digest_ids", [
    `(SELECT json_group_array(${storedValueSql("item.batch_id")}) FROM notification_digest_items item JOIN notification_deliveries d ON d.notification_id=item.notification_id,c WHERE d.id IN(${deliveryIds}))`,
    capturedIds("notification_digest_items", "batch_id"),
  ]),
  ids("erasure_child_ids", [
    `(SELECT json_group_array(${storedValueSql("p.issue_id")}) FROM issue_parents p,c WHERE p.parent_issue_id=c.id)`,
    capturedIds("children", "id"),
  ]),
  ids("erasure_webhook_ids", [
    `(SELECT json_group_array(${storedValueSql("r.id")}) FROM vector_webhook_events r,c WHERE r.workspace_id=c.workspace AND ${bodyIdentifier("r.body")}=c.identifier)`,
    `(SELECT json_group_array(${storedValueSql("r.id")}) FROM integration_deliveries r,c WHERE r.namespace=c.workspace AND ${bodyIdentifier("json_extract(r.envelope,'$.body')")}=c.identifier)`,
    `(SELECT json_group_array(${storedValueSql("r.id")}) FROM integration_replays r,c WHERE r.namespace=c.workspace AND ${bodyIdentifier("json_extract(r.envelope,'$.body')")}=c.identifier)`,
    `(SELECT json_group_array(${storedValueSql("r.id")}) FROM vector_webhook_erasures r,c WHERE r.namespace=c.workspace AND r.identifier=c.identifier)`,
    capturedIds("vector_webhook_events", "id"),
    capturedIds("integration_deliveries", "id"),
    capturedIds("integration_replays", "id"),
  ]),
];
const scopes=scopeDefinitions.join(",");

// This inventory is specific to erasure. Incoming edges and every local copy
// participate, even when import ownership is absent. Captured keys continue to
// select orphaned dependants for the absent postcondition after their owner goes.
const relations: Record<
  string,
  { table: string; where: string; columns?: string[] }
> = {};
for (const table of [
  "issue_comments",
  "issue_reactions",
  "issue_links",
  "issue_files",
  "issue_activity",
  "issue_description_revisions",
  "issue_labels",
  "evidence_revisions",
  "intake_decisions",
  "triage_creation_receipts",
  "issue_deferral_origins",
  "issue_followers",
  "issue_notification_mutes",
  "issue_mentions",
  "notifications",
  "notification_snoozes",
  "issue_reminders",
  "notification_candidates",
  "vector_github_issue_links",
  "vector_import_revisions",
  "issue_aliases",
  "due_reminders",
  "due_reminder_suppressions",
  "vector_source_records",
  "vector_source_receipts",
  "detached_file_removals",
])
  relations[table] = { table, where: "r.issue_id=c.id" };
Object.assign(relations, {
  issues: { table: "issues", where: "r.id=c.id" },
  issue_deletions: { table: "issue_deletions", where: "r.issue_id=c.id" },
  audit_records: {
    table: "audit_records",
    where: "r.subject_id=c.id OR r.subject_identifier=c.identifier",
  },
  search_issues: {
    table: "search_issues",
    where: "r.id=c.id",
    columns: ["id", "text"],
  },
  issue_parents: {
    table: "issue_parents",
    where: "r.issue_id=c.id OR r.parent_issue_id=c.id",
  },
  issue_reference_subjects: {
    table: "issue_reference_subjects",
    where: "r.source_issue_id=c.id OR r.target_issue_id=c.id",
  },
  document_issue_references: {
    table: 'document_issue_references',
    where: "r.target_issue_id=c.id OR r.document_id IN(SELECT id FROM main.documents WHERE parent_kind='issue' AND parent_id=c.id) OR r.document_id IN(" + captured('document_issue_references','document_id') + ") AND r.target_issue_id IN(" + captured('document_issue_references','target_issue_id') + ")",
  },
  document_reference_activity: {
    table: 'issue_activity',
    where: "(r.kind='issue.mentioned' AND json_extract(r.next_value_json,'$.sourceDocumentId') IN(SELECT id FROM main.documents WHERE parent_kind='issue' AND parent_id=c.id)) OR r.id IN(" + captured('document_reference_activity','id') + ")",
  },
  reference_source_activity: {
    table: "issue_activity",
    where: "(r.kind='issue.mentioned' AND json_extract(r.next_value_json,'$.sourceIssueId')=c.id) OR r.id IN(" + captured("reference_source_activity", "id") + ")",
  },
  issue_relations: { table: "issue_relations", where: "r.first_issue_id=c.id OR r.second_issue_id=c.id" },
  issue_dependencies: {
    table: "issue_dependencies",
    where: "r.blocked_issue_id=c.id OR r.blocking_issue_id=c.id",
  },
  issue_duplicates: {
    table: "issue_duplicates",
    where: "r.issue_id=c.id OR r.canonical_issue_id=c.id",
  },
  children: { table: "issues", where: `r.id IN(${childIds})` },
  child_parent_activity: {
    table: "issue_activity",
    where: `r.issue_id IN(${childIds}) AND r.kind='issue.parent_changed' AND json_extract(r.previous_value_json,'$.parentIdentifier')=c.identifier AND json_extract(r.next_value_json,'$.parentIdentifier') IS NULL`,
  },
  notification_events: {
    table: "notification_events",
    where: `r.event_id IN(${eventIds})`,
  },
  notification_deliveries: {
    table: "notification_deliveries",
    where: `r.id IN(${deliveryIds})`,
  },
  notification_channel_receipts: {
    table: "notification_channel_receipts",
    where: "r.notification_id IN(SELECT id FROM notifications WHERE issue_id=c.id) OR r.notification_id IN(" + captured("notification_channel_receipts", "notification_id") + ")",
  },
  notification_channel_restore_holds: {
    table: "notification_channel_restore_holds",
    where: "r.notification_id IN(SELECT id FROM notifications WHERE issue_id=c.id) OR r.notification_id IN(" + captured("notification_channel_restore_holds", "notification_id") + ")",
  },
  notification_digest_items: {
    table: "notification_digest_items",
    where: "r.notification_id IN(SELECT notification_id FROM notification_deliveries WHERE id IN(" + deliveryIds + ")) OR r.notification_id IN(" + captured("notification_digest_items", "notification_id") + ")",
  },
  notification_digest_batches: { table: "notification_digest_batches", where: "r.id IN(SELECT id FROM erasure_digest_ids)" },
  notification_digest_attempts: { table: "notification_digest_attempts", where: "r.batch_id IN(SELECT id FROM erasure_digest_ids)" },
  notification_digest_windows: { table: "notification_digest_windows", where: "r.batch_id IN(SELECT id FROM erasure_digest_ids)" },
  notification_delivery_attempts: {
    table: "notification_delivery_attempts",
    where: `r.delivery_id IN(${deliveryIds}) OR r.id IN(${captured("notification_delivery_attempts", "id")})`,
  },
  vector_restore_mail_holds: {
    table: "vector_restore_mail_holds",
    where: `r.delivery_id IN(${deliveryIds})`,
  },
  rer_mail_development_outbox: {
    table: "rer_mail_development_outbox",
    where: `json_extract(r.message,'$.deliveryId') IN(${deliveryIds}) OR json_extract(r.message,'$.deliveryId') IN(SELECT id FROM erasure_digest_ids) OR r.id IN(${captured("rer_mail_development_outbox", "id")})`,
  },
  vector_webhook_events: {
    table: "vector_webhook_events",
    where: `r.workspace_id=c.workspace AND r.id IN(${webhookIds})`,
  },
  integration_deliveries: {
    table: "integration_deliveries",
    where: `r.namespace=c.workspace AND r.id IN(${webhookIds})`,
  },
  integration_replays: {
    table: "integration_replays",
    where: `r.namespace=c.workspace AND r.id IN(${webhookIds})`,
  },
  integration_attempts: {
    table: "integration_attempts",
    where: `r.namespace=c.workspace AND r.delivery_id IN(${webhookIds})`,
  },
  integration_resolutions: {
    table: "integration_resolutions",
    where: `r.namespace=c.workspace AND r.delivery_id IN(${webhookIds})`,
  },
  vector_webhook_erasures: {
    table: "vector_webhook_erasures",
    where: `r.namespace=c.workspace AND r.identifier=c.identifier`,
  },
  vector_webhook_restore_holds: {
    table: "vector_webhook_restore_holds",
    where: `r.namespace=c.workspace AND r.id IN(${webhookIds})`,
  },
});
const object = (table: string, fields?: string[]) => {
  const columns = fields ?? (inventory as Record<string, string[]>)[table];
  if (!columns) throw Error("unclassified_erasure_relation");
  return (
    "json_object(" +
    [...columns]
      .sort()
      .flatMap((name) => ["'" + name + "'", storedValueSql("r." + quote(name))])
      .join(",") +
    ")"
  );
};
// Canonicalize arrays with SQLite's own binary ordering, also for arbitrary
// Unicode external IDs. Every full row and cardinality must match.
const contextBase="WITH c AS (SELECT ? id,? identifier,? workspace), b AS (SELECT ? value)";
// Packed erasure guards also receive the visibility CTEs. Include only the
// supporting scopes a relation uses, preserving every complete-row predicate
// while keeping the final statement below D1's SQL byte limit.
function relationContext(expression:string){
  const needed=new Set<string>();
  const names=scopeDefinitions.map(definition=>definition.split(' ')[0]);
  const visit=(sql:string)=>{for(const name of names)if(sql.includes(name)&&!needed.has(name)){
    needed.add(name);visit(scopeDefinitions[names.indexOf(name)]);
  }};
  visit(expression);
  const selected=scopeDefinitions.filter((_,index)=>needed.has(names[index]));
  return contextBase+(selected.length?','+selected.join(','):'');
}
export const snapshotParts = Object.keys(relations).sort().map((name) => {
  const { table, where, columns } = relations[name];
  const current= `(SELECT json_group_array(json(value)) FROM (SELECT ${object(table, columns)} value FROM main.${quote(table)} r WHERE ${where} ORDER BY value))`;
  return {name,current,context:relationContext(current),
    expected: `(SELECT json_group_array(json(value)) FROM (SELECT value FROM json_each(e.value,'$.${name}') ORDER BY value))`,
  };
});
export const snapshotExpression =
  "json_object(" +
  snapshotParts.flatMap(({ name, current }) => ["'" + name + "'", `json(${current})`]).join(",") +
  ")";
export const expectedExpression =
  "json_object(" +
  snapshotParts.flatMap(({ name, expected }) => ["'" + name + "'", `json(${expected})`]).join(",") +
  ")";
export const snapshotContext =
  contextBase+", "+scopes;
