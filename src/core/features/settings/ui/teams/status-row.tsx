import { useState, type DragEvent } from 'react';
import type { Administration } from '../../../administration/schema';
import { Tooltip } from '../../../../ui/tooltip';
import { RowMenu } from '../fields/row-menu';
import { RenameStatus } from './rename-status';
import { RemoveStatusAsk } from './remove-status-ask';
import { categoryNames, type Status } from './workflow-groups';

type Team = Administration['teams'][number];
export type Drag = { id: string | null; set: (id: string | null) => void; drop: (target: string) => void; step: (id: string, step: -1 | 1) => void };

/** One status: a drag handle, its name, and a "…" with Rename and Remove…. A read-only workflow is just the name. */
export function StatusRow({ team, status, sameCategory, isDefault, editable, drag }: {
  team: Team; status: Status; sameCategory: Status[]; isDefault: boolean; editable: boolean; drag: Drag;
}) {
  const [mode, setMode] = useState<'rename' | 'remove' | null>(null);
  const others = sameCategory.filter(other => other.id !== status.id);
  if (!editable) return <li className="status-row"><span className="status-name">{status.name}</span>{isDefault && <span className="row-meta">Default for {categoryNames[status.category]}</span>}</li>;
  const items = [
    { label: 'Rename', onSelect: () => setMode('rename') },
    ...(others.length ? [{ label: 'Remove…', onSelect: () => setMode('remove') }] : [{ note: 'This category’s last status cannot be removed.' }]),
  ];
  const dragStart = (event: DragEvent) => { event.dataTransfer.setData('text/plain', status.id); event.dataTransfer.effectAllowed = 'move'; drag.set(status.id); };
  return <li className="status-row row-hover" data-dragging={drag.id === status.id || undefined} data-mode={mode ?? undefined}
    onDragOver={event => { if (drag.id && drag.id !== status.id) event.preventDefault(); }}
    onDrop={event => { event.preventDefault(); drag.drop(status.id); }}>
    <div className="status-line">
      <Tooltip label="Drag to reorder">
        <button type="button" className="status-handle" draggable aria-label={`Reorder ${status.name}`} onDragStart={dragStart} onDragEnd={() => drag.set(null)}
          onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); drag.step(status.id, event.key === 'ArrowUp' ? -1 : 1); } }}>
          <span aria-hidden="true">⋮⋮</span>
        </button>
      </Tooltip>
      {mode === 'rename'
        ? <RenameStatus team={team} status={status} onDone={() => setMode(null)} />
        : <span className="status-name">{status.name}</span>}
      {isDefault && mode !== 'rename' && <span className="row-meta status-default">Default</span>}
      <RowMenu name={status.name} items={items} />
    </div>
    {mode === 'remove' && <RemoveStatusAsk team={team} status={status} choices={others} onCancel={() => setMode(null)} />}
  </li>;
}
