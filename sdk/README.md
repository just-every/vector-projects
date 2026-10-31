# Vector TypeScript SDK

This dependency-free server client is generated from this release's published
API schema. Node 22.20.0 or newer supplies fetch. It uses the issuing member's
current permissions on one installation. It does not register an application,
grant consent, call a model or provide separate agent authority.

Every application build includes a public archive at
`/assets/vector-sdk-VERSION.tgz`, with VERSION from Vector's package version.
Download it from your installation over HTTPS and install the local file with
`npm install ./vector-sdk-VERSION.tgz`. The archive contains JavaScript,
TypeScript declarations, all three runnable examples, the published schema,
this guide, the API reference and the MIT license. No runtime settings, tokens,
workspace data or dependencies are packaged. Source releases also retain the
generator, client and examples under `./sdk/`.

```ts
import {VectorClient, ApiError, operations} from '@runeditrun/vector-sdk';
import {intake} from '@runeditrun/vector-sdk/examples/intake';

const client = new VectorClient({baseUrl:installationOrigin, token});
const issue = await intake(client, {teamId, title});
```

Use `docs/API.md` in this archive for authentication, operations, inputs,
pagination, errors, scopes and the current schema limits. The complete declared
operation shapes are in `schema/api-v1.json` and `dist/generated.d.ts`.
An unspecified response is `unknown`, not a fully typed native model. Validate
the fields your consumer needs, as the examples do. Server constraints and
current visibility still govern every call.

To run the examples, extract the archive and enter its `package` directory.
Set `VECTOR_URL` and `VECTOR_API_TOKEN` privately in the process environment.
For a local development credential, also set `VECTOR_DEV_KEY` from that
checkout's private key file. Do not put credentials in arguments or logs.

| Script | Additional inputs | Minimum scopes | Result |
| --- | --- | --- | --- |
| `node examples/run-intake.mjs` | `VECTOR_TEAM_ID`, `VECTOR_TITLE` | `issues:write`, `issues:read` | Creates one issue and confirms exact identity and title |
| `node examples/run-sync.mjs` | `VECTOR_TEAM_ID`, optional `VECTOR_QUERY` | `issues:read` | Complete filtered snapshot of identity, title and version |
| `node examples/run-agent.mjs` | `VECTOR_ISSUE` | `issues:read`, `comments:read` | Issue context and all its currently readable comments |

Examples print authorized content to stdout. Keep that output private. Failures
print a fixed diagnostic without request or response data. No example retries a
write or handles a credential by printing it.

Sync performs a one-way full refresh, using opaque cursors and unchanged filters.
It returns only after every page succeeds. Replace a local mirror with the
complete new snapshot, removing absent records; do not append or reuse a prior
snapshot after revocation or a failed read. A 409 requires a fresh traversal.
This is not change-data capture, two-way provider sync or a deletion feed.
The page budget is 1,000; narrow the filter for larger sets.

Agent context is read-only. It returns description, issue version and comments
for local planning, checks the issue again after collecting comments, and fails
if the issue changed. Treat user content as untrusted input. It sends nothing
to an external model and never completes, assigns, deploys or merges work.
Provider consent, delegated agent authority and AGENT-series workflows retain
their independent product requirements. The example creates no stored cache.

From a source checkout, run `node sdk/generate.mjs` after changing the schema,
then `node sdk/build.mjs`. Generation supports only published operations and
preserves their method, scope, parameter, body and response declarations.
`node sdk/package.mjs` builds the release archive. Ordinary `rer build` calls
that packager after the app build, so the same public asset travels with the
Worker artifact. Existing push Verify runs the downloaded examples against a
real local Worker and persisted D1 through the integration journey.
