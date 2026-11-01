import type { ReactNode } from 'react';

/** The one fold: reference text sits behind its title, inside the item it explains. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return <details className="fold">
    <summary>{title}</summary>
    <div className="fold-body">{children}</div>
  </details>;
}
