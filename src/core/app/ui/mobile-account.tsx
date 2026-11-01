import { useHydrated } from '../initial-resources'
import { Link } from '@tanstack/react-router'
import { inSettings } from './settings-path'
import { useEffect, useId, useRef, useState } from 'react'

export function MobileAccount({ name, pathname, signingOut, onSignOut }: {
  name: string
  pathname: string
  signingOut: boolean
  onSignOut: () => void
}) {
  const hydrated = useHydrated()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div className="app-mobile-account" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
  }}>
    <button ref={trigger} className="app-mobile-account-trigger" type="button"
      disabled={!hydrated || signingOut} aria-expanded={open} aria-controls={id} aria-label={`${name} account`}
      onClick={() => setOpen(value => !value)}>
      <span>{name}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div id={id} className="app-mobile-account-menu">
      <Link to="/app/settings" aria-current={inSettings(pathname) ? 'page' : undefined}
        onClick={() => setOpen(false)}>Settings</Link>
      <button type="button" disabled={signingOut} onClick={onSignOut}>
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>}
  </div>
}
