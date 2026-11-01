import { useEffect } from 'react';

/**
 * A list remembers where it was scrolled when a record is opened from it, and gives that back once it shows again
 * (the record's "‹ People" link, the breadcrumb or the browser's Back).
 */
const remembered = new Map<string, number>();
export const rememberListScroll = (list: string) => { remembered.set(list, window.scrollY); };

/** Call with `ready` true once the list's rows are on the page; the saved position is used once. */
export function useRestoreListScroll(list: string, ready = true) {
  useEffect(() => {
    const top = remembered.get(list);
    if (!ready || top === undefined) return;
    // After the router has finished its own scroll handling for the navigation; used once.
    const timer = window.setTimeout(() => { remembered.delete(list); window.scrollTo(0, top); }, 60);
    return () => window.clearTimeout(timer);
  }, [list, ready]);
}
