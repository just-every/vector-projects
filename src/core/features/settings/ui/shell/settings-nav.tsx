import { Link } from '@tanstack/react-router';
import { rememberIndexScroll } from './index-scroll';
import { RowLine } from './row-lines';
import { sectionOfPath, sections, type SectionGroup, type SectionKey } from './sections';

const groups: SectionGroup[] = ['You', 'Workspace', 'Connect', 'Data'];

/**
 * The one section list. Beside a readable pane it is the rail; on a narrow screen the same list is the index page,
 * with one live line per row (the switch is CSS). A role sees only the sections it may open; an empty group is absent.
 */
export function SettingsNav({ open, pathname, lines, loading, rail }: {
  open: readonly SectionKey[]; pathname: string; lines: boolean; loading: boolean; rail: boolean;
}) {
  // On the phone index no row is current: the list is the page. Beside the pane the open section is.
  const current = !rail && pathname === '/app/settings' ? null : sectionOfPath(pathname);
  return <nav className="settings-nav" aria-label="Settings sections">
    <h2 className="settings-nav-title">Settings</h2>
    {loading && <div className="settings-skeleton" aria-busy="true" aria-label="Loading"><span /><span /><span /></div>}
    {groups.map(group => {
      const items = sections.filter(section => section.group === group && open.includes(section.key));
      if (!items.length) return null;
      return <section key={group} className="settings-nav-group" aria-label={group}>
        <p className="settings-nav-heading" aria-hidden="true">{group}</p>
        <ul>
          {items.map(item => <li key={item.key}>
            <Link to={item.path} className="settings-nav-link" onClick={rememberIndexScroll} aria-current={current === item.key ? 'page' : undefined}>
              <span className="settings-nav-name">{item.label}</span>
              {lines && <RowLine section={item.key} />}
              <span className="settings-nav-chevron" aria-hidden="true">›</span>
            </Link>
          </li>)}
        </ul>
      </section>;
    })}
  </nav>;
}
