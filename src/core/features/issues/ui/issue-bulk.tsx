import { useState } from "react";
import type { WorkspaceOptions } from "../../../shared/workspace-options";
import { issueEditFields, type IssueEditField, type IssueEditTarget } from "./issue-keyboard-actions";
import { IssueKeyboardDialog } from "./issue-keyboard-dialog";

export function IssueBulk({ selection, options, onRefresh, onClear, onRemove, onSuccess }: {
  selection: Map<string, IssueEditTarget>;
  options: WorkspaceOptions | null;
  onRefresh: () => void;
  onClear: () => void;
  onRemove: (identifier: string) => void;
  onSuccess: (issues: Array<{ identifier: string; version: number }>) => void;
}) {
  const [field, setField] = useState<IssueEditField>("priority");
  const [targets, setTargets] = useState<IssueEditTarget[] | null>(null);
  const [message, setMessage] = useState("");
  const rows = [...selection.values()];
  if (!rows.length || options?.operator.role === 'viewer') return null;
  const cyclesEnabled = rows.every(row => options?.teams.some(team => team.id === row.team.id && team.cyclesEnabled));
  const activeField = field === "cycleId" && !cyclesEnabled ? "priority" : field;
  return (
    <section className="issues-bulk" aria-label="Bulk edit">
      <strong>{rows.length} selected</strong>
      <button onClick={onClear}>Clear selection</button>
      <details className="bulk-selection">
        <summary>Selected issues</summary>
        <ul>{rows.map((row) => <li key={row.identifier}>
          {row.identifier} <button onClick={() => onRemove(row.identifier)} aria-label={`Remove ${row.identifier} from selection`}>Remove</button>
        </li>)}</ul>
      </details>
      <label>Change
        <select aria-label="Change" value={activeField} onChange={(event) => setField(event.target.value as IssueEditField)}>
          {Object.entries(issueEditFields).filter(([id]) => id !== "cycleId" || cyclesEnabled).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <button disabled={!options || rows.length > options.bulkEditIssuesPerOperation}
        onClick={() => { setMessage(""); setTargets(rows); }}>Edit selected</button>
      {options && rows.length > options.bulkEditIssuesPerOperation && <p role="alert">Select at most {options.bulkEditIssuesPerOperation} issues.</p>}
      {message && <p role="status">{message}</p>}
      {targets && <IssueKeyboardDialog field={activeField} targets={targets} options={options} onClose={() => setTargets(null)}
        onSuccess={(receipt) => {
          onSuccess(receipt.issues);
          setMessage(`${receipt.changed} issues updated.`);
          setTargets(null);
          onRefresh();
        }} />}
    </section>
  );
}
