# Native integrations

Settings / Integrations manages named API tokens, secret-URL and signed sources, immutable
outbound destinations and GitHub repository receivers. Configuration requires
the current native operator/session/workspace and destination restore grant.
Credentials are revealed once. Token values are hashed by Base; source,
destination and GitHub signing values are encrypted at rest with AES-GCM bound
to their identity, using the installation SESSION_SECRET. Keep that secret
private. After changing it, rotate sources and revoke/re-register destinations
and repositories; old encrypted values cannot be recovered with the new key.

## Secret webhook URLs (no code)

Register a source in Settings → Connections → Signal sources and copy its secret
webhook URL into a tool’s POST action. The page has complete Zapier, Make and
UptimeRobot steps. Anyone holding the URL can send reports: keep it private.
The URL credential is encrypted separately from the signing secret and excluded
from archives. Replacing the URL invalidates the old URL immediately; revoking
the source disables both options. URL replacement does not rotate the signing key.

Send a JSON object, URL-encoded form fields, or plain text. A `title`, `subject`,
`message`, `name` or UptimeRobot `monitorFriendlyName` supplies the title.
`summary`, `message`, `text`, `alertDetails`, `details` or `description` supplies
the details. Vector defaults the selected team and receipt time. Optional
`sourceRecordId` (also `recordId`, `id`, `ticket_id`, `monitorID`) keeps updates
on one issue; `sourceRevisionId`, `revisionId` or `event_id` identifies an update.
Without revision IDs, identical payloads reuse their receipt. Without record
IDs, changed payloads create separate issues. `observedAt`, `timestamp`,
`alertDateTime` or `updated_at` can supply an observation time.

This unsigned endpoint uses the same bounded body, atomic issue/evidence commit,
revocation, restore, replay, archived-team and deletion checks as signed ingest.
It requires no browser session, bearer header or development checkout key.

## Signed sources

Register a stable source ID and an active Intake team. Save the returned secret,
receiver, signed tenant and source IDs with the producer. Use Base's actual
`createWebhookProtocol` with hex-decoded key bytes, event `signal.revision`, and
the returned tenant/source audience. Source records require `sourceRecordId`,
`sourceRevisionId`, `observedAt`, native `teamId`, title and the documented intake
fields. Assertions explicitly carry `{value, attribution: "source"}`; they stay
source claims rather than established facts. An optional `assertions.assigneeOperatorId`
with `{value: "NATIVE_OPERATOR_ID", attribution: "source"}` supplies an explicit
assignee suggestion for INTAKE-010. It is offered only while that operator is
available in the workspace; it never assigns the Intake issue. Without one,
acceptance starts unassigned with No priority and the team’s first Unstarted
status. The triager can edit all three before accepting. A source always uses
its registered team. Rotation allows a selected overlap
of zero to 24 hours; revocation and expiry deny both new and repeated requests.

The receiver bounds exact raw bytes and verifies before parsing. Signature or
unknown/revoked source failures return 401, invalid input 400, archived team or
changed reused identity 409, deleted native business identity 410, and failed
durability 503. Source identity, native Intake/evidence and processed marker
publish atomically with current key/config/team fences. Exact repeats return the
original result across restart. Observed and receipt times remain distinct;
out-of-order evidence is visible with field changes and source identity. Evidence
does not reopen terminal decisions. Native issue deletion replaces external record/revision identifiers with domain-separated hashes in retained source identity rows, preserving payload-hash conflict precedence and 410 replay refusal. The explicit live/erased discriminator participates in source-record and revision-receipt primary keys, so any raw input remains distinct from an anonymized digest. These anonymous identities survive secret rotation and archive credential exclusion. No external provider is contacted.

## Sentry and Datadog

Owners and Admins connect error tracking in Settings → Connections → Error tracking.
Choose the intake team and a regression rule. New records enter Needs decision;
link an existing Vector issue and provider record ID before the first event to
append its evidence instead. Counts, affected users, release and the original
error link are retained when supplied by the provider.

