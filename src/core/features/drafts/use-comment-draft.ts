import { useEffect, useRef, useState } from 'react';
import { useRouteContext } from '@tanstack/react-router';
import { ApiError, fetchJson } from '../../app/api-client';
import { createUlid } from '../../shared/ids';
import { commentDraftReceiptSchema, commentDraftsSchema, type CommentDraft } from './comment-schema';
import type { DraftReference } from './schema';

export function useCommentDraft(identifier: string, parentId?: string) {
  const { operator } = useRouteContext({ from:'/app' });
  // Operator identities are workspace-specific, so the browser copy needs no
  // options read; a remounted composer (Current's default detail) starts no extra I/O.
  const key = `vector:comment-draft:${operator.id}:${identifier}:${parentId ?? ''}`;
  const [body,setBody] = useState(''), [ready,setReady] = useState(false), [message,setMessage] = useState('');
  const selected = useRef<DraftReference | null>(null), synced = useRef(''), latest = useRef('');
  const alive = useRef(true), posting = useRef(false), queue = useRef<Promise<unknown>>(Promise.resolve());
  const apply = (draft: CommentDraft | null, notice: string) => {
    selected.current = draft ? { id:draft.id,revision:draft.revision } : null;
    synced.current = draft?.body ?? ''; latest.current = synced.current;
    if (alive.current) { setBody(latest.current); setMessage(notice); }
    try { localStorage.removeItem(key); } catch { /* Account custody is still available. */ }
  };
  const changed = (value: string) => {
    latest.current = value; setBody(value);
    try { localStorage.setItem(key,JSON.stringify({ body:value,reference:selected.current })); }
    catch { setMessage('This browser could not retain offline changes.'); }
  };
  async function persist() {
    if (posting.current || !ready) return selected.current;
    const snapshot = latest.current;
    if (snapshot === synced.current || (!selected.current && !snapshot)) return selected.current;
    if (!selected.current) selected.current = {id:createUlid(new Date()),revision:0};
    const ref = selected.current, creating = ref.revision === 0;
    try {
      const receipt = await fetchJson(creating ? `/api/issues/${identifier}/comment-drafts` : '/api/comment-drafts/' + ref.id,
        commentDraftReceiptSchema,{ method:creating ? 'POST' : 'PATCH',headers:{'content-type':'application/json'},
          body:JSON.stringify({body:snapshot,...(creating ? {id:ref.id,...(parentId ? {parentId} : {})} : {revision:ref.revision})}) });
      if (!receipt.draft) throw new Error('Unable to save comment draft.');
      selected.current = {id:receipt.draft.id,revision:receipt.draft.revision}; synced.current = snapshot;
      try { localStorage.setItem(key,JSON.stringify({body:latest.current,reference:selected.current})); } catch { /* The editor reports browser storage failures. */ }
      if (alive.current) setMessage('Comment draft saved to your account.');
      return selected.current;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = commentDraftReceiptSchema.safeParse(error.body);
        if (current.success) apply(current.data.draft,current.data.draft ? 'Showing the newer comment draft from another device. Review it before saving again.' : 'This comment draft was posted or discarded on another device.');
      } else if (alive.current) setMessage('Account draft unavailable. Your unsent comment is retained in this browser.');
      throw error;
    }
  }
  const flush = () => {
    const next = queue.current.catch(() => undefined).then(persist); queue.current = next; return next;
  };
  useEffect(() => {
    alive.current = true;
    return () => { void flush().catch(() => undefined); alive.current = false; };
  }, [ready]);
  useEffect(() => {
    let canceled = false;
    void fetchJson('/api/comment-drafts',commentDraftsSchema).then(result => {
      if (canceled) return;
      const draft = result.drafts.find(row => row.identifier === identifier && row.parentId === (parentId ?? null));
      let local: {body?: string;reference?: DraftReference} | null = null;
      try { local = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* Ignore malformed browser metadata. */ }
      apply(draft ?? null,draft ? 'Restored your account comment draft.' : '');
      if (typeof local?.body === 'string' && (draft ? local.reference?.id === draft.id && local.reference.revision === draft.revision : !local.reference)) changed(local.body);
    }).catch(() => {
      if (canceled) return;
      try {
        const local = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (typeof local?.body === 'string') { selected.current = local.reference ?? null; changed(local.body); }
      } catch { /* No browser copy available. */ }
      setMessage('Account drafts unavailable. This browser keeps your unsent comment.');
    }).finally(() => { if (!canceled) setReady(true); });
    return () => { canceled = true; };
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    const save = () => { void flush().catch(() => undefined); };
    const timer = setTimeout(save,350); window.addEventListener('online',save);
    return () => { clearTimeout(timer); window.removeEventListener('online',save); };
  }, [ready,body]);
  useEffect(() => {
    if (!ready) return;
    let busy = false;
    const refresh = () => {
      if (busy || posting.current || document.hidden) return;
      busy = true;
      void queue.current.catch(() => undefined).then(async () => {
        const observed = selected.current;
        const result = await fetchJson('/api/comment-drafts',commentDraftsSchema);
        if (!alive.current || observed !== selected.current) return;
        const draft = result.drafts.find(row => row.identifier === identifier && row.parentId === (parentId ?? null));
        if (draft && (!observed || draft.id !== observed.id || draft.revision > observed.revision))
          apply(draft,'Showing the newer comment draft from another device.');
        else if (!draft && observed && observed.revision > 0) apply(null,'This comment draft was posted or discarded on another device.');
      }).catch(() => undefined).finally(() => { busy = false; });
    };
    const timer = setInterval(refresh,2000); window.addEventListener('focus',refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus',refresh); };
  }, [ready]);
  async function submit(mutate: (init: RequestInit,onSuccess: () => void) => Promise<void>, done?: () => void) {
    try {
      const reference = await flush(); posting.current = true;
      await mutate({method:'POST',headers:{'content-type':'application/json',...(reference ? {
        'x-vector-comment-draft-id':reference.id,'x-vector-comment-draft-revision':String(reference.revision)} : {})},
        body:JSON.stringify({body:latest.current,...(parentId ? {parentId} : {})})},() => { apply(null,'Comment posted.'); done?.(); });
    } catch { /* Autosave reports its own error and retains the composer. */ }
    finally { posting.current = false; }
  }
  async function discard() {
    try {
      const ref = await flush();
      if (ref) await fetchJson('/api/comment-drafts/' + ref.id,commentDraftReceiptSchema,{method:'DELETE',
        headers:{'content-type':'application/json'},body:JSON.stringify({revision:ref.revision})});
      apply(null,'Comment draft discarded.');
    } catch { if (alive.current) setMessage('Unable to discard this draft. Review the current comment and try again.'); }
  }
  return {body,setBody:changed,ready,message,submit,discard};
}
