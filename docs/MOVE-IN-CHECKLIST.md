# Try one team in Vector

Use this checklist to see what moving a single team would carry and what would
remain behind. Source systems are not changed by the file import: Vector reads
the files you choose, and the reviewed run can be rolled back while no native
work conflicts with it.

## Jira Cloud CSV trial

This trial uses Jira's **All Fields** Cloud CSV and the supported profile. The
claim remains **documented format, synthetic-only; real export not supplied**
until an owner has reviewed an actual team's export. See the [Jira importer
profile](JIRA-CSV.md).

1. **Export one Jira Cloud team's issues.** Follow
   [Atlassian's Cloud CSV export guide](https://support.atlassian.com/jira/kb/how-to-export-issues-from-jira-cloud-in-csv-format/):
   select **All Fields**, retain the
   Attachment listing in the UTF-8 CSV, and keep the original unchanged. Jira's
   export gives attachment URLs, not file bytes; Vector never fetches those
   URLs. Supply bytes separately only through a separately reviewed path.
2. **Record date context.** Record the exporting account's
   [date, time and timezone preferences](https://support.atlassian.com/jira/kb/jira-csv-export-discrepancy-in-the-date-and-time-when-exporting-issues-with-csv-export/)
   and check the detected pattern and the fixed source offset
   against all date values. Stop if numeric day/month order remains ambiguous or
   an offsetless timestamp cannot be interpreted honestly; do not assume UTC or
   the machine timezone.
3. **Prepare native targets.** Create the Vector team, statuses, labels,
   projects and open cycles the team wants. Ensure the exact `epic` label exists
   if the file has Epic rows; the default treats an Epic as an ordinary parent
   issue with that label. Select the existing team by native ID. Invite only
   people who should be operators; map
   assignees explicitly to existing active operators. The importer does not
   create operators.
4. **Preview.** Settings → Move in → **Jira All Fields CSV (supported
   profile)**, or use the [Terminal command](MOVE-IN.md#terminal) with
   `--format jira-csv`. Choose a stable source namespace, configure the source
   offset/century where needed, and confirm
   status, priority, account, cycle and estimate mappings. Parent and relation
   references resolve only when their targets are in the run. A new Blocks edge
   targeting a retained reused issue refuses in preflight; review the exact
   source occurrence before continuing.
5. **Read the entire review.** Confirm every row error, unresolved reference,
   date decision, omitted field/value and original source count. Verify the
   suggested category mapping against the team's workflow: To Do → Unstarted,
   In Progress → Started, Done → Completed. These are suggestions; confirm each
   Jira status against the team's actual workflow. Decide whether to
   opt in to named HTTPS links from attachment metadata; the default is off.
   Acknowledge omissions only after reviewing them. Nothing has been written at
   this point.
6. **Apply the exact reviewed run.** Watch `applied N of M batches`. If the
   browser or terminal stops, check status and resume the same run. Repeat with
   the same reviewed identity returns the existing result; a different file or
   mapping under that identity conflicts.
7. **Reconcile.** Compare source rows with issues written, inspect every
   omission and unresolved reference, and check the source-to-Vector ID mapping.
   Verify parent, blocking and duplicate directions; source comment dates and
   read-only author names; label, status, priority, assignee, cycle and estimate
   choices; and search using the old Jira keys. Confirm that no notification,
   invitation or external event was sent for imported work.
8. **Use the trial with the team.** Keep the source file and report, and let the
   team judge the result against their Jira work. This is a file trial; it does
   not connect Vector to a live Jira site.
9. **Keep or undo.** Rollback first shows what it would remove and every issue
   with later native work. It refuses without changing anything when conflicts
   exist. For an untouched run, confirm rollback and compare the result with the
   report; allocated Vector identifiers remain reserved.

The repository acceptance fixture has 300 issues and 41 columns. See
[IMPORT-EVIDENCE.md](IMPORT-EVIDENCE.md) for native route evidence and exact-head
CLI results. The external public-port REPORT records commands, results and exact
source heads, distinguishing the earlier copied-CLI run from the
`@runeditrun/rer` CLI run. Browser captures, separate held-out proof, full
verification and exact-head CI evidence are recorded there as well.
These fixtures do not establish fidelity for a real Jira export. Public
documentation does not publish the full native export grammar, repeated Sprint
chronology, or all custom/plugin columns. Jira Server and Data Center variants,
hosted capacity, live Atlassian behavior and attachment bytes remain outside
the claim.
Wait for the owner's review of the real-export evidence, omission report,
rollback result and wording before publishing a release or broadening the
support claim; this trial does not publish, tag, deploy or touch a live Jira site.

## Linear CSV trial

1. **Export the team's issues.** In Linear, export the workspace issue CSV
   ([Exporting data](https://linear.app/docs/exporting-data)). Keep only the team
   you are trying, or import the whole file and map its teams.
2. **Make the API file (optional, recommended).** The CSV has no comments,
   attachment links or relations beyond the parent. Run the script in
   [LINEAR-API-FILE.md](LINEAR-API-FILE.md) with your own Linear API key, on your
   own machine, for that team.
3. **Prepare Vector.** Create the team, labels, projects and open cycles you want
   the issues to land in, and invite the people who will work there. A person who
   is not invited is fine: their issues land unassigned and the report lists them.
4. **Preview.** Settings → Move in → "Linear CSV with API file" (or
   "Linear workspace CSV"), a source name such as `linear-eng`, both files. Map
   any status that differs per team (`Engineering/In Review` → Started). Fix every
   error the preview lists; nothing is written until you apply.
5. **Read what will be left behind.** The review groups every value Vector will
   not import (kept in the original file) with its rows. Tick that you read it.
6. **Apply.** Watch "applied N of M batches". You can close the page; Read /
   resume continues where it stopped, and nothing is imported twice.
7. **Read the reconciliation report.** Rows read against issues written, by team,
   status, project, cycle and assignee; what was omitted; what was never in the
   files (attachment bytes, history, memberships). Download the CSV: it maps every
   Linear ID to its Vector identifier. Search for an old Linear ID to check it
   finds the work.
8. **Use it for a week.** Work in Vector as you would in Linear. Each imported
   issue says where it came from.
9. **Decide.** Keep it, or roll back: Retained import runs → Roll back shows what
   goes and refuses while anyone has edited, commented on or linked an imported
   issue (it names them). Rollback removes every issue the run created and nothing
   else; identifier numbers stay reserved and the original files stay.

What this does not prove: Vector has been tested with generated files of 2,000
and 4,000 issues on the local runtime, not with your export and not on a hosted
installation at that size.
