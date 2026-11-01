import { useRef } from 'react';

/**
 * Saves that rebuild one stored record from several fields (every field sends the whole record) go one after another,
 * each built on the answer the last one stored, so two quick changes in different fields never overwrite each other.
 * The refreshed value takes over again once its receipt has landed.
 */
export function useSerialSaves<T>(current: T) {
  const latest = useRef(current);
  latest.current = current;
  const stored = useRef<{ value: T; at: number } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return (job: (base: T) => Promise<T>) => {
    const run = queue.current.catch(() => undefined).then(async () => {
      const base = stored.current && Date.now() - stored.current.at < 3000 ? stored.current.value : latest.current;
      stored.current = { value: await job(base), at: Date.now() };
    });
    queue.current = run;
    return run;
  };
}
