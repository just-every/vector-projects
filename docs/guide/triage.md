# Decide what comes in

New reports arrive in **Needs decision** on Current, with the evidence that came with them. Someone on the team makes the call with **Make the triage call** beside the issue: **Accept**, **Defer** or **Decline**. Each decision records who made it, when, and why.

## Accept

Accepting puts the issue to work. Choose its assignee, priority, cycle and whether it starts now (In progress) or next. If the newest evidence includes an explicit policy recommendation, Vector uses its valid assignee, priority, start state and cycle as suggestions. Otherwise the form starts unassigned, with no priority or cycle and the default Unstarted status. Review or change these choices before you accept. The issue leaves Needs decision and moves to Now or Next.

## Defer

Deferring says "not yet, look again later". Choose when it should come back and, if you like, why. The issue leaves Needs decision until then, and comes back once at that time, or sooner if new evidence arrives. The person who deferred it gets a note in their Inbox when it returns. You can end a deferral early with **End deferral**.

## Decline

Declining needs a reason. The issue moves to the team's Canceled status and leaves Needs decision. Its evidence and the decision stay in its history.

## Where reports come from

You can add an issue yourself with **New issue**, bring issues across from another tracker ([Move your issues in](move-in.md)), or connect a signed source that sends reports straight into Needs decision ([Integrations](integrations.md)).

## Who triages

In **Settings → Teams**, choose a fixed responsible member or an ordered weekly rotation and its first boundary in the workspace time zone. Team settings permissions decide who can change responsibility. A fixed assignment stays with that member until you change it; a weekly rotation keeps the same local handover time across daylight saving changes.

Open **Triage** to see the current responsible member and the team's untouched reports. The responsible member also sees their untouched count in navigation. New operator reports, signed-source reports and email intake notify the current responsible member once in Inbox, excluding a member who created their own report. Personal notification preferences control additional delivery. A handover retains untouched work without resending its old notices. An unavailable member receives nothing, and responsibility is not automatically delegated.
