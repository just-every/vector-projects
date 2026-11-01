import { z } from 'zod';
import type { AssignableRole } from '../../../roles/matrix';

/** The draft survives the round trip through the confirmation link (which may open in another tab), so the person only presses Send invitation again. */
const key = 'vector:invite-draft';
const schema = z.object({
  email: z.string(), displayName: z.string(), role: z.enum(['owner', 'admin', 'member', 'guest', 'viewer']).default('member'),
  teamIds: z.array(z.string()).default([]), at: z.number(),
});
export type InviteDraft = { email: string; displayName: string; role: AssignableRole; teamIds: string[] };

export function readInviteDraft(): InviteDraft | null {
  try {
    const parsed = schema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    return parsed.success && Date.now() - parsed.data.at < 30 * 60_000 ? parsed.data : null;
  } catch { return null; }
}
export function saveInviteDraft(draft: InviteDraft | null) {
  try { if (draft) localStorage.setItem(key, JSON.stringify({ ...draft, at: Date.now() })); else localStorage.removeItem(key); } catch { /* storage is a convenience */ }
}
