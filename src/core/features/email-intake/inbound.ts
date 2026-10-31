// @ts-expect-error The pinned Base mail facade is native ESM.
import { normalizeInbound } from '../../../../vendor/base/mail/index.mjs';
// @ts-expect-error Native Base's address parser retains mailbox validation.
import { addresses } from '../../../../vendor/base/mail/src/inbound/headers.mjs';
import type { WorkerBindings } from '../../app/bindings';
import { createUlid } from '../../shared/ids';
import { createOperatorIntake } from '../operator-intake/repository';
import { operatorIntakeInputSchema } from '../operator-intake/input';
import { addComment } from '../discussion/repository';
import { automationAudit, intakeDatabase } from './authority';
import { digest, inboundLimits, saveInboundFiles, validateInboundFiles } from './files';
import { sendAcknowledgement } from './outbound';
import type { CloudflareIntakeMessage, InboundMail, IntakeMessage, IntakeSettings } from './types';

async function findThread(db: D1Database, teamId: string, mail: InboundMail) {
  const ids = [...(mail.inReplyTo?.match(/<[^<>\s]+>/g) ?? []),...mail.references.slice().reverse()];
  for (const id of ids) {
    const row = await db.prepare(`SELECT m.* FROM intake_email_messages m WHERE m.team_id=? AND m.status='received'
      AND (m.message_id=? OR m.id IN(SELECT d.root_id FROM intake_email_deliveries d WHERE d.message_id=? AND d.status IN('processing','accepted','uncertain')))
      ORDER BY m.created_at DESC LIMIT 1`).bind(teamId,id,id).first<IntakeMessage>();
    if (!row) continue;
    const root = row.root_id ? await db.prepare('SELECT * FROM intake_email_messages WHERE id=?').bind(row.root_id).first<IntakeMessage>() : row;
    if (!root?.sender || !root.issue_id || ![root.sender,...JSON.parse(root.cc_json) as string[]].includes(mail.from.toLowerCase())) return null;
    const outbound = await db.prepare('SELECT comment_id FROM intake_email_deliveries WHERE message_id=? AND root_id=?').bind(id,root.id).first<{comment_id:string|null}>();
    const parentId = outbound?.comment_id ?? row.comment_id;
    const comment = parentId ? await db.prepare('SELECT COALESCE(parent_comment_id,id) AS id FROM issue_comments WHERE id=? AND issue_id=?')
      .bind(parentId,root.issue_id).first<{id:string}>() : null;
    return {root,parentId:comment?.id};
  }
  return null;
}

/** Invoked only by the Worker's Cloudflare email event. There is deliberately
 * no public JSON endpoint capable of asserting a provider or sender identity. */
export async function receiveIntakeMail(message: CloudflareIntakeMessage, env: WorkerBindings) {
  const config = await env.DB.prepare('SELECT * FROM team_email_intake WHERE address=? AND enabled=1')
    .bind(message.to.toLowerCase()).first<IntakeSettings>();
  if (!config || !(JSON.parse(config.allowed_senders_json) as string[]).includes(message.from.toLowerCase())) {
    message.setReject('This intake address does not accept this sender.'); return {status:'rejected'};
  }
  const db = await intakeDatabase(env.DB,config), actor = config.actor_operator_id!;
  let mail: InboundMail, cc: string[];
  try {
    mail = await normalizeInbound({provider:'cloudflare',message},inboundLimits) as InboundMail;
    if (!mail.messageId) throw new Error('missing_message_id');
    validateInboundFiles(mail);
    cc = message.headers.get('cc') ? (addresses(message.headers.get('cc')) as string[]).map(value => value.toLowerCase()) : [];
    if (cc.length > 50 || mail.subject.length > 500) throw new Error('message_metadata_limit');
  } catch {
    message.setReject('The message or its attachments do not meet intake limits.'); return {status:'rejected'};
  }
  const at = new Date().toISOString(), id = createUlid(new Date()), key = await digest(mail.messageId!);
  const claim = await db.prepare(`INSERT INTO intake_email_messages(id,team_id,message_key,message_id,sender,requester_domain,subject,text_body,html_body,cc_json,references_json,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'processing',?,?) ON CONFLICT(team_id,message_key) DO NOTHING RETURNING id`)
    .bind(id,config.team_id,key,mail.messageId,mail.from.toLowerCase(),mail.from.split('@')[1].toLowerCase(),mail.subject,mail.text,mail.html,JSON.stringify(cc),JSON.stringify(mail.references),at,at).all<{id:string}>();
  if (!claim.results.length) return {status:'duplicate'};
  try {
    const thread = await findThread(db,config.team_id,mail);
    let issue: {id:string;identifier:string};
    if (thread) {
      const found = await db.prepare('SELECT id,identifier FROM issues WHERE id=?').bind(thread.root.issue_id).first<{id:string;identifier:string}>();
      if (!found) throw new Error('thread_unavailable');
      issue = found;
      await addComment(db,issue.id,actor,mail.text ?? mail.html ?? '',thread.parentId,(transaction,commentId) => [
        transaction.prepare(`UPDATE intake_email_messages SET issue_id=?,comment_id=?,root_id=?,updated_at=? WHERE id=? AND status='processing'`).bind(issue.id,commentId,thread.root.id,at,id),
        transaction.prepare('UPDATE issue_comments SET imported_author_name=? WHERE id=?').bind(mail.from,commentId),
        automationAudit(transaction,createUlid(new Date()),issue.id,'email_intake.received',at),
      ]);
    } else {
      const input = operatorIntakeInputSchema.parse({teamId:config.team_id,title:mail.subject || '(No subject)',description:mail.text ?? mail.html ?? '',summary:mail.text ?? mail.html ?? ''});
      const created = await createOperatorIntake(db,actor,input,new Date(),(transaction,created) => [
        transaction.prepare(`UPDATE intake_email_messages SET issue_id=?,updated_at=? WHERE id=? AND status='processing'`).bind(created.id,at,id),
        transaction.prepare(`UPDATE evidence_revisions SET source_name='Email intake',origin_kind='source',actor_operator_id=NULL WHERE issue_id=?`).bind(created.id),
        automationAudit(transaction,createUlid(new Date()),created.id,'email_intake.received',at),
      ], {name: 'Email intake'});
      const found = await db.prepare('SELECT id,identifier FROM issues WHERE identifier=?').bind(created.identifier).first<{id:string;identifier:string}>();
      if (!found) throw new Error('issue_unavailable');
      issue = found;
    }
    await saveInboundFiles({...env,DB:db},actor,issue,id,mail);
    await db.prepare(`UPDATE intake_email_messages SET status='received',updated_at=? WHERE id=? AND status='processing'`).bind(new Date().toISOString(),id).run();
    if (!thread && config.acknowledgement) await sendAcknowledgement({...env,DB:db},config,id,issue);
    return {status:'received',identifier:issue.identifier};
  } catch {
    // A receipt is never retried after a native mutation may have committed.
    // Operators see the failed receipt; replay cannot create another issue.
    await env.DB.prepare(`UPDATE intake_email_messages SET status='failed',error='receipt_incomplete',updated_at=? WHERE id=? AND status='processing'`).bind(new Date().toISOString(),id).run();
    return {status:'failed'};
  }
}
