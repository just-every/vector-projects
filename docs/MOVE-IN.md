# Move issues into Vector

Settings → Move in accepts mapped CSV, a JSON array of objects, Linear's
workspace issue CSV, or the supported Jira Cloud All Fields CSV profile. One
reviewed run reads a whole file: up to 4,000 source rows in a file of up to 4 MiB.
Preview reads it once and
reports every error and omission; apply then publishes the run in staged
batches. Each batch publishes all its issues and relationships or none.

## Measured run limits

The limits come from measurement on the local Workers/D1 runtime
(`tests/worker/data-import-staged.test.ts` and the task evidence), not from
estimates:

| Generated Linear CSV | 2,000 issues | 4,000 issues |
| --- | --- | --- |
| File size | 2.04 MB | 4.05 MB |
| Preview (one request) | 5.8 s, 33 D1 queries | 5.2 to 10.6 s, 37 D1 queries |
| Apply: record the run (one request) | 6.2 s, 73 D1 queries | 12.2 s, 87 D1 queries |
| Retained plan | 15.8 MB | 31.6 MB |
| Batches of 33 issues | 61 | 122 |
| One batch request | 2.7 to 4.5 s, at most 594 D1 executions | 4.3 to 11.7 s, at most 614 D1 executions |
| Whole run | about 4 minutes | about 15 minutes |

Times are from the local Workers runtime on a shared, busy machine (load near
40); the D1 counts are exact. Executions per batch do not grow as a run
proceeds. 4,000 rows is the shipped row limit and 4 MiB the shipped file limit:
a generated 5,000-issue file is 5.1 MB and is refused before parsing.

## Measured on a hosted installation

A generated 2,000-issue Linear CSV (1.97 MB, with em dashes in 211 descriptions)
was imported on a Cloudflare Worker with D1 (15 October 2026). The run completed:
53 batches, 2,000 issues, the retained original's SHA-256 equal to the file's, and
all 211 em-dash descriptions stored unchanged. Preview took 4 to 14 s and
recording the run 12 to 16 s. Each batch request took 16 to 21 s, so publishing
took 16 minutes (the local figures above are for the local runtime). A run was also
rolled back from Settings.

D1 accepts at most 32 MiB in one call and sends a whole batch as one string, so a
character above U+00FF anywhere in it (an em dash, a curly quote, an emoji) makes
every character two bytes. Recording a 2,000-row run, and each batch publication,
carry the whole retained plan, so before `wire.ts` such a file failed at about 1,700
rows with a 503 `import_unavailable`. Import statements now send such text as ASCII
escapes that SQLite decodes to the same characters, and the plan is read back in
pages.

The shipped 4,000-row and 4 MiB limits come from the local runtime. A hosted Worker
has 128 MB of memory: previews of 2,400 and 2,800 generated rows (2.37 and 2.76 MB)
succeeded, and previews of 3,200 and 3,600 rows (3.17 and 3.55 MB) were stopped by
Cloudflare with 503 "Worker exceeded resource limits". Only the 2,000-row run is
proven end to end, so on a hosted installation split larger files and keep each
under about 2,000 rows and 2 MB until the hosted ceiling is measured.

What bounds a run, and how each was found:

- D1 allows 1,000 queries per Worker invocation. Preview reads the file's
  retained source claims, erased sources and earlier imports with set queries
  (about 30 queries for 2,000 rows), never one query per row.
- Each publishing request holds exactly one batch. A batch's size is measured
  at preview from the largest row: at most 500 native statements and
  1,500,000 bytes of native SQL, and few enough rows that the batch stays near
  800 executions including Base's provenance, claims, guards and reads
  (measured at most 614). A
  database trigger refuses any batch that is not exactly that size (or the final
  remainder), so "applied N of M batches" is always exact.
- The original file is retained whole: Base stores its exact bytes in 128 KiB
  chunks with their SHA-256, and the reviewed plan in ordered chunks, so export,
  restore and rollback see the exact original bytes.
