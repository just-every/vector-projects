import {activeRecipient} from '../notifications/events';
import {mentionedOperators} from '../notifications/mentions.server';
import {visibleDocument} from './visibility';

/** Runs in the document's guarded revision transaction. The old body, including
 * ineligible mentions, prevents an unchanged edit from backfilling delivery.
 * Receipt custody survives removal, muting, restore and application rollback.
 * Channel delivery and document comments remain separate receiving work.
 */
export function documentMentionStatements(db:D1Database,event:{documentId:string;actor:string;version:number;at:string},body:string,previousBody='') {
 const ids=mentionedOperators(body),previous=new Set(mentionedOperators(previousBody));
 const added=JSON.stringify(ids.filter(id=>!previous.has(id))),encoded=JSON.stringify(ids);
 const source=`d.id=? AND d.version=? AND d.body=? AND r.document_id=d.id AND r.version=d.version AND r.body=d.body AND r.author_operator_id=?
   AND NOT EXISTS(SELECT 1 FROM document_notification_events e WHERE e.document_id=d.id AND e.version=d.version)`;
 const values=[event.documentId,event.version,body,event.actor];
 const eligible=`o.workspace_id=d.workspace_id AND ${activeRecipient} AND ${visibleDocument('o','d')}`;
 return [
  db.prepare(`INSERT INTO document_notifications(id,event_id,document_id,recipient_id,actor_id,actor_name,created_at)
   SELECT lower(hex(randomblob(16))),r.id,d.id,o.id,?,(SELECT name FROM operators WHERE id=?),?
   FROM documents d JOIN document_revisions r JOIN operators o ON ${eligible}
   WHERE ${source} AND o.id<>? AND o.id IN(SELECT value FROM json_each(?))
   AND NOT EXISTS(SELECT 1 FROM notification_type_mutes m WHERE m.operator_id=o.id AND m.kind='mention')`)
   .bind(event.actor,event.actor,event.at,...values,event.actor,added),
  db.prepare(`INSERT OR IGNORE INTO document_followers(document_id,operator_id,created_at)
   SELECT d.id,o.id,? FROM documents d JOIN document_revisions r JOIN operators o ON ${eligible}
   WHERE ${source} AND o.id IN(SELECT value FROM json_each(?))`)
   .bind(event.at,...values,added),
  db.prepare(`DELETE FROM document_mentions WHERE document_id=? AND EXISTS(
   SELECT 1 FROM documents d JOIN document_revisions r WHERE ${source})`).bind(event.documentId,...values),
  db.prepare(`INSERT INTO document_mentions(document_id,operator_id)
   SELECT d.id,o.id FROM documents d JOIN document_revisions r JOIN operators o ON ${eligible}
   WHERE ${source} AND o.id IN(SELECT value FROM json_each(?))`).bind(...values,encoded),
  db.prepare(`INSERT INTO document_notification_events(event_id,document_id,version,created_at)
   SELECT r.id,d.id,d.version,? FROM documents d JOIN document_revisions r WHERE ${source}`)
   .bind(event.at,...values),
 ];
}
