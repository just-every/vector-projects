import './comment-composer.css';
import { MentionTextarea } from '../notifications/ui/mention-textarea';
import { useCommentDraft } from './use-comment-draft';
import type { Mutate } from '../issues/ui/discussion-thread';

/** The existing native composer retains its editor and ordinary comment door. */
export function CommentComposer({ identifier,parentId,busy,mutate,onCancel,onPosted }:{
  identifier:string;parentId?:string;busy:boolean;mutate:Mutate;onCancel?:()=>void;onPosted?:()=>void;
}) {
  const draft = useCommentDraft(identifier,parentId);
  return <form id={parentId ? 'reply-' + parentId : 'comment-draft'} className={parentId ? 'comment-reply account-comment-composer' : 'issue-mutation-form comment-composer account-comment-composer'}
    onSubmit={event => { event.preventDefault(); void draft.submit((init,done) => mutate('comments',init,done),onPosted); }}>
    <label><span className="visually-hidden">{parentId ? 'Reply to thread' : 'Add a comment'}</span>
      <MentionTextarea aria-label={parentId ? 'Reply to thread' : 'Add a comment'} placeholder={parentId ? 'Write a reply…' : 'Write a comment…'}
        required maxLength={100000} disabled={busy || !draft.ready} value={draft.body} onValueChange={draft.setBody}/></label>
    <div className="comment-draft-actions"><button disabled={busy || !draft.ready} type="submit">{parentId ? 'Post reply' : 'Add comment'}</button>
    {draft.body && <button disabled={busy || !draft.ready} type="button" onClick={() => void draft.discard()}>Discard comment draft</button>}
    {onCancel && <button disabled={busy} type="button" onClick={onCancel}>Cancel</button>}
    </div>
    {draft.message && <p role="status">{draft.message}</p>}
  </form>;
}