- The request body for preview and apply is the base64 file plus its mapping
  (about 5.8 MB at 4 MiB); Workers accept far larger bodies, and Vector's general
  1 MB JSON limit does not apply to these two routes.
- Each batch request reads the whole retained plan back from D1. The plan is
  about eight times the CSV size, so a 2 MiB file has a plan of about 16 MB.
  Hosted Worker memory (128 MB) and CPU at that size are not measured; only
  the local runtime is.

## Applying, stopping and resuming

Apply records the run, then Settings and the terminal publish its batches one
request at a time and show "applied N of M batches" as they go. Issues from
published batches are visible straight away; each shows its source ID and,
until the run finishes, that it belongs to an unfinished run. If the browser
or terminal stops, or a batch fails, the batches already published stay and
nothing of the failed batch is written. Status reports the batches applied and
the last failure; resume publishes the remaining batches, and every source
record lands exactly once. While a run is unfinished, a different file under
the same source name is refused: resume or roll back the run first.

Choose a stable source name and map the source record ID, title, team and status.
Choose optional columns for description, priority, assignee, project, cycle,
labels, estimate, due date, expected outcome, customer impact, source timestamps,
parent, dependencies and duplicate reference. IDs, exact names and operator
emails resolve only to existing active native records. Explicit defaults cover
empty cells; reference mappings resolve source names to a chosen native ID.
Statuses and cycles must belong to the row's team. Intake requires signed
source evidence, so choose an ordinary workflow status for a file import.

Preview lists every invalid row and every omitted nonempty field, grouped by
field and reason with their rows. Fix errors and acknowledge omissions before
applying the exact reviewed run. A status or cycle name matches exactly, then by
one case-insensitive name; map the rest per team as `Team/Name` (for example
`Engineering/In Review`). An assignee who is not an active operator does not
block the run: the issue lands unassigned and the review lists the row. A
finished issue is not committed to a cycle; its cycle stays in the original. CSV supports
BOM, quoting, embedded newlines and Unicode. JSON must be an array of objects;
format is selected explicitly and parse failures never try another format.
Labels and dependencies use a comma-separated list, or arrays in JSON. Parent,
dependency and duplicate references can be `source:ID` or `native:IDENTIFIER`.
Supplied creation and update timestamps are preserved; update cannot precede
creation. Empty timestamps use the time returned by the review.

The same reviewed run returns its original result, even after it finished.
Changed source contents or a changed mapping under that identity conflict. Native edits or removal block
re-import and rollback; neither can overwrite later work. Runs retain exact file
bytes and attribution. Read durable status before retrying after a network error.
Resume repeats the retained plan. Rollback requires confirmation and preserves
consumed identifier reservations. File imports create named import activity and
one audit per new publication; they send no notifications, invitations or mail.

## Terminal

Use an absolute 0600 session file containing one cookie and an absolute review
path. The command accepts HTTPS, or an exact loopback HTTP origin for a local
installation. Credentials stay in the session file, never command arguments.
A mapping file contains `mapping`, optional `defaults`, and optional `references`.
For example `{"mapping":{"sourceId":"id","title":"title","team":"team","status":"status"}}`.

```sh
pnpm run import:issues -- preview --origin http://127.0.0.1:15920 --session-file /absolute/session --file /absolute/issues.csv --format csv --source migration-october --mapping /absolute/mapping.json --review /absolute/review.json
pnpm run import:issues -- apply --origin http://127.0.0.1:15920 --session-file /absolute/session --review /absolute/review.json --yes   # prints "applied N of M batches" to stderr
pnpm run import:issues -- status --origin http://127.0.0.1:15920 --session-file /absolute/session --run RUN_ID
pnpm run import:issues -- resume --origin http://127.0.0.1:15920 --session-file /absolute/session --run RUN_ID
pnpm run import:issues -- rollback --origin http://127.0.0.1:15920 --session-file /absolute/session --run RUN_ID --yes
```

