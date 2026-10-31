import { useEffect, useRef, useState } from 'react';
import { ApiError, fetchJson } from '../../app/api-client';
import { draftReceiptSchema, draftsSchema, type AccountDraft, type DraftReference } from './schema';
import { hasUnsavedDraft, type NewIssueDraft } from '../issues/ui/new-issue-draft';

export function useAccountDrafts(values: NewIssueDraft, setValues: (values: NewIssueDraft) => void,
  ready: boolean, key: string | null, defaults: NewIssueDraft, submitting: boolean) {
  const [drafts, setDrafts] = useState<AccountDraft[]>([]);
  const [message, setMessage] = useState('');
  const [initialized, setInitialized] = useState(false);
  const selected = useRef<DraftReference | null>(null);
  const synced = useRef('');
  const latest = useRef(values); latest.current = values;
  const alive = useRef(true);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const stopped = useRef(false);
  const identityKey = key ? key + ':account' : null;
  const retain = (reference: DraftReference | null) => {
    selected.current = reference;
    try {
      if (identityKey) {
        if (reference) localStorage.setItem(identityKey, JSON.stringify(reference));
        else localStorage.removeItem(identityKey);
      }
    } catch { setMessage('This browser could not remember its account draft.'); }
  };
  const apply = (draft: AccountDraft | null, notice = '') => {
    retain(draft ? { id: draft.id, revision: draft.revision } : null);
    const next = draft?.values ?? { ...defaults };
    synced.current = JSON.stringify(next); latest.current = next; setValues(next);
    setMessage(notice);
    if (!draft && key) try { localStorage.removeItem(key); } catch { /* The local form reports storage failures. */ }
  };
  async function refresh() {
    const result = await fetchJson('/api/drafts', draftsSchema);
    if (!alive.current) return;
    setDrafts(result.drafts);
    if (selected.current) {
      const current = result.drafts.find(row => row.id === selected.current!.id);
      if (!current) apply(null, 'This draft was submitted or discarded on another device.');
      else if (current.revision > selected.current.revision)
        apply(current, 'Showing the newer draft saved on another device.');
    }
  }
  async function persist() {
    if (stopped.current || !alive.current) return selected.current;
    const snapshot = latest.current, encoded = JSON.stringify(snapshot);
    if (snapshot.mode !== 'issue' || encoded === synced.current ||
      (!selected.current && !hasUnsavedDraft(snapshot, { ...defaults, mode: snapshot.mode }))) return selected.current;
    const reference = selected.current;
    try {
      const result = await fetchJson(reference ? '/api/drafts/' + reference.id : '/api/drafts', draftReceiptSchema, {
        method: reference ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: snapshot, ...(reference ? { revision: reference.revision } : {}) }),
      });
      if (!alive.current) return null;
      if (!result.draft) throw new Error('The draft could not be saved.');
      retain({ id: result.draft.id, revision: result.draft.revision });
      synced.current = encoded;
      setDrafts(rows => [result.draft!, ...rows.filter(row => row.id !== result.draft!.id)]);
      setMessage('Draft saved to your account.');
      return selected.current;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const conflict = draftReceiptSchema.safeParse(error.body);
        if (conflict.success) apply(conflict.data.draft,
          conflict.data.draft ? 'Showing the newer draft saved on another device. Review it before saving again.' : 'This draft was submitted or discarded on another device.');
      } else setMessage('Account draft unavailable. Your unsent form is retained in this browser.');
      throw error;
    }
  }
  const flush = () => {
    const next = queue.current.catch(() => undefined).then(persist);
    queue.current = next;
    return next;
  };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!ready || !key || initialized) return;
    let canceled = false;
    try {
      const stored = localStorage.getItem(identityKey!);
      const reference = stored ? JSON.parse(stored) : null;
      if (reference && typeof reference.id === 'string' && Number.isSafeInteger(reference.revision)) selected.current = reference;
    } catch { /* Account reads remain available without local metadata. */ }
    void fetchJson('/api/drafts', draftsSchema).then(result => {
      if (canceled) return;
      setDrafts(result.drafts);
      const draft = selected.current ? result.drafts.find(row => row.id === selected.current!.id) : result.drafts[0];
      if (draft && selected.current?.revision === draft.revision &&
          hasUnsavedDraft(latest.current, { ...defaults, mode: latest.current.mode })) {
        retain({ id: draft.id, revision: draft.revision });
        synced.current = JSON.stringify(draft.values);
        setMessage('Restored this browser’s unsent changes.');
      } else if (draft) apply(draft, 'Restored your account draft.');
      else if (selected.current) apply(null, 'This draft was submitted or discarded on another device.');
    }).catch(() => { if (!canceled) setMessage('Account drafts unavailable. This browser keeps your unsent form.'); })
      .finally(() => { if (!canceled) setInitialized(true); });
    return () => { canceled = true; };
  }, [ready, key, initialized]);
  useEffect(() => {
    if (!initialized || submitting) return;
    const timer = setTimeout(() => { void flush().catch(() => undefined); }, 350);
    return () => clearTimeout(timer);
  }, [initialized, values, submitting]);
  useEffect(() => {
    if (!initialized || submitting) return;
    let busy = false;
    const poll = () => {
      if (busy || document.hidden || stopped.current) return;
      busy = true;
      void queue.current.catch(() => undefined).then(refresh).catch(() => undefined).finally(() => { busy = false; });
    };
    const timer = setInterval(poll, 2000);
    window.addEventListener('focus', poll);
    return () => { clearInterval(timer); window.removeEventListener('focus', poll); };
  }, [initialized, submitting]);
  const open = async (draft: AccountDraft) => {
    await flush();
    const current = await fetchJson('/api/drafts/' + draft.id, draftReceiptSchema);
    apply(current.draft);
  };
  const discard = async (draft: AccountDraft) => {
    await flush();
    // Refresh after pending saves so discard targets the latest version of this form.
    const current = (await fetchJson('/api/drafts/' + draft.id, draftReceiptSchema)).draft;
    if (current) await fetchJson('/api/drafts/' + current.id, draftReceiptSchema, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: current.revision }),
    });
    if (selected.current?.id === draft.id) apply(null, 'Draft discarded.');
    await refresh();
  };
  return { drafts, message, initialized, flush, open, discard,
    newDraft: async () => { await flush(); apply(null); },
    consumed: () => { stopped.current = true; retain(null); },
    report: (error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to update this draft.') };
}
