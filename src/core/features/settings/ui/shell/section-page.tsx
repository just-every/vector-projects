import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { wantIndexScroll } from './index-scroll';
import type { SectionPath } from './sections';

/**
 * One Settings page: "‹ Settings" (phone), a breadcrumb (desktop, record pages), the title with its one quiet
 * action, an optional meta line, then the body. Pages not yet rebuilt render their existing panel inside `legacy`.
 */
export function SectionPage({ title, parent, record, action, sub, legacy = false, children }: {
  title: string;
  parent?: { label: string; to: SectionPath };
  record?: string;
  /** The page's one opener (Invite, New team, New label), beside the title. */
  action?: ReactNode;
  /** A quiet line under the title: a person's email, a team's key and size. */
  sub?: ReactNode;
  legacy?: boolean;
  children: ReactNode;
}) {
  return <article className="settings-section" aria-labelledby="settings-title">
    {parent
      ? <Link className="settings-back" to={parent.to} resetScroll={false}>‹ {parent.label}</Link>
      : <Link className="settings-back" to="/app/settings" resetScroll={false} onClick={wantIndexScroll}>‹ Settings</Link>}
    {parent && record && <nav className="settings-crumbs" aria-label="Breadcrumb">
      <Link to={parent.to} resetScroll={false}>{parent.label}</Link><span aria-hidden="true">›</span><span aria-current="page">{record}</span>
    </nav>}
    <div className="settings-head">
      <h1 id="settings-title">{title}</h1>
      {action}
    </div>
    {sub && <p className="settings-sub">{sub}</p>}
    {legacy ? <div className="settings-page settings-legacy">{children}</div> : children}
  </article>;
}

export function Skeleton() {
  return <div className="settings-skeleton" role="status" aria-busy="true" aria-label="Loading"><span /><span /><span /></div>;
}

/** The quiet line for a record that does not exist: never a blank page. */
export function NotFoundLine({ what, back }: { what: string; back: { label: string; to: SectionPath } }) {
  return <p className="settings-notfound" role="status">{what} was not found. <Link to={back.to}>Back to {back.label}</Link></p>;
}