For Sentry, copy the generated webhook URL into an internal integration, grant
Issue & Event read and write, subscribe to Issue events, then paste its token and
client secret. Vector verifies the raw body's Sentry signature and retains the
request ID as a content-bound replay receipt. Sentry issue webhooks omit release
metadata; Vector reads the latest event through the integration token at Sentry's
fixed API endpoint. Accepted replays reuse their receipt without another read. Resolve the native issue through
its normal intake and completion flow, then use Resolve linked Sentry issue with
its provider record ID. This explicit administrator action sends only the
resolved status to the fixed Sentry API endpoint; unknown results require
checking Sentry before another attempt.

For Datadog US1, paste API and application keys with webhook integration write
permission. Vector registers a named webhook with this installation's URL and a
generated secret header, then discards both registration keys. Add that webhook
to the monitor notification. The registered template maps alert identity, event
identity, transition, title, message, link and observation time. Custom case
payloads can include frequency, affected users and release. Datadog authenticates
its custom header; it does not supply Sentry's body signature.

Regression rules retain evidence alone, reopen Completed work, or add a comment.
Canceled and duplicate work stays terminal. A replay never repeats a move or
comment, including a captured signed body with a different request ID; evidence, regression effects and receipt commit together. Revoking a
connection rejects new and replayed deliveries. Deleting the native issue keeps
anonymous replay guards and refuses resurrection. Archives retain safe connection
profiles and history, exclude encrypted credentials, and require fresh credential
entry before ingress or Sentry resolution. Tests use provider network fixtures;
no live provider acceptance is claimed.

## Outbound delivery

Destinations accept public HTTPS addresses. Issue-created, issue-updated and
issue-completed activity generates a minimal durable event; mapped imports and
archive restore do not. Stable native business identities prevent duplicate
enqueue. Payloads contain the issue identifier/version/title/status/time,
without private attachments or credential values.

Owners and Admins can select implemented event kinds and teams when registering
a destination through `POST /api/settings/integrations/destinations`, or replace
those choices through `PUT /api/settings/integrations/destinations/:id/subscriptions`.
The JSON selection is `{events, teamIds}`. Supported kinds are `issue.created`,
`issue.updated`, `issue.completed`, `comment.created`, `comment.updated` and
`comment.deleted`. The existing Settings form retains the issue-event defaults;
subscription controls remain outstanding. Omitting selections at registration,
and upgrading an existing destination, preserves its three issue-event kinds.
An empty `teamIds` selects all public teams. A selected private team never
authorizes export. Current selections, destination revocation, issue visibility,
erasure and restore holds are checked again before signing and transport.

Native issue-comment creation, editing and deletion publish transactionally with
their activity. Root comments and replies retain stable `commentId`,
`parentCommentId`, `rootCommentId`, `issueId`, `identifier`, `teamId` and
`occurredAt` metadata. Comment events contain no body, quote or author data.
Their durable event IDs survive retries and restart; deleting a root retains
the identity of its replies. Subscriptions are portable configuration; signing
credentials are excluded and restored historical events never replay.

Apply `0120_comment_webhook_author_labels.sql` after 0119. Native
comment events remain eligible when the comment has an external author label,
including email-intake replies deleted by an Owner. The migration replaces only
the event trigger and preserves queued events, delivery history and restore holds.
Retain the forward migration on compatible-source rollback.

Enable delivery in Settings → Connections → Outbound webhooks. The page asks
for the Cloudflare account ID and a token with Account / Workers Scripts / Read
and Zone / Zone / Read for the hosting account and all its zones. Vector reads
the account’s workers.dev subdomain and complete visible zone inventory, verifies
that the installation address belongs to that account, and stores only the
excluded hosting domains encrypted beside its integration credentials. The token
is used only for fixed Cloudflare read endpoints and is never saved. Renew this
setup after adding hosting domains or restoring an archive; credential exclusion
leaves restored delivery disabled. Choose a token that includes every account
zone; a token restricted to selected zones cannot provide a complete inventory.

The installation uses Base's enforcing `EgressTransport` inside its Worker.
It checks all DNS answers, refuses private/reserved and hosting-account
addresses, pins a public address with rustls certificate/name checks for
non-Cloudflare destinations, and uses the existing all-Cloudflare platform-fetch
route when all answers are Cloudflare addresses. That route resolves again and
relies on platform private-address refusal and the destination zone's origin TLS
policy; it does not promise an application address pin or origin certificate
verification. Neither route follows redirects or falls back after failure.
The existing deployment-owned `INTEGRATION_EGRESS` service binding and
`public-dns-pinned-tls-v1` policy remain supported as an alternative composition.

