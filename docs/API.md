# Scoped native API

Create a named token in Settings / Integrations. Select only the needed scopes,
optionally set an expiry, save the credential once, and revoke it there. Lists
and usage contain safe metadata, route names and times. Base TokenService owns
generation, hashed storage and transactional issuance/usage. An active mapped
operator and current workspace authority are required on every request and
inside each mutation transaction. Operator removal revokes issued tokens.

Send `Authorization: Bearer TOKEN` to the saved installation origin. Do not put
credentials in URLs. Browser Origin, when supplied, must match that origin.

Tokens created through local `RER_OPEN` sessions also require the checkout key in
`x-rer-dev-key` on every request. Load it from the owner-only
`.rer/local/dev-key.env` in that checkout; do not print it. Bearer-only local
requests return 401. See [the local token command](guide/api.md#use-a-local-development-token)
for the complete Bash/curl example. These development tokens are excluded from
archives, fail after local reset and cannot authenticate to deployed Vector.
Hosted tokens need only the bearer header.

| Route | Scope | Native behavior |
| --- | --- | --- |
| GET /api/v1/issues | issues:read | Existing bounded filters, cursor paging, sort and grouping |
| GET /api/v1/issues/IDENTIFIER | issues:read | Current native issue projection, branchName and deployments |
| POST /api/v1/issues | issues:write | Existing issue creation schema, references and history |
| POST /api/v1/issues/IDENTIFIER/copy | issues:write | Copy with expectedVersion, optional teamId, includeSubissues and includeLinks |
| PATCH /api/v1/issues/IDENTIFIER | issues:write | Existing field schema and required expectedVersion |
| POST /api/v1/issues/IDENTIFIER/comments | comments:write | Existing trimmed nonempty body and comment mutation |
| GET /api/v1/metadata | metadata:read | Current teams/statuses/operators/projects/cycles/labels |
| GET /api/v1/projects | projects:read | Portfolio filters and matching lifecycle/health counts |
| GET /api/v1/projects/ID | projects:read | Project fields, labels, progress, risk and activity |
| POST /api/v1/projects | projects:write | Create a project with a lead, optional dates, priority and enabled project labels |
| PATCH /api/v1/projects/ID | projects:write | Change native project fields with date validation and per-field activity |

Unknown query/body fields refuse. Workspace and actor identity come from the
token authority, never the request. Native status/reference/archived-team rules
apply. Missing, incorrect, expired, revoked or insufficient authority returns
401; foreign Origin returns 403; bad input returns 400; missing resources/routes
return 404; stale writes or invalidated pagination return 409. Durability or usage
recording failures return 503 and deny admission. Native mutation authority loss
rolls back the whole transaction. A postcommit authority loss conceals the result
without erasing already-committed native notification intent.

Tokens admit only the explicit operations published at `/api/v1/schema`. They cannot sign into documents,
generated functions, private files, ordinary cookie APIs or token administration.
Project, milestone and comment deletion use separately selected delete scopes; there is no issue deletion API or token-administration bearer route. Existing assignment/direct-mention notifications keep
their native policy. A token acts with its member's current role, read on every request (ROLE-001); there is no tenant selector.

The native Worker tests exercise scopes, stale writes, revocation/removal,
issuance/commit races, usage-write failure and restart. Local proof does not
establish hosted token commissioning or a live client integration.

## Issue dates

Issue creation and version-checked edits accept optional `startDate` and `dueDate`
as `YYYY-MM-DD` or null. When both are set, start must be on or before due;
invalid intervals return 400 without a write. Each successful change appears in
activity. Lists accept `start=this_week`, `start=range` with `startFrom` and
`startTo`, `start=none`, or `start=overdue` (before today), and `sort=start`.
Week boundaries use the workspace timezone, Monday through Sunday.

## Project planning

Project create accepts `name`, `description`, `leadOperatorId`, `startDate`,
`targetDate`, `priority` and `labelIds`. Dates are `YYYY-MM-DD` or null; a target
before the start is refused without changes. Priority is `urgent`, `high`,
`medium`, `low` or `none`. Labels must be workspace labels marked **Use for
projects** in Settings. PATCH accepts any of those fields plus `lifecycle` and
`archived`; simultaneous changes are atomic, and each changed planning field
has its own activity entry. Native project updates guard the fields and labels
read during preparation; they do not use the issue `expectedVersion` protocol.

The portfolio supports `lifecycle`, `health`, `lead`, `team`, `targetFrom`,
`targetTo`, `label`, `includeArchived` and `sort=priority` (or `newest`, the
retained name-order setting). Counts and rows use the same filters. The portfolio response is cursor paginated, with `limit` (1–100, default 50), `cursor`, `nextCursor` and `total`. Lifecycle and health counts describe the entire filtered result, consistently across pages.
Project custom fields, configurable project statuses, roadmap editing and
Linear project-field import remain targets in CONTRACT.md.

## Native operator deletion and duplicate decisions

A current cookie session may `DELETE /api/issues/IDENTIFIER` with the strict body `{ "expectedVersion": 1, "confirmed": true }`. The version must be the reviewed current version. Any active workspace operator is admitted by `issue.can-delete.v1`. Signed-out, token-only and removed-operator requests return 401; foreign Origin returns 403; unknown issues return 404; stale intent and a canonical issue with incoming duplicates return 409. A canonical refusal identifies its duplicates. Deletion commits atomically with retained import erasure, source identity fences and webhook payload redaction. A dependent graph change during preparation returns 409 without erasure and requires a fresh review; unrelated SQL failures remain 500 with atomic rollback.

A 200 response confirms all attachment bytes absent; 202 reports pending or failed cleanup honestly. Both include only the identifier, timestamps, counts and the authorized `/api/issues/IDENTIFIER/deletion` receipt URL. Existing durable file-removal intents settle uploads and retry cleanup through Cron. An unsettled upload is never declared complete merely because its object is absent.

`POST /api/issues/IDENTIFIER/duplicate` accepts `{ "expectedVersion": 1, "canonicalIdentifier": "FLW-123" }`; null undoes the decision. The selected canonical must be another non-duplicate issue. Incoming duplicates are repointed in the same transaction, and undo restores the latest nonterminal team status or default Backlog. These native commands are not added to `/api/v1`.

## Copy an issue (ISSUE-023)

`POST /api/v1/issues/IDENTIFIER/copy` accepts a strict body such as
`{ "expectedVersion": 1, "includeSubissues": true, "includeLinks": true }`.
Both options default to false. Omit `teamId` to stay in the source team; supply
an available team ID from the same workspace to copy elsewhere. The cookie API
uses the same body at `/api/issues/IDENTIFIER/copy`. Issue menu → Copy issue and
the command palette open the same review form.

The 201 response contains `issue`, `copies` (source and new identifiers),
`mappings` (source/destination status, labels and custom-field keys), and
`droppedValues` (source identifier, field, original value and reason). Every new
issue starts in the destination's first Backlog status. Labels and custom fields
are workspace scoped and map unchanged between teams. A cross-team cycle is
dropped and reported; a same-team open cycle is preserved. A closed or missing
cycle, or an unavailable project, is also reported when dropped.

Selected sub-issues include the full ordered descendant tree, with new identifiers
and independent histories. Selected links are issue-level named links; comment
links stay with their excluded comments. Copies preserve title, description,
priority, estimate, labels, project, custom fields, due date, expected outcome
and customer impact. They are unassigned and have no original comments,
activity, files, followers, customer requests, dependencies or duplicate links.
Each source and copy receives its own copied-to/copied-from activity entry.
Description-embedded file cloning belongs to ISSUE-024, whose inline attachment
support is still partial.

A stale source or a change to the selected tree, labels or links during
preparation returns 409 and creates no copy. All selected issues and their new
hierarchy/history commit together. Archived, missing and other-workspace target
teams are refused. Token scope, native session and Origin checks remain in force.

In the command palette, enter `Copy issue` on an open issue, or `Copy issue <identifier or title>` from any page. Ordinary issue searches retain one result per issue.

## Versioned schema and coverage (API-003)

`GET /api/v1/schema` publishes the checked-in OpenAPI 3.1 document
[`schema/api-v1.json`](../schema/api-v1.json), without authentication. Its path,
method and `x-scopes` entries are the API admission table. Unknown paths or
methods return 404 before bearer authentication. The normal worker test reads
the published schema and checks it against every mounted route, the named
object inventory, list filters and cursor declarations. `x-object-coverage`
reports omitted native operations as **owed**, and initiatives (INIT-001),
releases (RELEASE-001), documents (PROJ-013), customers (CUST-005) and customer
requests (CUST-001) as **not-built**, never as read-only exemptions. Inventory
validation is not full clause acceptance: complete operation coverage remains owed.
Run `node --experimental-strip-types scripts/api-coverage.mjs` for strict full
qualification; it exits nonzero with the exact missing operations and unbuilt
objects until all clause coverage is complete. The normal worker test verifies
that the published schema produces this incomplete qualification, rather than
claiming full coverage from a partial inventory.

Existing tokens keep exactly their issued scope arrays. Select new scopes in
Settings → Integrations when issuing a new token; expanding the selector does
not expand an old token. New routes are:

| Route | Scope | Native behavior |
| --- | --- | --- |
| GET /api/v1/comments | comments:read | Cursor list filtered by `issue`, `createdFrom`, `createdTo` (inclusive UTC timestamps) |
| GET /api/v1/comments/ID | comments:read | A live comment on an issue this operator can read |
| PATCH /api/v1/comments/ID | comments:edit | Strict `{body, expectedVersion}` input, native author-only editing |
| DELETE /api/v1/comments/ID | comments:delete | Strict `{expectedVersion}` input, native author/Owner/Admin deletion policy; deleted comments disappear |
| DELETE /api/v1/projects/ID | projects:delete | Deletes populated projects, preserves their issues and clears the issues’ project assignment |
| GET /api/v1/projects/ID/milestones | milestones:read | Cursor list, optional `completed=true` or `false` filter |
| GET /api/v1/projects/ID/milestones/MILESTONE_ID | milestones:read | Full native milestone projection, including progress and slip |
| POST /api/v1/projects/ID/milestones | milestones:write | Native creation: `name`, optional `description`, `targetDate` |
| PATCH /api/v1/projects/ID/milestones/MILESTONE_ID | milestones:write | Native fields and `completed`, including reopen |
| PUT /api/v1/projects/ID/milestones/order | milestones:write | `{milestoneIds}` containing every project milestone once |
| DELETE /api/v1/projects/ID/milestones/MILESTONE_ID | milestones:delete | Preserves issues, clears assignment and records native activity |
| GET /api/v1/labels | labels:read | Workspace labels, cursor list with optional `name` substring and `projectsEnabled=true` or `false` filters |
| GET /api/v1/labels/ID | labels:read | One native workspace label, fenced to the current workspace |
| GET /api/v1/cycles | cycles:read | Cursor list with optional `team` and `closed=true` or `false` filters |
| GET /api/v1/cycles/ID | cycles:read | Native cycle detail, progress, report and closure snapshot |
| POST /api/v1/cycles | cycles:write | `teamId`, `name`, `startsLocal`, `endsLocal`, optional `capacity`; native timezone and overlap guards |

Issue creation and update accept the inherited `milestoneId` field. An issue
must belong to that milestone's project. Project moves and milestone deletion
retain the native assignment-clearing behavior. Milestone writes use the app's
snapshot guard (409 on concurrent changes), not a new version protocol.

### Comment read shape

```json
{
  "id": "stable comment ULID",
  "issueIdentifier": "TEAM-123",
  "body": "complete body text",
  "version": 0,
  "author": { "id": "stable operator ULID", "displayName": "native display name" },
  "createdAt": "ISO-8601 timestamp",
  "editedAt": null,
  "url": "https://installation.example/app/issues/TEAM-123",
  "maxBodyLength": 100000,
  "truncated": false
}
```

`version` is a nonnegative integer revision, stable between body edits and
increased by every native body edit, including checklist changes. Both PATCH
and DELETE require the last-read `version` as the JSON body field
`expectedVersion`, matching the issue API's body-field convention. PATCH takes
`{"body":"replacement text","expectedVersion":0}`; DELETE takes
`{"expectedVersion":0}`. `If-Match` is not a substitute for that required field.
A missing or invalid revision returns 400; a stale revision returns 409. The
revision comparison and mutation are atomic: refusal leaves the body, revision,
history, links and notification effects unchanged (token usage and rate-limit
accounting still apply). Two concurrent edits using the same revision admit
exactly one. Read the comment again after a successful edit for its new revision.

`editedAt` becomes an ISO timestamp after editing. The canonical link opens the
containing issue. Responses do not truncate bodies; native creation/editing
limits body text to 100,000 characters. Display names follow the app, including
`Removed operator` after erasure and imported attribution. A suspended-member
product state does not yet exist; its safe display behavior remains inherited
under ROLE-012/OPS-004. Only comments on readable issues appear; deleted
comments are absent from list and get, never content-bearing tombstones.

### Comment checklist ticks

`POST /api/v1/issues/IDENTIFIER/comments/ID/checklist` requires
`comments:write` and the comment's own author. Send the last-read `expectedBody`,
optional nonnegative comment `expectedVersion`, zero-based task `index`, exact
Markdown item `text` and desired Boolean `checked`. Native discussion responses
also include the comment `version`.

An independent edit elsewhere in the body can merge when the selected item's
text is unchanged. A changed or missing target returns 409 with the current
`comment` containing `id`, `body` and `version`. Another author receives 403.
Each changed tick records one attributed comment revision and one item-naming
activity entry atomically; repeating an already-applied tick adds no receipt.
The containing issue's status and version stay unchanged. Full-body comment
edits retain their stricter revision check described above.

### Workspace label reads

Both label read operations require the explicit `labels:read` scope. Neither
`metadata:read` nor `labels:write` grants it. Existing personal tokens, registered
OAuth applications and issued grants retain their saved scopes; request this
scope explicitly when issuing new access. Native label creation still requires
`labels:write` and its existing workspace creation permission.

The list accepts a case-insensitive substring in `name` (1 to 120 characters
after trimming) and an optional `projectsEnabled=true` or `false`. Unknown query
fields and invalid values return 400. Results retain native name-then-ID ordering.
Each label has `{id, name, color, projectsEnabled, textColor}`; the detail response
uses the identical stable ID and projection. A missing or foreign-workspace ID
returns 404. Owners, Admins, Members and Viewers with a current personal token
and this scope may read labels under the native Labels Settings permission;
Guests receive 403. OAuth grants retain their existing eligible-role checks.
Expired or revoked access and removed issuers cannot read either operation.

A read grant cannot create a label. Label update and deletion remain owed;
these two reads qualify no other object operation. Pagination uses the same
actor-bound snapshot protocol below, including invalidation after a native
rename, recolor or change to project availability in the filtered result.

### Pagination and limits

Comments, projects, milestones, cycles and labels accept `limit` and `cursor`; responses
include their named array, `total` and nullable `nextCursor`. Treat cursors as
opaque and keep all filters and the limit unchanged. They are bound to the actor
and filters, and a changed ordered projection returns 409. Restart from the
first page after that response. Issue lists support the same cursor protocol
when `limit` or `cursor` is supplied, retaining legacy `offset`/`revision` paging
for existing clients. Do not combine those two protocols. Cursor mode retains
the native issue-list revision check and supports small pages.

Authenticated API calls allow 300 requests per token per calendar minute.
Exhaustion returns 429 with integer `Retry-After` seconds until the next minute;
other tokens have independent buckets. The existing transient access limiter
stores buckets and is excluded from archives. Public schema reads do not use a
token bucket. Invalid, expired, revoked, removed-operator or insufficient-scope
tokens remain refused before resource admission.

### Open acceptance

API-003 remains partial. Idempotency keys (including replay, concurrency,
expiry, erasure and archive exclusion) are not implemented. Complete API
operations for attachments, relations, teams, workflow states, saved
views, notifications and members, label update and deletion, cycle update/delete
and issue deletion remain owed. Attachment bytes stay behind the same-origin cookie file door: API-001
still forbids private-file access by bearer. The remaining not-built objects and a
real private-team refusal under ROLE-002 remain owed. Native cookie issue
deletion, import erasure and its receipts are unchanged.

## Native GitHub read projections

| Native app route | Read-only fields |
| --- | --- |
| GET /api/issues/IDENTIFIER | `branchName` suggestion and `deployments` (repository, deploymentId, sha, environment, deployedAt) |
| GET /api/issues/IDENTIFIER/github | `pullRequests`, `commits` (literal author, subject and URL), and `deployments` |

Full issue reads and mutation receipts carry branchName and deployments on both native and versioned issue doors.
GitHub signing credentials authorize receiver deliveries only, never member API access.

## Releases

| Route | Scope | Behavior |
| --- | --- | --- |
| GET /api/v1/releases | releases:read | Cursor paging with team and status filters |
| GET /api/v1/releases/ID | releases:read | Scope, progress, blockers and linked PRs |
| POST /api/v1/releases | releases:write | Name, optional teamId/targetDate, status and description |
| PATCH /api/v1/releases/ID | releases:write | Field edits or publishing with expectedVersion |
| PUT /api/v1/releases/ID/scope | releases:write | Replace issueIdentifiers and projectIds with expectedVersion |

Owners, Admins and Members act on readable team and workspace releases; Guests are refused 403.
Native app doors use /api/releases and the same inputs. Released scope stays fixed until
an explicit reopen. Release deletion remains an API-003 gap. A ?readOnly=1 workspace
link hides editing and retains normal sign-in and scope admission; it is not a public share.

## Initiatives

| Route | Scope | Behavior |
| --- | --- | --- |
| GET /api/v1/initiatives | initiatives:read | Cursor paging with status and parent filters |
| GET /api/v1/initiatives/ID | initiatives:read | Three-level hierarchy with visible projects and their teams |
| POST /api/v1/initiatives | initiatives:write | Name, ownerOperatorId, optional parentId/targetDate, status and description |
| PATCH /api/v1/initiatives/ID | initiatives:write | Version-checked field and parent edits |
| PUT /api/v1/initiatives/ID/projects | initiatives:write | Replace direct projectIds with expectedVersion |

Native app doors use /api/initiatives and the same inputs. Owners, Admins and Members
may act; Guests receive 403 on native, scoped API and page doors. A fourth level or
a parent cycle receives 400. A project may join several initiatives. Deletion,
INIT-002 roll-ups and Slack/Discord initiative bindings are not implemented.


Owners and Admins can create a private team with `isPrivate: true` on
`POST /api/v1/teams`, or switch an existing team with
`PUT /api/v1/teams/ID/privacy` and `{ "isPrivate": true }` (false makes it public).
Both require `teams:write`. Members, Guests and Viewers receive 403. Reads apply the
current team membership on every request; a hidden identifier returns 404.
Private-team content never travels through generic workspace webhooks. Slack
private notices require an exact team binding and contain no title or actor.
Calendar feed capabilities exclude private-team items even for their creator.

A whole-workspace portable archive names every team as its scope. An Admin
without access to any private team receives 404 at that archive door; an Owner
can export it. Scoped counted-issue CSV exports remain available for visible work.

Viewer is the fifth stored workspace role. Owners and Admins invite Viewers and change Member, Guest and Viewer roles; only Owners change leadership roles. Viewer reads use current team visibility and every registered work mutation returns 403. Viewer assignments may name private teams explicitly. Personal account preferences, leaving the workspace and personal calendar capabilities follow their own matrix rows. Viewer role values survive portable archive restore; invitation credentials and feed capabilities remain excluded.

## OAuth applications (API-004)

An Owner or Admin opens **Settings → OAuth apps**, gives an application a name,
registers one or more exact redirect URLs, and chooses its maximum permissions
from the existing API scope list. Redirects require HTTPS; loopback HTTP is
allowed for development. Wildcards, URL credentials and fragments are refused.
Save the generated client secret once. Vector stores only its hash and never
returns it in the application inventory. Members, Guests and Viewers cannot
register applications or open the administrative inventory.

Send the member to `GET /api/oauth/authorize` with `response_type=code`, `client_id`,
`redirect_uri`, a space-separated `scope` and an unpredictable `state`. Requested
scopes must be a subset of the registered scopes. For PKCE, send a base64url
SHA-256 `code_challenge` and `code_challenge_method=S256`. Plain PKCE is refused.
An unknown client, mismatched redirect or malformed request returns JSON 400
without a Location header to API clients. Browser navigation instead returns
303 to Vector’s own consent error page, where the member can return to the app
and restart. An unverified redirect URL is never used for an error.
The member signs into Vector and reviews the application's name, permissions
and destination at `/app/settings/oauth-consent`. Owners, Admins and Members
may approve access for themselves; Guests and Viewers receive 403.

The consent screen reads `GET /api/oauth/consent` with those same parameters.
Its same-origin `POST /api/oauth/consent` sends `{request, decision}` where
`request` holds those parameters and `decision` is `approve` or `deny`. Approval
returns an exact redirect with a five-minute authorization code and the original
state. Denial returns `error=access_denied` with that state. Clients must verify
the returned state before exchanging a code.

Exchange at `POST /api/oauth/token` using a form body or JSON with
`grant_type=authorization_code`, `client_id`, `client_secret`, `code`, the same
`redirect_uri`, and `code_verifier` when PKCE was requested. HTTP Basic client
authentication is also accepted in place of body credentials. The response
contains `access_token`, `token_type=Bearer`, `scope` and `grant_id`. Client
credentials are required even when PKCE is used. There are no refresh tokens.
An incorrect client returns 401; a mismatched, expired or previously used code
returns 400. Reusing an exchanged code also revokes the grant issued from it.

Use the access token on the existing `/api/v1` endpoints. OAuth grants are
member-owned Base tokens, stored as hashes in an independent grant namespace.
A read-only grant reads issues with 200 and receives 403 for a write scope it
was not granted. Native role and team visibility checks still apply on every
request and transaction. Removing the member, losing their eligible role or
suspending their underlying identity ends admission on the next call. A grant
never supplies authority for a separate application actor.

Owners and Admins use `GET /api/settings/oauth-apps` to inventory applications
and every member grant, with scopes, creation time and last successful use.
`POST /api/settings/oauth-apps` accepts `{name, redirectUris, scopes}` and
returns the generated client ID and show-once secret. To revoke a grant, use
`DELETE /api/settings/oauth-apps/grants/ID` or its Settings control. The next
API call returns 401. OAuth grants are separate from the member’s personal
API-token list; the personal token DELETE returns 404 for a grant’s token ID
without changing its authority. A member who wants an app removed asks an Admin
to revoke it in OAuth apps. Registration, consent, issuance and revocation are audited
without credentials or request bodies.

Archives exclude application registrations, client-secret hashes, authorization
codes, OAuth grants and Base access-token hashes. Safe token profiles, usage
receipts and audit history follow the existing archive policy. A restored
installation has no working OAuth credential and requires fresh application
registration and member consent. Excluding the entire registration avoids
implying that a restored client secret or old redirect relationship remains
trusted at a new installation.

## TypeScript client and examples (API-005)

The source SDK is in `./sdk/`. Generate it from the currently published
`./schema/api-v1.json`, then compile its dependency-free fetch client and examples:

```sh
node sdk/generate.mjs
node sdk/build.mjs
```

The build checks that generated code matches the schema before compiling with
TypeScript. `./sdk/dist/` is local build output. Import `VectorClient`, `ApiError`
and the generated `Operations` types from `./sdk/dist/client.js` in a server
client. `operations` records the published method, path, required scopes and
cursor mode for each operation ID. Only published operations are generated;
API-003's missing operations remain missing.

```ts
import {VectorClient, ApiError} from './sdk/dist/client.js';
import {intake} from './sdk/dist/examples/intake.js';

const client = new VectorClient({
  baseUrl: process.env.VECTOR_URL!, // saved installation origin, without a path
  token: process.env.VECTOR_API_TOKEN!,
});
const issue = await intake(client, {
  teamId: process.env.VECTOR_TEAM_ID!,
  title: 'Intake from the TypeScript client',
});
console.log(issue.identifier, issue.title);
```

Issue intake needs `issues:write` and `issues:read`. Obtain the team ID from the
installation's team settings, or use a separately selected `metadata:read` scope
and the metadata operation. The example creates one issue, then reads it by its
returned identifier and checks the exact title and stable ID. It never grants
scopes, manages credentials or bypasses the issuing member's current authority.

For the executable example, set `VECTOR_URL`, `VECTOR_API_TOKEN`,
`VECTOR_TEAM_ID` and `VECTOR_TITLE` in your process environment, then run
`node sdk/examples/run-intake.mjs`. For a local development token, also load that
checkout's private key into `VECTOR_DEV_KEY` without printing it; the runner
sends it as `x-rer-dev-key`. The runner prints only the created issue's ID,
identifier and title. Keep tokens out of command arguments, URLs, logs and source
files. Use HTTPS; plain HTTP is accepted only for a loopback installation.

### Schema limits and error handling

Types preserve declared path parameters, query parameters, bodies, required
fields, nullable fields, enums, arrays and component references. Unspecified
responses are `unknown`; an object with unspecified fields retains unknown
properties. For example, the published issue-create schema currently declares
only date fields, so it does not prove complete issue input typing. The intake
example supplies the documented native `teamId` and `title` and validates its
otherwise incompletely described result at runtime. Schema constraints such as
lengths, date formats, patterns and numeric bounds are validated by the server.
No full-API typing or additional object coverage is implied.

Use `client.request(operationId, {path, query, body})` with the fields that the
operation declares. It returns `{data, status, headers}`. For a paginated list,
supply `limit` and then pass the returned opaque `nextCursor` in `query.cursor`,
keeping filters and limit unchanged. A response whose schema omits pagination
fields requires a runtime shape check before reading those fields. The client
returns every page unchanged and makes no hidden requests.

A non-success HTTP response throws `ApiError` with `status`, the original parsed
JSON body (or text for a non-JSON response) and response `headers`. Handle 400
input errors, 401 authority refusals, 403 permission refusals, 404 unavailable
resources, 409 stale writes or invalidated cursors, and 429 rate limits explicitly.
Read `error.headers.get('Retry-After')` on 429. Refresh current state before
reviewing a 409 write; restart a list after cursor invalidation. The client does
not retry writes: idempotency keys remain an API-003 gap. It refuses automatic
redirects and omits cookie authority. Transport failures use a fixed message
without request details. Never log credential-bearing client configuration or
unreviewed error bodies.

### Sync and agent examples

`node sdk/examples/run-sync.mjs` needs `VECTOR_URL`, `VECTOR_API_TOKEN`,
`VECTOR_TEAM_ID` and optional `VECTOR_QUERY`. Select only `issues:read`.
It reads all filtered cursor pages and prints `{issues:[{id,identifier,title,version}]}`
only after the complete traversal succeeds. Use `syncIssues(client, query)`
from `./sdk/dist/examples/sync.js` in another consumer. Replace a local mirror
with the new full snapshot, dropping absent rows. A failed or revoked read must
not leave an old snapshot in use. The example has no persistent cache, external
destination, automatic retry, incremental watermark or two-way sync claim.
The snapshot contains only currently readable work. An erased issue disappears
on the next successful refresh. A changed cursor result yields 409; restart the
full traversal rather than joining pages from different snapshots.

`node sdk/examples/run-agent.mjs` needs `VECTOR_URL`, `VECTOR_API_TOKEN` and
`VECTOR_ISSUE`. Select `issues:read` and `comments:read`. It prints local context:
issue identity, title, description and version, plus its currently readable
comments. Use `agentContext(client, identifier)` from
`./sdk/dist/examples/agent.js` to prepare this context in code. It reads every
comment page and rechecks the issue version before returning. No model call,
outbound transmission, agent delegation or mutation occurs. Treat the returned
user content as untrusted input and keep it private. Agent provider consent and
workflows retain their own requirements; this example creates no new authority.

All runners also accept `VECTOR_DEV_KEY` for a local development token.
Never print those credentials. The examples emit authorized issue content to
stdout; choose private storage when consuming it. A refusal emits no partial
JSON and only a fixed diagnostic to stderr. The sync and context examples stop
after 1,000 pages; narrow the query or choose a larger page size in your own
reviewed consumer when necessary.

### Release delivery and installation

Every ordinary application build checks SDK generation, compiles the client and
examples, and packages a public release asset at
`/assets/vector-sdk-VERSION.tgz`, with VERSION from Vector's `package.json`.
That asset is carried by the normal Worker artifact. It is public code and
documentation, with no installation settings or workspace records. Source
release archives retain `./sdk/` as well. No registry account is required.

Download the archive from the installation origin over HTTPS. In your consumer,
run `npm install ./vector-sdk-VERSION.tgz`, then import from
`@runeditrun/vector-sdk` and `@runeditrun/vector-sdk/examples/intake` (or `sync`
or `agent`). Node 22.20.0 or newer supplies fetch. The package includes the MIT
license, JavaScript, TypeScript declarations, the published schema, this API
guide and runnable examples. Extract it and run the scripts under its
`./examples/` directory, using the environment inputs above. The public code
archive grants no access to the installation's private API.

`node sdk/package.mjs` rebuilds just this release asset. It starts with a fresh
compiled SDK directory and copies only reviewed public code and documentation
into a temporary package; local configuration and state are never copied.
Build output remains untracked. Changing a schema requires regenerating the
source before packaging; a stale generated client fails the build.

The existing integration Verify entry point downloads this public release
asset, installs it offline as an ordinary Node consumer, and executes all three
packaged scripts against its real local Worker and D1. It checks exact intake
readback, paginated sync and refresh after edit and erasure, complete read-only
agent context, insufficient scopes, stale writes and revoked credentials. The
Worker consumer journey also exercises typed comment reads and invalid input;
refused writes leave issue storage unchanged. API-004's independent consent and
UI gate and all API-003 schema and object-operation gaps remain unchanged.

### Published operation reference

The authoritative machine-readable reference is `GET /api/v1/schema` (no token),
also shipped as `./schema/api-v1.json`. Every entry carries its operation ID,
method, path, scopes, parameters, body and declared response shapes. In a source
checkout, use `./schema/api-v1.json`; in the SDK archive use the same relative
path. Generated `Operations` gives the corresponding input, output and error
types, and exported `operations` gives the runtime method, path and scope map.
Use these references together with the native behavior descriptions above;
undeclared shapes remain unknown. To discover the exact operation ID without
guessing a route or implying unimplemented operations:

```ts
import {operations} from '@runeditrun/vector-sdk';
for (const [id, operation] of Object.entries(operations)) {
  console.log(id, operation.method, operation.path, operation.scopes);
}
```

The published families are schema and metadata reads; issue list, create, get,
update, copy, description restore, checklist and description history; comment
list, get, create, edit, delete and checklist; project list, create, get, update
and delete; milestone list, create, get, update, delete and reorder; cycle list,
create and get; label list, create and get; team create and privacy; release
list, create, get, update and scope; initiative list, create, get, update and
project membership. This catalogue does not add operations or promise complete
schema typing. The earlier Open acceptance section records remaining API gaps.
