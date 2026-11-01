import { Link } from '@tanstack/react-router';
import { ApiError } from '../../../../app/api-client';
import { SectionPage, Skeleton } from './section-page';
import { sectionByKey, type SectionKey } from './sections';
import { useSettingsShell } from './settings-context';

/** Shows a section's page only to a role that may open it; otherwise one plain line and a way on. */
export function SectionGate({ section, title, children }: { section: SectionKey; title: string; children: React.ReactNode }) {
  const shell = useSettingsShell();
  if (shell.role === null) {
    if (shell.error) return <SectionPage title={title}><LoadFailure /></SectionPage>;
    return <SectionPage title={title}><Skeleton /></SectionPage>;
  }
  if (!shell.open.includes(section)) return <Denied title={title} />;
  return <>{children}</>;
}

export function Denied({ title }: { title: string }) {
  const { open } = useSettingsShell();
  const first = open.length ? sectionByKey(open[0]!) : null;
  return <SectionPage title={title}>
    <p className="settings-denied" role="status">
      You can’t open this page. {first ? <Link to={first.path}>Go to {first.label}</Link> : <Link to="/app">Back to Current</Link>}
    </p>
  </SectionPage>;
}

export function LoadFailure() {
  const { error, reload } = useSettingsShell();
  if (error instanceof ApiError && error.status === 401) return <p role="alert">You’re signed out. <Link to="/signin">Sign in again</Link></p>;
  return <p role="alert" className="settings-load-failure">Couldn’t load settings · <button type="button" className="field-retry" onClick={reload}>Retry</button></p>;
}