Each destination has **Send a test**. It creates one durable `vector.test` event
without editing issues, signs it using the generated destination secret, and
shows its actual delivery state. **Accepted** means the receiver returned a
successful HTTP status; check the receiver for the same event ID. A lost
acknowledgement is uncertain and is never automatically replayed. A receiver
must support Vector's signed payload format (the exact signing format is shown
on the page); a provider's incoming webhook may require an adapter.

Base DeliveryService and the native repository retain attempts, backoff and
cooldown across restart. Queued/sending/accepted/rejected/uncertain are actual
durable states. Accepted means a receiver acknowledgement, not a claim about its
downstream work. Ambiguous sends become uncertain and do not retry under fresh
IDs. Reconcile only from independent receiver evidence, using a safe evidence
reference in Settings. Destination revocation/configuration and restore holds
are rechecked before preparing and sending.

The local composition journey uses the real native queue and the egress
service's own transport through its test double (`createDevEgress`): synthetic
DNS answers and loopback sockets, with real WASM rustls TLS to a test CA. The
receiver independently checks exact HMAC bytes, tamper and replay. Through
Vector's Settings routes, a destination whose name resolves to a private address
is never connected, and one that answers 302 is not followed; both deliveries
stay uncertain. Native tests cover failed SQL, restart, finite retry and
uncertainty. This is local composition proof, with no live endpoint.

Native issue deletion erases local event, delivery and retained receiver-inbox bodies atomically. Permanent event-identity guards prevent stale enqueue, replay publication, claims and transport. Attempts retain only protocol-generated kind/code/status/retry delay; the native webhook classifier ignores response bodies and Base projects the result before persistence. Operator-entered reconciliation codes can contain private text, so deletion replaces them with a fixed deletion code while retaining the decision, identity and time. The same rule applies to late reconciliation. Vector currently mounts no generic Base replay receiver, but populated archive replay rows receive the same erasure and publication guard. An already invoked external provider operation cannot be recalled.

## GitHub pull requests, commits and deployments

