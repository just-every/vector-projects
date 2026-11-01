# Working on Vector

## Launch for review

From this checkout, run `rer dev`. It installs and sets up a fresh checkout automatically. Allow the launch at least ten minutes; if the shell call times out, run `rer dev` again to resume. Give the owner `RER_READY` and the private `RER_OPEN` link in this chat. Do not run setup, reset or deploy just to launch a review. Stop a dev server only by its own PID when finished; never use a broad stop (owner rule, 17 October 2026). If `rer` is missing, install it with `npx -y @runeditrun/rer cli install` or the installer script at https://runeditrun.com/install.sh.

## Run it locally

Use Node 22.20.0 and the published `rer` command. `rer install` provisions the pinned pnpm automatically. From this checkout:

```sh
rer install
rer setup --owner-email owner@example.test --non-interactive
rer dev
```

Dev prints its health-ready URL, `RER_SIGNED_IN` (the owner) and `RER_OPEN`. Open `RER_OPEN` on this computer to enter as the owner; finish the first workspace review at `/setup`. The link carries this checkout's private dev key in its fragment. Never share it; reset removes the key and invalidates earlier dev browser sessions. Local titles and the app name carry a Dev suffix. Development has no toolbar or captured-mail UI. After opening the owner link, `rer dev --as teammate` in that same browser selects a second member of the same workspace, a Member (ROLE-001), and `--as signed-out` selects no session. Legacy `--login` uses the same automatic owner entry. `rer preview` serves production output and prints its ready address without captured-mail sign-in. Scripts can use `rer dev --json` or the key header. Dev sessions and their API tokens require the checkout key and are excluded from archives; `--login` no longer creates production-style credentials. Use a configured production sign-in for an external client. Stop development before resetting or restoring. Use `rer verify` for build/artifact and contract boundaries; Vector CI runs the test suites through `pnpm verify:ci`. Use `rer reset --yes` for a confirmed local reset, and `rer export --output exports/vector.jsonl` / `rer import --input exports/vector.jsonl --yes` for local archives. Deploy only when requested with `rer deploy --environment production`; production requires configured email or an approved Auth SSO dependency. `rer signin` remains hosted owner recovery using the deploying checkout's Cloudflare credentials. `rer describe` lists the remaining commands.

## Product and ownership

Vector is a self-hosted issue tracker. Read README.md, CONTRACT.md, BASELINE.md, HANDOVER.md and the actual package scripts. TanStack Start and Hono share one Cloudflare Worker, D1 records and private R2 files. Every private route and generated server function independently checks its session, Origin and ownership. Keep server secrets out of browser modules and evidence.

Keep files small, remove dead code and preserve owner customizations. No application mocks, silent failures or semantic fallbacks. Synthetic fixtures belong in tests. Recorded Base selections remain exact at the declared pin; product adapters are explicitly identified.

## Verification and recovery

Test the owner-visible flows you changed through public doors, plus typecheck. Keep the suite small. No pin tests or tests of copy, hashes, versions, lists or wording. Prove one-off corrections in external evidence. Delete obsolete tests and report them; never weaken assertions to hide a failure. Push CI shards the full verification wall and development journey. Release tags and nightly run the slow installer and README clone journeys.

Stage changes before `pnpm sources:lock`, then run `pnpm sources:check`. Preserve applied migrations and data; upgrades are forward-only. Validate matching source and D1/R2 backups in isolated resources before changing traffic. Keep terminal delivery ledgers and additive schema on compatible-source rollback.

Use rer for setup, development, build, verification, reset and data movement. Source artifact preparation and its reviewed deployment controller have a separate credential boundary described in DEPLOY.md. Local proof establishes neither hosted provider delivery nor commissioning. Do not publish, tag or deploy without explicit owner instruction. Stop every server, browser and watcher you start. Never upload settings, runtime databases, outbox bodies, cookies or credentials as evidence.

Managed source uses the vendored Base delivery producer and the declared setup manifest/digest. Its pinned workflow is manual. Signed native owner claim refuses a second claim; editor configuration belongs to the recorded installation owner and uses the configured frame-ancestors policy. Apply 0024 additively and retain claim ledgers. See docs/MANAGED-SOURCE.md; hosted installation and accounts remain owner work.

Mapped CSV/JSON issue imports, Linear's documented workspace CSV importer with optional owner-produced API-file enrichment, and Jira Cloud's supported All Fields CSV profile use the reviewed native Base import-kit path in Settings and the terminal. Review mapping, errors and omissions, then apply a run of up to 4,000 rows in staged batches; durable IDs support status, repeat, resume, a reconciliation report and whole-run rollback. Linear and Jira are documented-format, synthetic-only profiles; generator evidence covers 2,000 Linear issues and 300 Jira issues. No actual owner export has been supplied for Linear or Jira, and hosted importer acceptance or capacity is not claimed. The approved homepage says “100% free, open source alternative to Linear, Jira and Asana”; this positioning does not promise feature parity or importer coverage, and there is no Asana importer. See docs/MOVE-IN.md and docs/IMPORT-EVIDENCE.md. Local and authenticated HTTP archives use Base portability. HTTP restore requires the 0034 pristine-bootstrap admission and real coordinator binding; ordinary owner sign-in precedes setup or edits, and fresh historical-owner sign-in follows commit. Stopped, confirmed local restore into empty resources remains supported; hosted HTTPS acceptance is separate. See docs/ARCHIVES.md.

Scoped API tokens use native Base authority and existing issue/comment mutations. Signed source ingest commits issue/evidence/replay together; signed GitHub pull-request events persist links without a provider token or API call. Outbound webhooks retain accepted, rejected and uncertain states with finite retries and use Base’s enforcing transport after Settings → Connections identifies the hosting account’s excluded domains. An enforcing INTEGRATION_EGRESS service binding remains supported. Setup uses a read-only Cloudflare token once and retains no token; refresh hosting domains after account changes. Restore excludes credentials and quarantines historical effects; re-enter secrets and review future effects. See docs/API.md and docs/INTEGRATIONS.md. Apply 0027/0028 additively and retain every replay and terminal-delivery ledger.

Vector owns its fonts: `public/fonts/fonts.css`, linked by `src/core/app/fonts.ts` from the root head, holds the app's system stack and the public site's self-hosted brand faces (Instrument Sans and IBM Plex Mono, OFL, in `public/fonts/brand/` with their licences); native auth documents keep their own system stack. The public site's brand tokens are defined once in `src/core/app/site/brand/` and documented in docs/BRAND.md. Both are outside Base's copy records, so a Base refresh must not bring back Base's Outfit default or its `public/fonts` copy.

## Lander-Regenerate

After editing clause definitions and Status rows in CONTRACT.md, synchronize only the touched clause IDs and the summary counts, then check them:

```sh
node scripts/contract-docs.mjs write CLAUSE...
node scripts/contract-docs.mjs check CLAUSE...
```

Replace `CLAUSE...` with one or more actual clause IDs. The check also runs the Base contract parser. Untouched clause narratives remain intact.

Lander-Regenerate: node scripts/contract-docs.mjs write
