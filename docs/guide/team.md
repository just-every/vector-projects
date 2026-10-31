# Your team and settings

## Invite people

Open **Settings → Members** and invite people by email. Each invitation names a role: **Owner**, **Admin** or **Member** (the default). Owners and Admins invite and remove Members; only Owners invite, promote or remove Owners and Admins, and an Owner or Admin can let Members invite other Members. Members create and change work in every team, and change a team's settings where they own the team or where its owners let every member manage them. They sign in with a single-use link sent to their email address. A changed role applies from their next click, without signing them out.

Removing someone signs them out everywhere, cancels their unused links and invitations, and keeps their past work in the history. The person who installed Vector stays an Owner, and the last Owner can't be demoted or removed.

## Workspace time

Settings sets the workspace timezone. Cycles and due dates use it.

## Teams and workflows

Each team has its own identifier prefix (like `FLW`) and its own workflow. A new team starts with Intake, Backlog, Unstarted, Started, Completed, Canceled and Duplicate. You can add, rename and reorder statuses; removing one asks which status its issues should move to. Archiving a team keeps all its issues and history and stops new work going to it. Only Owners, Admins and the team's owners archive or unarchive a team, whatever else the team lets its members manage.

## Labels

Owners and Admins create, rename, recolour and delete labels in **Settings → Labels**. Merging a workspace label into another rewrites issues, projects and saved-view filters in one transaction. A destination used by projects must have project use enabled. Deleting a label removes it from issues and from saved views.

Owners and Admins can also create **Label groups** in Settings → Labels, for example Area or Type, and choose a group in each label's editor. An issue carries at most one label from a group: the issue Labels picker offers no second label once one is chosen, and creating, editing, bulk editing, copying, undoing or importing an issue with two labels of one group is refused with nothing changed. Putting labels in a group, or merging a label, is refused while an issue would end up with two labels of the group. Deleting a group keeps its labels, ungrouped. Guests apply existing labels in their invited teams, Members and Viewers cannot manage groups, and team-scoped labels and groups are not available yet.

Members can open **Settings → Labels** to read workspace label names and colours. This read-only list offers no creation, rename, recolour or deletion controls; workspace label management remains with Owners and Admins. Members create labels from an issue’s Labels picker instead. Owners and Admins can change **Who may create labels** in Settings → Labels to restrict creation to themselves; the next browser, session or scoped API creation request follows that permission.

## Notifications

Each person chooses which notifications reach their Inbox and whether assignments and mentions also arrive by email. See [Notifications and email](notifications.md).

Owners and Admins choose **Who may create teams** in Settings → Teams. The default is **Owners and Admins only**. With **Members too**, a Member can create a public team and becomes its first team owner. Restoring the default refuses their next creation request without changing teams already created. Guests cannot create teams. The browser, session and scoped API doors use the same current permission.

A public team can use **Open** membership or **Invite only**. Owners, Admins and that team’s owners choose the mode and can explicitly enable membership requests. An invite-only team refuses immediate self-joining; requesting creates a pending request without membership. The team’s owners and Admins approve or decline requests, and repeated approval has no further effect. Public work remains workspace-visible under either mode. Guests never self-join or request.
