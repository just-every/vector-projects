import type { AccountDraft } from './schema';

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
