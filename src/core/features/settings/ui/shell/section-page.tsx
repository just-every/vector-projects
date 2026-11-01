import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { wantIndexScroll } from './index-scroll';
import type { SectionPath } from './sections';

/**
 * One Settings page: "‹ Settings" (phone), a breadcrumb (desktop, record pages), the title, then the body.
 * Pages not yet rebuilt render their existing panel inside `legacy`, which keeps its own look.
 */
export function SectionPage({ title, parent, record, legacy = false, children }: {
  title: string;
  parent?: { label: string; to: SectionPath };
  record?: string;
  legacy?: boolean;
  children: ReactNode;
}) {
  return <article className="settings-section" aria-labelledby="settings-title">
    {parent
      ? <Link className="settings-back" to={parent.to}>‹ {parent.label}</Link>
      : <Link className="settings-back" to="/app/settings" resetScroll={false} onClick={wantIndexScroll}>‹ Settings</Link>}
    {parent && record && <nav className="settings-crumbs" aria-label="Breadcrumb">
      <Link to={parent.to}>{parent.label}</Link><span aria-hidden="true">›</span><span aria-current="page">{record}</span>
    </nav>}
    <h1 id="settings-title">{title}</h1>
    {legacy ? <div className="settings-page settings-legacy">{children}</div> : children}
  </article>;
}

export function Skeleton() {
  return <div className="settings-skeleton" aria-busy="true" aria-label="Loading"><span /><span /><span /></div>;
}

/** The quiet line for a record that does not exist: never a blank page. */
export function NotFoundLine({ what, back }: { what: string; back: { label: string; to: SectionPath } }) {
  return <p className="settings-notfound" role="status">{what} was not found. <Link to={back.to}>Back to {back.label}</Link></p>;
}
