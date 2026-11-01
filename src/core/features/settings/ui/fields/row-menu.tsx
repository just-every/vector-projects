import { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../../../../ui/tooltip';

export type RowMenuItem = { label: string; onSelect: () => void } | { note: string };

/** The "…" on a row: a short menu with a 2–4-word tooltip on hover and focus. Escape and an outside click close it. */
export function RowMenu({ name, items }: { name: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="row-menu" ref={root}>
    <Tooltip label="More actions">
      <button ref={trigger} type="button" className="row-action row-menu-trigger" aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(value => !value)}><span aria-hidden="true">…</span></button>
    </Tooltip>
    {open && <div className="row-menu-list" role="menu" aria-label={`Actions for ${name}`}>
      {items.map(item => 'note'in item
        ? <p key={item.note} className="row-menu-note">{item.note}</p>
        : <button key={item.label} type="button" role="menuitem" autoFocus={items[0] === item} onClick={() => { setOpen(false); item.onSelect(); }}>{item.label}</button>)}
    </div>}
  </div>;
}
