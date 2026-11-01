import { Disclosure } from '../fields/disclosure';

/** One line per role, from the role matrix (ROLE-001). */
export function RolesFold() {
  return <Disclosure title="How roles work">
    <p><strong>Owner</strong> · Everything, including inviting, promoting and removing Owners and Admins.</p>
    <p><strong>Admin</strong> · Manages the workspace, teams and Members, Guests and Viewers, but not Owners or Admins.</p>
    <p><strong>Member</strong> · Works in their teams and sees every public team.</p>
    <p><strong>Guest</strong> · Works only in the teams they are invited to.</p>
    <p><strong>Viewer</strong> · Reads every public team and the private teams you choose, and cannot change work.</p>
    <p>Anyone can leave. The installation owner stays an Owner, and the last Owner cannot be demoted or removed.</p>
  </Disclosure>;
}