A review is private and created exclusively with mode 0600. Apply acknowledges
the omissions retained in that review, then publishes batch by batch; stopping
it (Ctrl-C) leaves the run resumable with `resume`, and `status` reports the
batches applied and the last failure. JSON uses `--format json`; Linear uses
`--format linear-csv` with its built-in columns and any explicit reference mappings.
Jira uses `--format jira-csv`; see [Jira CSV file importer](JIRA-CSV.md) for its
source namespace, date policy, mappings, relation effects and evidence
boundary.

## Linear CSV file importer (documented format, tested with a generator)

The supported file is Linear's documented workspace issue CSV export, described
at https://linear.app/docs/exporting-data. The stable `ID` column identifies each
source record. Supported columns include Team, Title, Description, Status,
Estimate, Priority (including zero), Project, Assignee, Labels, Cycle Name,
Created, Updated, Due Date and Parent issue. Names need explicit native mappings
when they differ or are ambiguous. An Archived value is retained and reported;
Vector has no issue archive state, and importing it does not invent one.

Unsupported columns remain in the exact originals. This file does not provide
private file bytes or full comments and memberships. Vector does not fetch URLs,
create operators from assignee names, call Linear, or offer an Asana importer.
A deterministic generator (`tests/fixtures/import/linear/generate.mjs`) that
follows the documented columns produces the 2,000-issue file the tests move in.
No owner export has been supplied; this is not a verified real-export claim.

## Jira Cloud All Fields CSV (supported profile, synthetic-only)

The Jira file importer accepts a supported profile based on Jira Cloud's
documented All Fields CSV and compatible documented import encodings. Its claim
is **documented format, synthetic-only; real export not supplied**. It is not a
Jira integration: no Atlassian request is made and attachment URLs are never
fetched. Jira Server and Data Center variants, a team's native header variants,
and attachment bytes are unverified. The shared 4,000-row/4-MiB service limit
does not mean Jira scale was measured at that limit; the Jira generator evidence
covers the generated 300-issue fixture. See [IMPORT-EVIDENCE.md](IMPORT-EVIDENCE.md)
for native route evidence and CLI results. The external public-port REPORT
records exact source heads, commands and results, with labels distinguishing
the earlier copied-CLI run from the `@runeditrun/rer` CLI run. Browser captures,
held-out proof, full verification and exact-head CI evidence are recorded there
as well.

Use Jira's **All Fields** export and keep the UTF-8 file unchanged. Settings
offers **Jira All Fields CSV (supported profile)**; the importer command remains
`pnpm run import:issues` with `--format jira-csv`. For a local CLI session, start
with `rer dev --login`; build with `rer build`. The default
is preview only.
Review the whole-file date result, explicit status/priority/account/cycle
mappings, references and the complete omission report before acknowledging it
and applying. A source namespace scopes opaque numeric Issue IDs; select the
existing team by its
native ID for the proven mapping path. Mutable Issue keys are separately
retained and remain visible/searchable as old identifiers. Epic rows use the
existing exact `epic` label. Parents, outward Blocks links and duplicate-to-
canonical links are resolved inside the same run. A new Blocks edge targeting
a retained reused issue is a positional preflight error; it cannot silently
change that retained issue. Imported comments carry their
source time and read-only author name. Optional named HTTPS links from
Attachment metadata require explicit opt-in; the importer never fetches them or
imports file bytes inline. Unsupported custom/plugin fields remain in the exact
original and appear in the report.

The profile selects only the last nonempty repeated Sprint occurrence for an
explicit exact-name existing open cycle mapping; earlier occurrences remain
visible as rolled-over source values. This is a Vector policy, not proof that a
native Jira export orders repeated Sprint values chronologically. Ambiguous
numeric dates and offsetless instants without an explicit source offset are
refused. Story points take precedence over Original estimate; seconds convert
only with a reviewed exact unit policy and exact integer result. No mapping is
guessed. See [JIRA-CSV.md](JIRA-CSV.md) for the full field/date contract and
[IMPORT-EVIDENCE.md](IMPORT-EVIDENCE.md) for native route evidence and CLI
results by exact source head.
Jira needs no new migration: the existing staged storage, source identities and
imported-comment schema are reused. The owner must trial a real export before
changing the support claim.

