import {TriageProvider,TriageCount} from '../../features/triage-responsibility/ui';
import { useHydrated } from '../initial-resources'
import { MobileAccount } from './mobile-account'
import { DeletionNotice } from '../../features/issue-deletion/receipt-notice'
import { IssueUndoNotice } from '../../features/issue-undo/ui/notice'
import { StreamPlanningProvider } from '../../features/streams/ui/stream-planning-state'
import type { ReactNode } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useRouteContext,
} from '@tanstack/react-router'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { productConfig } from '../config'
import { CommandPalette } from '../../features/search/ui/command-palette'
import {
  globalShortcut,
  isEditableTarget,
} from '../../features/search/ui/command-helpers'
import {
  NotificationProvider,
  InboxCount,
} from '../../features/notifications/ui/notification-context'
import { SavedViewNavigation } from '../../features/views/ui/saved-views'
import { SavedViewReceiptProvider } from '../../features/views/ui/saved-view-resource'
import { VectorMark } from './vector-mark'
import { documentReads, privateReads } from '../read-lifecycle'

type AppShellProps = { children: ReactNode }
const subscribeDocumentReads = (notify: () => void) =>
  documentReads!.subscribe(notify)
const documentNavigationPending = () => documentReads!.pending
const noDocumentNavigation = () => false
type NavigationItem = {
  to:
    | '/app'
    | '/app/my-work'
    | '/app/projects'
    | '/app/releases'
    | '/app/initiatives'
    | '/app/issues'
    | '/app/triage'
    | '/app/inbox'
    | '/app/board' | '/app/insights' | '/app/calendar'
  label: string
  icon: string
}

const navigation: NavigationItem[] = [
  { to: '/app', label: 'Current', icon: '◈' },
  { to: '/app/my-work', label: 'My work', icon: '◒' },
  { to: '/app/projects', label: 'Projects', icon: '◇' },
  { to: '/app/initiatives', label: 'Initiatives', icon: '◎' },
  { to: '/app/releases', label: 'Releases', icon: '◉' },
  { to: '/app/issues', label: 'Issues', icon: '▤' },
  { to: '/app/board', label: 'Board', icon: '▥' },
  { to: '/app/triage', label: 'Triage', icon: '▹' },
  { to: '/app/inbox', label: 'Inbox', icon: '▣' },
  { to: '/app/insights', label: 'Insights', icon: '▧' },
  { to: '/app/calendar', label: 'Calendar', icon: '▦' },
]

export function AppShell({ children }: AppShellProps) {
  const { operator } = useRouteContext({ from: '/app' })
  return (
    <SavedViewReceiptProvider key={operator.id}>
      <NotificationProvider>
        <TriageProvider><StreamPlanningProvider><AppShellContent>{children}</AppShellContent></StreamPlanningProvider></TriageProvider>
      </NotificationProvider>
    </SavedViewReceiptProvider>
  )
}

