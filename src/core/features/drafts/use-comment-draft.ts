import { useEffect, useRef, useState } from 'react';
import { useRouteContext } from '@tanstack/react-router';
import { ApiError, fetchJson } from '../../app/api-client';
import { createUlid } from '../../shared/ids';
import type { DescriptionAnchorInput } from '../discussion/anchors';
import { commentDraftReceiptSchema, commentDraftsSchema, type CommentDraft } from './comment-schema';
import type { DraftReference } from './schema';

type Content = { body: string; anchor: DescriptionAnchorInput | null };
const empty: Content = { body:'', anchor:null };

/** One account composer: a comment, a reply (parentId) or a quoted description
 * thread (quote), whose saved selection reopens it on the author's other browsers. */
export function useCommentDraft(identifier: string, parentId?: string, quote = false) {
  const { operator } = useRouteContext({ from:'/app' });
  // Operator identities are workspace-specific, so the browser copy needs no
  // options read; a remounted composer (Current's default detail) starts no extra I/O.
  const key = `vector:comment-draft:${operator.id}:${identifier}:${parentId ?? (quote ? 'quote' : '')}`;
  const [content,setContent] = useState<Content>(empty), [ready,setReady] = useState(false), [message,setMessage] = useState('');
  const selected = useRef<DraftReference | null>(null), synced = useRef(JSON.stringify(empty)), latest = useRef<Content>(empty);
  const alive = useRef(true), posting = useRef(false), queue = useRef<Promise<unknown>>(Promise.resolve());
  const matches = (row: CommentDraft) => row.identifier === identifier && row.parentId === (parentId ?? null) && (row.anchor !== null) === quote;
  const show = (next: Content) => { latest.current = next; if (alive.current) setContent(next); };
  const apply = (draft: CommentDraft | null, notice: string) => {
    selected.current = draft ? { id:draft.id,revision:draft.revision } : null;
    const next = draft ? { body:draft.body,anchor:draft.anchor } : empty;
    synced.current = JSON.stringify(next); show(next);
    if (alive.current) setMessage(notice);
    try { localStorage.removeItem(key); } catch { /* Account custody is still available. */ }
  };
  const changed = (next: Content) => {
    show(next);
    try { localStorage.setItem(key,JSON.stringify({ ...next,reference:selected.current })); }
    catch { setMessage('This browser could not retain offline changes.'); }
  };
  const restore = (local: (Partial<Content> & {reference?: DraftReference}) | null) =>
    typeof local?.body === 'string' ? { body:local.body,anchor:quote ? local.anchor ?? null : null } : null;
  async function persist() {
    if (posting.current || !ready) return selected.current;
    const snapshot = latest.current, encoded = JSON.stringify(snapshot);
    if (encoded === synced.current || (!selected.current && !snapshot.body)) return selected.current;
    if (!selected.current) selected.current = {id:createUlid(new Date()),revision:0};
    const ref = selected.current, creating = ref.revision === 0;
    try {
      const receipt = await fetchJson(creating ? `/api/issues/${identifier}/comment-drafts` : '/api/comment-drafts/' + ref.id,
        commentDraftReceiptSchema,{ method:creating ? 'POST' : 'PATCH',headers:{'content-type':'application/json'},
          body:JSON.stringify({body:snapshot.body,...(snapshot.anchor ? {anchor:snapshot.anchor} : {}),
            ...(creating ? {id:ref.id,...(parentId ? {parentId} : {})} : {revision:ref.revision})}) });
      if (!receipt.draft) throw new Error('Unable to save comment draft.');
      selected.current = {id:receipt.draft.id,revision:receipt.draft.revision}; synced.current = encoded;
      try { localStorage.setItem(key,JSON.stringify({...latest.current,reference:selected.current})); } catch { /* The editor reports browser storage failures. */ }
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
      const draft = result.drafts.find(matches);
      let local: (Partial<Content> & {reference?: DraftReference}) | null = null;
      try { local = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* Ignore malformed browser metadata. */ }
      apply(draft ?? null,draft ? 'Restored your account comment draft.' : '');
      const offline = restore(local);
      if (offline && (draft ? local?.reference?.id === draft.id && local.reference.revision === draft.revision : !local?.reference)) changed(offline);
    }).catch(() => {
      if (canceled) return;
      try {
        const local = JSON.parse(localStorage.getItem(key) ?? 'null'), offline = restore(local);
        if (offline) { selected.current = local.reference ?? null; changed(offline); }
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
  }, [ready,content]);
  // A closed quote composer only reads on mount; open composers follow other devices.
  const following = !quote || content.anchor !== null;
  useEffect(() => {
    if (!ready || !following) return;
    let busy = false;
    const refresh = () => {
      if (busy || posting.current || document.hidden) return;
      busy = true;
      void queue.current.catch(() => undefined).then(async () => {
        const observed = selected.current;
        const result = await fetchJson('/api/comment-drafts',commentDraftsSchema);
        if (!alive.current || observed !== selected.current) return;
        const draft = result.drafts.find(matches);
        if (draft && (!observed || draft.id !== observed.id || draft.revision > observed.revision))
          apply(draft,'Showing the newer comment draft from another device.');
        else if (!draft && observed && observed.revision > 0) apply(null,'This comment draft was posted or discarded on another device.');
      }).catch(() => undefined).finally(() => { busy = false; });
    };
    const timer = setInterval(refresh,2000); window.addEventListener('focus',refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus',refresh); };
  }, [ready,following]);
  async function submit(mutate: (init: RequestInit,onSuccess: () => void) => Promise<void>, done?: () => void) {
    try {
      const reference = await flush(); posting.current = true;
      const { body, anchor } = latest.current;
      await mutate({method:'POST',headers:{'content-type':'application/json',...(reference ? {
        'x-vector-comment-draft-id':reference.id,'x-vector-comment-draft-revision':String(reference.revision)} : {})},
        body:JSON.stringify({body,...(parentId ? {parentId} : {}),...(anchor ? {anchor} : {})})},() => { apply(null,'Comment posted.'); done?.(); });
    } catch { /* Autosave reports its own error and retains the composer. */ }
    finally { posting.current = false; }
  }
  async function discard() {
    try {
      const ref = await flush();
      if (ref) await fetchJson('/api/comment-drafts/' + ref.id,commentDraftReceiptSchema,{method:'DELETE',
        headers:{'content-type':'application/json'},body:JSON.stringify({revision:ref.revision})});
      apply(null,ref ? 'Comment draft discarded.' : '');
    } catch { if (alive.current) setMessage('Unable to discard this draft. Review the current comment and try again.'); }
  }
  return {body:content.body,anchor:content.anchor,ready,message,submit,discard,
    setBody:(body: string) => changed({...latest.current,body}),
    setAnchor:(anchor: DescriptionAnchorInput) => changed({...latest.current,anchor})};
}
