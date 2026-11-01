import { useState, type FormEvent } from "react";
import { z } from "zod";
import { fetchJson } from "../../../app/api-client";
import { matrix, type AssignableRole, type Role } from "../../roles/matrix";
import { settingsSchema } from "../schema";
import { MemberRoleForm } from "./member-role-form";
import { InviteOperator } from "./invite-operator";

type Settings = z.infer<typeof settingsSchema>;
type Member = Settings["operators"][number];
export const roleLabels: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest", viewer: "Viewer" };

/** What the viewer's role allows here (ROLE-001, OPS-002). The server decides
 * every request; these controls only show the choices it will accept. */
export function memberControls(data: Settings) {
  const viewer = data.role;
  const leads = matrix["leaders.manage"].cells[viewer] === "yes";
  const manages = matrix["members.manage"].cells[viewer] === "yes";
  const memberInvites = matrix["members.manage"].cells[viewer] === "member-invites" && data.workspace.memberInvites;
  return {
    leads,
    manages,
    inviteRoles: (leads ? ["member", "guest", "viewer", "admin", "owner"] : manages ? ["member","guest","viewer"] : memberInvites ? ["member"] : []) as AssignableRole[],
    removable: (member: Member) => member.id === data.operatorId
      || (leads && member.id !== data.workspace.setupOperatorId)
      || (manages && (member.role === "member" || member.role === "guest" || member.role === "viewer")),
  };
}

export function MembersPanel({ data, denied, onChanged }: { data: Settings; denied: boolean; onChanged: () => void }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Results show beside the member controls, where the change was made.
  const [message, setMessage] = useState("");
  const controls = memberControls(data);
  // The last Owner stays (ROLE-001); demoting them is answered by the server.
  const lastOwner = (member: Member) => member.role === "owner" && data.operators.filter((other) => other.role === "owner").length === 1;
  async function act(run: () => Promise<unknown>, done: string) {
    setPending(true); setMessage("");
    try { await run(); setMessage(done); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "The change could not be saved."); return false; }
    finally { setPending(false); onChanged(); }
  }
  const remove = async () => {
    if (!removing) return;
    const self = removing === data.operatorId;
    await act(async () => {
      const result = await fetchJson("/api/settings/operators/" + removing, z.object({ removed: z.boolean(), signedOut: z.boolean() }), { method: "DELETE" });
      if (result.signedOut) window.location.assign("/signin");
      setRemoving(null);
    }, self ? "You left the workspace." : "Member removed. Their sessions are revoked.");
  };
  const changeRole = (member: Member) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget, fields = new FormData(form), role = String(fields.get("role"));
    const teamIds = fields.getAll("teamIds").map(String);
    // A refused change shows the member's actual role again.
    if (!await act(() => fetchJson(`/api/settings/operators/${member.id}/role`, settingsSchema, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, ...(['guest','viewer'].includes(role) ? {teamIds} : {}) }),
    }), `${member.name} is now ${role === "admin" ? "an" : "a"} ${roleLabels[role as Role]}.`)) form.reset();
  };
  return (
    <section id="members" aria-labelledby="members-heading">
      <h2 id="members-heading">Members</h2>
      <p>
        Each member has one role. Owners and Admins invite and remove Members, Guests and Viewers; only Owners invite, promote or remove
        Owners and Admins. Anyone can leave. The installation owner stays an Owner, and the last Owner cannot be demoted or removed.
      </p>
      {!data.workspace.setupOperatorId && (
        <p role="alert">
          Ask the person who deployed Vector to finish owner setup before
          removing members. They can run the setup command in DEPLOY.md
          and set the first owner’s email (FIRST_OWNER_EMAIL).
        </p>
      )}
      <ul className="settings-members">
        {data.operators.map((member) => {
          const own = member.id === data.operatorId;
          return (
            <li key={member.id}>
              <div>
                <strong>{member.name}{own ? " (you)" : ""}</strong>
                <span>{member.email}</span>
                <span className="settings-role">{roleLabels[member.role]}{member.id === data.workspace.setupOperatorId ? " · Installation owner" : ""}</span>
              </div>
              {(controls.leads || controls.manages && ['member','guest','viewer'].includes(member.role)) && (
                <MemberRoleForm key={member.role + member.teamIds.join(',')} member={member} teams={data.teams}
                  roles={controls.leads ? ['owner','admin','member','guest','viewer'] : ['member','guest','viewer']}
                  disabled={pending || denied} onSubmit={changeRole(member)} />
              )}
              {controls.removable(member) && (
                <button type="button" disabled={pending || denied || !data.workspace.setupOperatorId || lastOwner(member)}
                  onClick={() => { setRemoving(member.id); setMessage(""); }}>
                  Remove {member.name}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {removing && (
        <div className="settings-confirm" role="group" aria-label="Confirm member removal">
          <p>
            {removing === data.operatorId ? "Leave this workspace? Your sessions will end." : "Remove this member? Their sessions will end."} Open
            issues will be unassigned, and projects and shared views will transfer. Retained history will show an anonymous member.
          </p>
          <button autoFocus disabled={pending} type="button" onClick={remove}>Confirm removal</button>
          <button disabled={pending} type="button" onClick={() => setRemoving(null)}>Cancel</button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {controls.inviteRoles.length ? (
        <InviteOperator teams={data.teams} delivery={data.invitationDelivery} roles={controls.inviteRoles} disabled={pending || denied} onInvited={onChanged} />
      ) : (
        <p>Only Owners and Admins invite people{data.workspace.memberInvites ? "" : " unless they let Members invite Members"}.</p>
      )}
    </section>
  );
}
