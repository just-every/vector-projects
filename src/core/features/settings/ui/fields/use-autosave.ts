import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../../app/api-client';
import { registerUnsaved } from './unsaved';

/** A refusal worded for the person (not a network failure): its text is shown under the field. */
export class Refusal extends Error {}

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
const savedFor = 2200;

/**
 * One field's save model, shared by every Settings control:
 * - the field shows its own draft while it is being edited, saved or refused, and the server value otherwise,
 *   so a background refresh merges only untouched fields and never needs a re-key;
 * - `commit` stores a value (selects and switches on change, text on blur or Enter);
 * - a refused save keeps the value, `retry` resubmits exactly that value;
 * - `save` must publish the stored value to its owning resource before it resolves, so no stale read flashes back.
 */
export function useAutosave<T>({ value, save, label, same = Object.is }: {
  value: T;
  save: (next: T) => Promise<unknown>;
  label: string;
  same?: (a: T, b: T) => boolean;
}) {
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const [reason, setReason] = useState('');
  const sequence = useRef(0);
  const inflight = useRef<Promise<boolean> | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef({ draft, state, value, save, same });
  live.current = { draft, state, value, save, same };

  useEffect(() => () => clearTimeout(fade.current), []);

  const commit = useCallback((next?: T): Promise<boolean> => {
    const { draft: current, value: stored, save: store, same: equal } = live.current;
    const target = next !== undefined ? next : current?.value;
    if (target === undefined) return Promise.resolve(true);
    if (live.current.state !== 'failed' && equal(target, stored) && !inflight.current) {
      setDraft(null);
      return Promise.resolve(true);
    }
    const run = ++sequence.current;
    clearTimeout(fade.current);
    setDraft({ value: target });
    setState('saving');
    setReason('');
    let attempt!: Promise<boolean>;
    attempt = (async () => {
      try {
        await store(target);
        if (run !== sequence.current) return true;
        setDraft(null);
        setState('saved');
        fade.current = setTimeout(() => setState(now => (now === 'saved' ? 'idle' : now)), savedFor);
        return true;
      } catch (cause) {
        if (run === sequence.current) {
          setState('failed');
          setReason(cause instanceof ApiError || cause instanceof Refusal ? cause.message : '');
        }
        return false;
      } finally {
        if (inflight.current === attempt) inflight.current = null;
      }
    })();
    inflight.current = attempt;
    return attempt;
  }, []);

  const edit = useCallback((next: T) => {
    clearTimeout(fade.current);
    setDraft({ value: next });
    setState(now => (now === 'saving' ? now : 'idle'));
  }, []);

  const unsaved = draft !== null;
  useEffect(() => {
    if (!unsaved) return;
    return registerUnsaved({
      label,
      failed: () => live.current.state === 'failed',
      flush: retry => {
        if (inflight.current) return inflight.current;
        if (live.current.state === 'failed' && !retry) return Promise.resolve(false);
        return commit();
      },
    });
  }, [unsaved, label, commit]);

  return {
    shown: draft ? draft.value : value,
    state,
    reason,
    failed: state === 'failed',
    edit,
    commit,
    retry: () => commit(),
  };
}
