import { useState } from 'react';
import type { Administration } from '../../../administration/schema';
import { RowMenu } from '../fields/row-menu';
import { DeleteAsk, MergeAsk } from './label-asks';
import { LabelEditor } from './label-editor';

type Label = Administration['labels'][number];
const usage = (label: Label) => (label.projectsEnabled ? 'Used for issues and projects' : 'Used for issues');

function Head({ label }: { label: Label }) {
  return <>
    <span className="label-dot" style={{ background: label.color }} aria-hidden="true" />
    <span className="row-main"><span className="row-name">{label.name}</span><span className="row-meta">{usage(label)}</span></span>
  </>;
}

/** A label the viewer only reads: its dot, name and usage line. */
export function ReadOnlyLabel({ label }: { label: Label }) {
  return <li className="label-row"><div className="label-head"><Head label={label} /></div></li>;
}

/** A label the viewer manages: opens in place (on the sunk tone), with a "…" for Merge into… and Delete. */
export function ManagedLabel({ label, labels }: { label: Label; labels: Label[] }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<'merge' | 'delete' | null>(null);
  const others = labels.filter(other => other.id !== label.id);
  const items = [
    ...(others.length ? [{ label: 'Merge into…', onSelect: () => { setOpen(true); setAsk('merge'); } }] : []),
    { label: 'Delete', onSelect: () => { setOpen(true); setAsk('delete'); } },
  ];
  return <li className="label-row row-hover" data-open={open || undefined}>
    <div className="label-head">
      <button type="button" className="label-toggle" aria-expanded={open} aria-label={label.name} onClick={() => { setOpen(value => !value); setAsk(null); }}><Head label={label} /></button>
      <RowMenu name={label.name} items={items} />
    </div>
    {open && <div className="label-body">
      <LabelEditor label={label} />
      {ask === 'merge' && <MergeAsk label={label} others={others} onCancel={() => setAsk(null)} />}
      {ask === 'delete' && <DeleteAsk label={label} onCancel={() => setAsk(null)} />}
    </div>}
  </li>;
}