Register the repository by owner and name, save its reveal-once secret, and select
Pull requests, Pushes and Deployment statuses in the repository's webhook settings.
Vector validates the exact raw-byte HMAC, repository, delivery UUID and payload.
See [signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
and [payload documentation](https://docs.github.com/en/webhooks/webhook-events-and-payloads).
Settings → Connections shows each repository's last durably accepted pull request,
push or deployment delivery in the viewer's time, or that none has arrived yet.
Signed pings and connection tests are not recorded, and the time reports GitHub's
deliveries to Vector, not a call Vector made to GitHub.

PR branches, titles and bodies name native issue keys without creating members or
issues. Closing and contributing phrases distinguish completion from contribution.
Draft opening, review requests and merges use each team's configured status.
Defaults match In Progress, In Review and Done by name; an absent name means no
move. Explicitly disabling a rule also means no move. Completed work is never
reopened unless that rule permits it. Team-rule writes use Who manages team settings,
with Owners and Admins always admitted. Settings → Teams shows each team's editor
to its owners and, when All team members is selected, its ordinary Members.
Guests and Viewers cannot read or change the rules. Workspace GitHub settings
links to the same Teams editor. The same-origin native team PATCH door accepts
`githubAutomation: {trigger, statusId, allowReopen, expectedVersion, environment?}`.

Signed branch push events retain the author string, first message line and validated
GitHub commit URL. Authors never create or match members. Closing commits on the
default branch share the merged-PR rule; other branches only link. Delivery and
commit receipts prevent repeated moves and follower notices. The receiver accepts
up to 200 commits and 200 issue links per push; oversized requests are refused.

Successful GitHub deployment statuses attach environment and provider time when
the SHA matches a linked commit or retained merged-PR merge SHA, or recorded
non-forced signed branch pushes prove ancestry. Forced updates, absent proof and
unknown SHAs never establish inclusion. Production defaults to the environment
named production, case-insensitively; each team can choose another name and status.
Each issue/deployment pair acts once. Git status changes have a system actor,
Git automation, and followers receive one in-app notice per change.

The issue's branch suggestion and native issue read expose `branchName`; native
issue reads and the GitHub block expose deployments. The same fields accompany full issue reads and mutation receipts in the versioned API. Creating a provider branch requires the unbuilt GitHub App
connection; no provider write credential or outbound enrichment is used here.
GitLab, CircleCI, Vercel, Netlify and Cloudflare deployment receivers remain unbuilt.

## Restoration and upgrades

Archives retain safe configuration, source business identities/deletion history,
PR links/states and delivery/attempt/usage history. Credentials, transient claims
and destination-only holds are excluded. Restore quarantines every historical
webhook delivery and native event, clears signing values and requires re-entry.
Fresh operator access/effect review can admit future work; it never releases
historical pending or uncertain sends. Restored tokens require new credentials.

A destination whose signing secret is missing (restore) or no longer opens is
listed in Settings as needing attention with that reason and a re-enter action.
Its new events stay queued and unsent, counted as held; already queued
deliveries wait. Every other destination keeps delivering. Re-entering the
secret releases the held events, signed with the new secret.

Apply 0027/0028 additively after 0026. Keep schema, tombstones, processed markers,
attempts and terminal results on compatible-source rollback. Recover D1/FILES
and matching source together in isolation. Hosted egress, stage installation,
live accounts, the public site and publication remain owner work.

## Slack and Discord channel notifications (SLACK-003)

In Settings → Connections → Slack and Discord channels, an Admin pastes a Slack
bot token with `chat:write`, `channels:manage` and `channels:read`. Vector validates it with `auth.test` and seals it with AES-GCM using
`sealSecret`/`openSecret`, bound to this workspace. The token never appears in a
read response. Replace it in the same form to rotate it. Removing the connection
calls `auth.revoke`, deletes the stored token and disables its bindings. A provider
revocation error is shown and refuses removal; a restored connection with no
usable token can still be removed locally. Owners and Admins connect, bind and
remove Slack (role matrix, ROLE-001); teams are workspace-visible until ROLE-002.

Choose a team, project, saved view or initiative, a Slack channel ID and display name, and
chosen events. Each object has one destination; saving again replaces its
binding. Add the Slack bot to an existing channel first. New triage, new issue
and status changes post now. Saved views use the member’s current browse filters
at dispatch. Project updates, releases, SLA warnings and agent completions
retain their receiving clauses. Initiative updates and project membership
changes use this same durable dispatcher. Private-team issue content only posts
to channels an Admin bound to that team.
Teams, projects and saved views post only issue events and initiatives only
initiative events: the form offers just those, and Vector refuses any other event.

Owners and Admins bind initiatives under these same Settings controls. They also
decide where Members may post: **Approve a channel for an initiative** in Settings →
Integrations names one initiative and one existing channel, either a Slack channel
already bound or allowed or a configured Discord webhook, for this workspace’s
members. Owners and Admins withdraw an approval in the same list. A Member who can
edit an initiative binds it on the initiative page under **Channel notifications**,
choosing only a channel approved for that initiative and the events to post; they
can save or withdraw that initiative’s binding and nothing else. Guests and Viewers
cannot bind. Vector identifies an approved channel by its service, workspace and
channel ID, never by its name or another binding. It rechecks the Member’s role, the
approval, the binding version and the channel when saving and again before every
post. Withdrawing an approval stops pending and later posts from Member bindings
that use it; approving the channel again replays nothing until the Member saves the
binding again. Approving again after a Slack workspace change replaces the stale approval; the panel explains why posting stopped and asks the Member to save again. An already usable approval changes nothing. Choose Initiative created, Initiative update or Initiative
projects changed. Create the initiative first, then bind it with Initiative created
selected to deliver its recorded creation once to that destination. Replacing a
binding creates a new destination and may deliver that creation there too.
Each selected initiative write records its event in the same
transaction and uses the existing durable queue. Messages contain only the
initiative name, actor, change and canonical initiative link. They omit descriptions,
comments and project names. An initiative involving private work sends only
“Private work changed. Sign in to Vector to view it.”, without actor, name or link.
Dispatch checks the current initiative and active actor membership. Replacing or
removing a binding stops its old destination. Restored bindings retain their
configuration but need credentials re-entered and effects reviewed before posting.
Apply `0104_initiative_channel_bindings.sql` and `0105_initiative_destination_approvals.sql`
additively; keep terminal delivery history.

Owners and Admins see **Create Slack channel** on a team or project creation form. Members who may create a project can instead choose a Slack channel an Owner or Admin already bound or allowed. Vector calls
`conversations.create` once, for a public channel named from the identifier or
name (lowercase, hyphens, at most 80 characters), and binds the returned channel
as part of the native object transaction. A Slack error, including `name_taken`,
is shown and refuses creation without an automatic retry. If Slack creates a
channel but the later local transaction fails, check Slack before trying again;
Vector cannot atomically commit across Slack and its own database.

Discord destinations accept only HTTPS `discord.com` or `discordapp.com` URLs
with a path beginning `/api/webhooks/`. The complete URL is sealed in the same
excluded secret store; settings retain only its display name. Redirects are
refused. Slack uses fixed `https://slack.com/api/` endpoints. These fixed provider
hosts do not use the arbitrary-webhook resolved-address egress configuration.

Messages send the issue identifier, title, readable actor name, status change
and canonical `/app/issues/:identifier` link outside the deployment. Descriptions,
comments, attachments and evidence bodies are never included. Slack formatting
and Discord allowed mentions prevent issue text from generating mentions.

Channel delivery reuses the existing durable outbound events, claims, attempts,
finite retries and uncertain terminal states. Settings → Developers → Delivery history shows
failures. A timeout or unknown provider result is never automatically resent.
Unbinding, issue deletion, removal of the configuring operator or removing Slack
stops future sends; a request already started may finish. Vector’s local erasure
cannot recall messages already posted in Slack or Discord (SEC-003).

Archives retain bindings and delivery history but exclude the bot token and
Discord webhook URL. Restore holds historical effects permanently and shows
**Needs attention** until credentials are re-entered and future effects reviewed.
The manifest/OAuth installation, Events API, @Vector issue creation and explicit
member linking remain SLACK-001; this paste path does not claim those features.
Apply `0073_channel_notifications.sql` additively after the v0.4.0 schema and keep
all prior rows, outbound terminal states and new binding tables on rollback.

Slack channel selection and every post require `conversations.info`: the bot
must be a member, `is_channel` must be true, and `is_archived`, `is_shared`,
`is_ext_shared`, `is_org_shared` and `is_pending_ext_shared` must explicitly be
false. Frozen channels are refused; only an absent optional `is_frozen` means
false: the held channel omitted this field in the recorded provider run, an
assumption open to revision (ct, 20 October 2026 19:12Z and 19:24Z). Any other missing or malformed safety flag
refuses routing. No channel is inferred from a name or email address.
A channel that becomes unsafe, or whose post is refused as archived, frozen or
not joined, is visibly suspended. An Admin must save a fresh binding after the
underlying access is fixed; old held events are not replayed. The current
workspace has no private/restricted teams; ROLE-002 must add generic notices
without actor or text, or a DM to a permitted explicitly mapped member, before
private-team channel delivery ships. This is named in its acceptance.

Discord requests server confirmation with `wait=true`, suppresses embeds and
mentions, and retains only the transport result. Provider response bodies are
not retained. Removed native operators’ queued actor display snapshots are
anonymized locally while their events remain ineligible to post.

## Slack direct messages (SLACK-004)

Slack direct messages reuse the SLACK-003 bot token. The token also needs `im:write`
(to open the direct message) and `users:read.email` (to find a member's own account).

**Members link themselves.** In Settings → Notifications a signed-in member chooses
**Link Slack**. Vector calls `users.lookupByEmail` with that member's own sign-in email,
shows the Slack account it found and links it only after the member chooses **Confirm
Slack link**. No match shows "No Slack account found for this email" and stores nothing;
a lookup error is shown and not retried. Vector never looks members up in the background,
never looks up someone else's email for an Admin, never reads the directory
(`users.list`) and never matches on names. Linking and unlinking are audited. **Unlink
Slack**, member removal, suspension (ROLE-011) and removing the Slack connection delete
the link and stop every direct message. Explicit Admin mapping is SLACK-001's.

**Choosing Slack.** A linked member turns on Slack direct messages for assignments and
for mentions, the events Vector also mails (NOTIFY-006). The choice is unavailable, with
the reason shown, while Slack is not connected or needs attention, or while the member
has no link. Every other event's channel choice belongs to NOTIFY-007.

**Delivery.** A qualifying notification creates one direct-message intent in the same
transaction as the change that caused it. Right after that change commits, like
immediate mail, Vector rechecks mutes, the actor, the recipient's activity, issue access
and the member's link and choice, calls `conversations.open` and then `chat.postMessage`.
The intent uses the existing outbound ledger: a rate limit, or a `conversations.open`
that did not answer (nothing was posted), retries at most three attempts, after one and
then five minutes; an unknown `chat.postMessage` result is uncertain and is never resent.
The recipient sees failed and uncertain messages under Slack delivery updates in
Settings → Notifications; personal messages are not listed in the Admin's delivery
history.

**What leaves the deployment.** For the lookup, the member's sign-in email. In a direct
message, only the event kind, issue identifier and title, actor display name, status
change, due date, the team's workflow status names in the Change status select, the
issue version inside the action values, and the canonical `/app/issues/:identifier`
link that requires sign-in. Messages use plain-text blocks with `unfurl_links` and
`unfurl_media` false. Descriptions, comments, mention bodies, attachments, free text and
AI output never leave. Private or restricted items do not exist until ROLE-002, which
must send a generic notice without actor or text.

**Actions and the signing secret.** Each message has **Open**, the canonical link.
**Assign to me** and **Change status** appear only after an Admin enters the Slack app's
signing secret (Basic Information → App Credentials) beside the bot token in Settings →
Integrations; until then Settings says they are off and messages offer Open only. The
signing secret is sealed per workspace with `sealSecret`/`openSecret`, never shown again,
excluded from archives with the member links, needs entering again after a restore
(members re-link) and is deleted when the Slack connection is removed.

Until SLACK-001's manifest sets it, turn on **Interactivity** in the Slack app and set
its Request URL to the value Settings shows:

```
https://<your Vector address>/api/integrations/slack/interactive
```

Vector verifies `X-Slack-Signature` (HMAC-SHA256 over `v0:<timestamp>:<raw body>`) in
constant time, refuses a timestamp more than five minutes from its clock and any
replayed request, and maps the Slack user to a Vector member only through a confirmed
link. The change runs through the version-checked issue edit with that member's own
authority and the issue version the message carried: an issue that changed since is
refused with a threaded reply carrying Open, never overwritten; an applied change
refreshes the message. Vector acknowledges within Slack's three seconds and replies
afterwards. Unlinked, removed or suspended Slack users, bad or missing signatures,
stale timestamps and replays change nothing.

Apply `0074_slack_direct_messages.sql` additively after 0073. It adds the member link
and request-key tables (both excluded from archives) and triggers that drop links and
the signing secret when the connection is removed and scrub queued messages for a
removed member. Keep all prior rows and outbound terminal states on rollback. An
already-sent direct message cannot be recalled by local erasure (SEC-003).

### Signed SendGrid reply outcomes

In Settings → Teams → the team's Email intake, save the intake address and allowed senders first. Under SendGrid Event Webhook, paste SendGrid's public verification key and copy the displayed team URL into SendGrid's signed Event Webhook configuration. Enable processed, delivered and bounce events. The key's saved state survives a page reload; clearing it stops callbacks. This does not configure the provider account or verify hosted delivery.

Callbacks verify SendGrid's P-256 signature over the timestamp and exact request body, require a timestamp within five minutes, and match the provider message ID and original recipient to an accepted reply from that team. Processed and delivered events show Accepted on the reply; bounce events show Bounced and cannot be overwritten by a later acceptance event. Replayed event IDs, unsigned or altered bodies, stale timestamps and foreign messages or recipients are refused without changing the reply. Callbacks send no mail.

Archives retain outcomes and replay identities. Verification keys are excluded and intake stays disabled after restore; configure the destination's provider account and key again. Local signed fixtures prove these transitions; installation routing, sender-domain configuration and hosted provider receipt remain installation work. Customer/domain attachment remains unavailable until customer records exist.


### Slack app installation

Owners and Admins can configure a notification app in **Settings → Connections → Slack app installation**. **Create an app automatically** uses a one-time app configuration token. Alternatively, **Use Slack’s prefilled page** opens Slack’s app setup with the manifest already filled in; create the app there, then save the app ID, client ID, client secret and signing secret in Vector. Submitted secret fields clear after a successful save. **Install Slack app** opens Slack’s consent screen; finish it in the same Owner/Admin session. **Remove Slack app** and the existing **Remove Slack connection** control both revoke the connection and remove the stored credentials and member links. They do not delete the app definition in Slack.

The authenticated Settings API remains available. `GET /api/settings/integrations/slack/app` returns the generated
installation manifest, its prefilled Slack creation URL and this installation's
OAuth callback URL. `POST` to the same path accepts the app ID, client ID, client
secret and signing secret; `/create` accepts a one-time configuration token for
Slack's manifest API. The configuration token is used once and never stored.
App credentials are sealed in the same archive-excluded custody as the existing
Slack bot credential; reads expose only the app and client IDs.

`POST /api/settings/integrations/slack/app/install` returns the Slack OAuth
consent URL. The callback at `/api/integrations/slack/oauth/callback` requires
the same current Owner/Admin who began it, a ten-minute state and a bot grant
for the configured app. State is consumed once; reconfiguration invalidates it.
Bot and signing credentials commit together under current authority. Removing
the Slack connection revokes its bot token and removes app credentials, pending
state, signing credentials and member links. It does not delete the Slack app
definition.

Both manifest paths include this installation's Events, interactivity, `/vector`
command and OAuth callback URLs, its unfurl domain, and the channel/DM,
mention, channel-history, command and unfurl scopes. Command execution and
unfurl responses remain their own unbuilt integration work.

Under **Slack member mapping**, an Owner or Admin explicitly maps a Slack
workspace ID and member ID to an active Vector Member or Guest, or their own
account. Another Owner or Admin cannot be selected as a target. Mapping and
removal are audited; only an Owner or Admin manages another person's mapping.
The target can inspect their mapped Slack user and workspace and revoke their
own mapping from Settings → Notifications, including after becoming a Guest or
Viewer. Personal linking by a member's own email remains available there.
Migration `0102_slack_installation_team.sql` retains the Slack team ID verified
by `auth.test`. Explicit mappings and Events must match that installed workspace;
older installations without a verified team ID need reconnection before new
mappings or Events intake. The identifier remains portable; restored credentials
still require re-entry. Apply it after 0101 and retain it on rollback.

Bind the Slack channel to exactly one team with the existing channel-binding
form. A signed `app_mention` at `/api/integrations/slack/events` creates one
issue in that team as the linked member, subject to that member's current
permissions. The event text after its leading mention supplies the title.
Unmapped users, unbound or ambiguous channels, invalid signatures, stale
requests and repeated events create nothing. Slack URL verification is
answered only with a valid installation signature. Unlinking prevents new
mentions from acting as that member. Migration `0101_slack_event_receipts.sql`
adds identifier-only, portable replay history, committed with the issue; keep
it on rollback so retries cannot recreate previously accepted issues.

Signed `app_uninstalled` and `tokens_revoked` events retire the installation,
remove its stored app, bot and signing credentials and member links, and disable
its Slack destinations without another provider call. Reconnecting requires
fresh app credentials and OAuth installation.

App credentials, bot/signing secrets and member links are excluded from archives.
An independent restored installation shows empty app credential fields, cannot
start installation until credentials are re-entered, and retains event receipts
so previously accepted mentions cannot recreate issues.

This installation remains partial: the hosted real-workspace installation needs
the owner's Slack console setup and reinstallation with the generated scopes and
URLs. The recorded acceptance uses Slack API fixtures, not a hosted provider.
