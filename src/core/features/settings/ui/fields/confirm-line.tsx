import { useState, type ReactNode } from 'react';
import { ApiError } from '../../../../app/api-client';

/**
 * The one ask under a control with an outside effect (Remove, Archive, Delete, Merge, Send invitation).
 * A refused answer stays under the buttons; pressing the confirm button again tries once more.
 */
export function ConfirmLine({ question, detail, confirm, danger = false, onConfirm, onCancel, children }: {
  question: string;
  detail?: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
  /** An input the confirmation needs first, such as a destination. */
  children?: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function run() {
    setPending(true); setError('');
    try { await onConfirm(); }
    catch (cause) { setError(cause instanceof ApiError || cause instanceof Error ? cause.message : 'That could not be done.'); }
    finally { setPending(false); }
  }
  return <div className="confirm-line" role="group" aria-label={question}>
    <p className="confirm-question">{question}</p>
    {detail && <p className="confirm-detail">{detail}</p>}
    {children}
    <div className="confirm-actions">
      <button type="button" className={danger ? 'button-danger' : 'button-ink'} autoFocus disabled={pending} onClick={() => void run()}>{confirm}</button>
      <button type="button" className="button-text" disabled={pending} onClick={onCancel}>Cancel</button>
    </div>
    {error && <p className="confirm-error" role="alert">{error}</p>}
  </div>;
}
