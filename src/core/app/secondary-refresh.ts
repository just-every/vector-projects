/** One visible-document clock for secondary reads; Current keeps its own clock. */
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
export function onSecondaryRefresh(refresh: () => void) {
  listeners.add(refresh);
  if (!stop) {
    const tick = () => {
      if (document.visibilityState === 'visible') for (const listener of listeners) listener();
    };
    const timer = window.setInterval(tick, 3000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    stop = () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
      stop = undefined;
    };
  }
  return () => { listeners.delete(refresh); if (!listeners.size) stop?.(); };
}

export function isSecondaryRead(url: string) {
  const { pathname } = new URL(url, 'http://vector.invalid');
  return pathname === '/api/favorites' || pathname === '/api/notifications/count' || pathname === '/api/mentions/options' ||
    pathname === '/api/notifications' ||
    /^\/api\/issues\/[A-Z][A-Z0-9_]{0,99}-[1-9][0-9]*(?:\/(?:subscription|reminders|references|discussion|reactions|email-intake))?$/.test(pathname);
}