function AppShellContent({ children }: AppShellProps) {
  const { operator } = useRouteContext({ from: '/app' })
  const hydrated = useHydrated()
  const location = useLocation()
  const navigate = useNavigate()
  const mobileNavigation = useRef<HTMLDivElement>(null)
  const mobileViews = useRef<HTMLDetailsElement>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [accountError, setAccountError] = useState('')
  const navigationPending = useSyncExternalStore(
    subscribeDocumentReads,
    documentNavigationPending,
    noDocumentNavigation,
  )
  async function signOut() {
    if (privateReads.manuallyPaused) return
    window.dispatchEvent(new Event('vector:auth-lost'))
    privateReads.pause()
    setSigningOut(true)
    setAccountError('')
    try {
      await privateReads.settle()
      const response = await fetch('/auth/signout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      // Finish the revocation receipt before replacing this document.
      await response.text()
      if (!response.ok) throw new Error('Sign out failed. Try again.')
      window.location.assign('/signin')
    } catch (cause) {
      privateReads.resume()
      setAccountError(
        cause instanceof Error ? cause.message : 'Sign out failed.',
      )
      setSigningOut(false)
    }
  }
  const paletteTrigger = useRef<HTMLElement | null>(null)
  const awaitingGo = useRef(false)
  const goTimer = useRef<number | null>(null)
  const openPalette = (trigger?: HTMLElement | null) => {
    paletteTrigger.current =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null)
    setPaletteOpen(true)
  }
  const dismissPalette = () => {
    setPaletteOpen(false)
    window.setTimeout(() => paletteTrigger.current?.focus(), 0)
  }

  useEffect(() => {
    if (mobileViews.current) mobileViews.current.open = false
  }, [location.pathname])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const views = mobileViews.current
      if (views?.open && event.target instanceof Node && !views.contains(event.target)) views.open = false
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])

  useEffect(() => {
    const nav = mobileNavigation.current
    if (!nav) return
    const revealCurrent = () => {
      const current = nav.querySelector<HTMLElement>('.is-active')
      if (!current || !nav.clientWidth) return
      const left = current.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft
      nav.scrollTo({ left: left - (nav.clientWidth - current.offsetWidth) / 2 })
    }
    revealCurrent()
    const observer = new ResizeObserver(revealCurrent)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [location.pathname])

  useEffect(() => {
    const clearGo = () => {
      awaitingGo.current = false
      if (goTimer.current !== null) window.clearTimeout(goTimer.current)
      goTimer.current = null
    }
    const beginGo = () => {
      clearGo()
      awaitingGo.current = true
      goTimer.current = window.setTimeout(clearGo, 900)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (privateReads.paused) return
      if (paletteOpen && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        dismissPalette()
        return
      }
      if (paletteOpen) return
      if (event.target instanceof HTMLElement && event.target.closest('dialog, [role="dialog"]')) {
        clearGo()
        return
      }
      const action = globalShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        editable: isEditableTarget(
          event.target instanceof HTMLElement ? event.target : null,
        ),
        awaitingGo: awaitingGo.current,
      })
      if (!action) {
        clearGo()
        return
      }
      if (action === 'await-go') {
        beginGo()
        return
      }
      clearGo()
      event.preventDefault()
      if (action === 'open-palette') openPalette()
      if (action === 'new-issue') navigate({ to: '/app/new-issue' })
      if (action === 'go-current') navigate({ to: '/app' })
      if (action === 'go-my-work') navigate({ to: '/app/my-work' })
      if (action === 'go-projects') navigate({ to: '/app/projects' })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      clearGo()
    }
  }, [navigate, paletteOpen])

  return (
    <div className="app-shell" inert={signingOut}>
      <aside className="app-sidebar">
        <Link
          className="app-brand"
          to="/app"
          activeOptions={{ exact: true }}
          aria-label={`${productConfig.productName} Current`}
        >
          <VectorMark label={productConfig.productName} />
        </Link>
        <nav className="app-nav" aria-label="Workspace">
          {navigation.map((item) => (
            <NavLink key={item.to} item={item} pathname={location.pathname} />
          ))}
        </nav>
        <SavedViewNavigation />
        <div className="app-nav-actions">
          <Link
            className={`app-nav-link${location.pathname === '/app/settings' ? ' is-active' : ''}`}
            to="/app/settings"
            aria-current={
              location.pathname === '/app/settings' ? 'page' : undefined
            }
          >
            <span aria-hidden="true">⚙</span>
            <span>Settings</span>
          </Link>
          <button
            type="button"
            className="app-search-trigger"
            aria-haspopup="dialog"
            aria-expanded={paletteOpen}
            onClick={(event) => openPalette(event.currentTarget)}
          >
            <span aria-hidden="true">⌕</span>
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <Link className="app-new-issue-link" to="/app/new-issue">
            ＋ New issue
          </Link>
        </div>
        <div className="app-sidebar-foot">
          <span className="app-avatar" aria-hidden="true">
            {operator.name
              .split(' ')
              .map((part) => part[0])
              .join('')
              .slice(0, 2)}
          </span>
          <span className="app-owner-name">{operator.name}</span>
          <button
            type="button"
            disabled={!hydrated || signingOut}
            onClick={() => void signOut()}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
      <div className="app-stage">
        <div className="app-settings-mobile">
          <Link className="app-mobile-brand" to="/app" activeOptions={{ exact: true }}>
            <VectorMark label={productConfig.productName} />
          </Link>
          <details ref={mobileViews} className="app-mobile-views" onClick={event => {
            if (event.target instanceof Element && event.target.closest('.saved-view-navigation a')) event.currentTarget.open = false
          }} onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary')?.focus()
            }
          }}>
            <summary>Saved views</summary>
            <SavedViewNavigation />
          </details>
          <MobileAccount name={operator.name} pathname={location.pathname} signingOut={signingOut}
            onSignOut={() => void signOut()} />
        </div>
        {accountError && (
          <p className="app-account-error" role="alert">
            {accountError}
          </p>
        )}
        {navigationPending && !signingOut && (
          <div className="app-navigation-pending" role="status">
            <span>
              Opening another page… If you cancelled navigation, reload to
              resume updates.
            </span>
            <button
              type="button"
              autoFocus
              onClick={() => documentReads!.reload()}
            >
              Reload this page
            </button>
          </div>
        )}
        <DeletionNotice />
        <IssueUndoNotice />
        {children}
      </div>
      <nav className="app-mobile-nav" aria-label="Workspace">
        <div className="app-mobile-places-row">
          <NavLink item={navigation[0]!} pathname={location.pathname} />
          <div ref={mobileNavigation} className="app-mobile-places">
            {navigation.filter(item => item.to !== '/app' && item.to !== '/app/inbox').map(item => (
              <NavLink key={item.to} item={item} pathname={location.pathname} />
            ))}
          </div>
        </div>
        <div className="app-mobile-daily">
        <button
          type="button"
          className={`app-nav-link${location.pathname === '/app/search' ? ' is-active' : ''}`}
          aria-current={location.pathname === '/app/search' ? 'page' : undefined}
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
          onClick={(event) => openPalette(event.currentTarget)}
        >
          <span aria-hidden="true">⌕</span>
          <span>Search</span>
        </button>
        <NavLink item={navigation.find(item => item.to === '/app/inbox')!} pathname={location.pathname} />
        <Link
          className={`app-nav-link${location.pathname.startsWith('/app/new-issue') ? ' is-active' : ''}`}
          to="/app/new-issue"
          aria-current={location.pathname.startsWith('/app/new-issue') ? 'page' : undefined}
        >
          <span aria-hidden="true">＋</span>
          <span>New issue</span>
        </Link>
        </div>
      </nav>
      {paletteOpen ? <CommandPalette onDismiss={dismissPalette} /> : null}
    </div>
  )
}

function NavLink({
  item,
  pathname,
}: {
  item: NavigationItem
  pathname: string
}) {
  const active =
    item.to === '/app'
      ? pathname === '/app' || pathname.startsWith('/app/current')
      : pathname.startsWith(item.to)
  return (
    // The shell decides which place is current; the router's prefix match would mark Current on every page.
    <Link
      className={`app-nav-link${active ? ' is-active' : ''}`}
      to={item.to}
      activeOptions={{ exact: true }}
      aria-current={active ? 'page' : undefined}
    >
      <span aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
      {item.to === '/app/inbox' && <InboxCount />}
      {item.to === '/app/triage' && <TriageCount />}
    </Link>
  )
}
