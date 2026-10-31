import type { AccountDraft } from './schema';
import { useNavigate } from '@tanstack/react-router';
import { useApiResource, fetchJson } from '../../app/api-client';
import { commentDraftsSchema, commentDraftReceiptSchema } from './comment-schema';
import { useState } from 'react';

export function DraftList({ drafts, open, discard, create }: { drafts: AccountDraft[];
  open: (draft: AccountDraft) => void; discard: (draft: AccountDraft) => void; create: () => void }) {
  return <section id="drafts" className="new-issue-section account-drafts" aria-label="Drafts">
    <h2>Drafts</h2>
    {drafts.length ? <ul>{drafts.map(draft => <li key={draft.id}>
      <button type="button" onClick={() => open(draft)} aria-label={'Open draft ' + (draft.values.title || 'Untitled issue')}>
        {draft.values.title || 'Untitled issue'}</button>{' · '}{draft.team}{' · '}
      <time dateTime={draft.updatedAt}>{new Date(draft.updatedAt).toLocaleString()}</time>{' '}
      <button type="button" onClick={() => discard(draft)} aria-label={'Discard draft ' + (draft.values.title || 'Untitled issue')}>Discard</button>
    </li>)}</ul> : <p>No open account drafts.</p>}
    <button type="button" onClick={create}>Start another draft</button>
  </section>;
}

export function CommentDraftList() {
  const resource = useApiResource('/api/comment-drafts',commentDraftsSchema,2000);
  const navigate = useNavigate();
  const [error,setError] = useState('');
  return <section className="new-issue-section account-drafts" aria-label="Comment drafts">
    <h2>Comment drafts</h2>
    {resource.error && <p role="alert">{resource.error.message}<button type="button" onClick={resource.reload}>Retry comment drafts</button></p>}
    {resource.data?.drafts.length ? <ul>{resource.data.drafts.map(draft => <li key={draft.id}>
      <button type="button" aria-label={'Open comment draft ' + draft.identifier} onClick={() => void navigate({to:'/app/issues/$identifier',params:{identifier:draft.identifier},
        hash:draft.parentId ? 'reply-' + draft.parentId : draft.anchor ? 'quote-draft' : 'comment-draft'})}>
        {draft.identifier}{draft.parentId ? ' · Reply' : draft.anchor ? ' · Quoted comment' : ' · Comment'}</button>{' · '}{draft.team}{' · '}
      <time dateTime={draft.updatedAt}>{new Date(draft.updatedAt).toLocaleString()}</time>{' '}
      <button type="button" aria-label={'Discard comment draft ' + draft.identifier} onClick={() => {
        setError('');
        void fetchJson('/api/comment-drafts/' + draft.id,commentDraftReceiptSchema,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({revision:draft.revision})})
          .then(() => resource.refreshAfterMutation()).catch(() => {setError('This draft changed. Refresh and try again.');resource.reload();});
      }}>Discard</button>
    </li>)}</ul> : resource.data && <p>No open comment drafts.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