## Undo a whole run

Settings → Retained import runs → Roll back first shows what the rollback
would remove (issues and, per table, their labels, activity, parents,
dependencies, comments and links) and every imported issue that a person has
since edited, commented on or linked, by its Vector identifier and source ID.
While any such issue exists, rollback is refused and nothing is removed; later
work is never overwritten. Otherwise the reversible part of the run
is removed in batches. Except for the DATA-011 erasure case below, every issue
it created goes. Identifier numbers stay reserved; originals not withdrawn by
erasure stay retained byte for byte, and the cycle history
records each removed issue leaving its cycle, as any deletion does. In the
terminal, `rollback --run RUN_ID` shows the same preview and `--yes` removes the
run.

Under DATA-011, personal-data erasure removes affected import custody while keeping already published normalized issues. Rollback preview and receipts list the count and identifiers of these **erasure-detached issues** separately from reversible issues remaining. A completed rollback can therefore retain the explicitly listed detached issues. If one still points to a parent, blocker or canonical issue being removed, rollback refuses with `erasure_detached`; unlink or delete that retained issue in Vector, then review rollback again. Removing a dependency records native work on both endpoints, so its imported endpoint may also need explicit deletion before rollback. Deleting the detached issue directly avoids that dependency edit. Native edits and links still refuse independently. See [personal-data erasure](ERASURE.md).

## Reconciliation report

Settings → Retained import runs → Reconciliation report, or
`pnpm run import:issues -- report --origin ... --session-file ... --run RUN_ID --csv /absolute/report.csv`,
gives one page and one CSV for a finished or partial run. The page says, in this
order, what was read (source rows), what was written (Vector issues), what was
not imported but kept in the original file (every omitted nonempty field with
its count and rows), which references were not resolved (for example an
assignee who is not an operator, row by row), and what the file never held at
all (for Linear's CSV: comments, attachment files and links, history,
memberships and relations other than the parent). Jira CSV does not carry
attachment bytes. It breaks rows read and issues
written down by team, status, project, cycle and assignee, showing what each
source value became in Vector. The CSV is the mapping file: one line per source
row with its source ID, its Vector identifier and the fields not imported.

Each imported issue shows "Imported from ENG-123". Searching for ENG-123 finds
it, and `/app/issues/ENG-123` opens it when no Vector issue has that identifier;
a Vector identifier always wins over an old source ID.

## Comments, links and relations from Linear

Linear's CSV has no comments, links or relations beyond the parent. To bring
them, make the Linear API file described in [LINEAR-API-FILE.md](LINEAR-API-FILE.md)
and use `--format linear-api-json --file /absolute/linear.csv --api-file /absolute/linear-api.json`,
or "Linear CSV with API file" in Settings. Attachment file bytes are not in
either file and the report says so.

A newly applied run reserves its whole reviewed issue-number range atomically
with its retained plan. Queued and paused runs can therefore finish while other
imports and ordinary native creation continue in the same team. Concurrent
reviews may become stale: if another allocation wins during apply, nothing from
that apply is created; preview again. Rollback keeps the high-water mark, so
reserved identifiers are never recycled, including numbers for unpublished rows.

If a native option disappears after review, the failed batch publishes nothing.
The error and retained run status identify the changed option. Use the existing
rollback review and confirm rollback when there is no later native work, then
preview again against current options. A replacement label with the same name
has a different identity and cannot repair an old plan. Later edits, comments and
relationships continue to block rollback. The upgrade reserves outstanding ranges of older runs before native creation
continues. Older runs whose ranges already collided before the upgrade report a
number conflict; the same reviewed rollback and fresh
preview route recovers them without overwriting native work.

The reconciliation CSV prefixes spreadsheet-active cells (`=`, `+`, `-`, `@`,
tab or carriage return) with an apostrophe before normal CSV quoting. The JSON
report and downloaded originals retain their exact source values.

Imported issue identifiers remain available through [imported aliases](IMPORTED-ALIASES.md), with Owner prefix controls and native identifier precedence.
