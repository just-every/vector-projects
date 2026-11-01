# Move your issues in

Bring issues across from another tracker in a CSV or JSON file, from Linear's issue export, or from Jira Cloud's supported All Fields CSV profile. Vector shows you what it will create before it creates anything, and you can undo an import afterwards.

## Before you start

- Create the teams, statuses, people, projects, cycles and labels your issues need. Vector matches them by exact name (people by email or name) and never creates them from the file.
- One reviewed run accepts up to 4,000 source rows in a file of up to 4 MiB. Split larger files into separate runs. These limits have been exercised locally; hosted capacity is not qualified.
- Issues from a file cannot go into **Needs decision**. Give them an ordinary status, such as Backlog or Todo.

## Import a file

1. Open **Settings** and go to **Move in**.
2. Choose the **File format**: Mapped CSV, Mapped JSON array, Jira All Fields CSV (supported profile), Linear workspace CSV or Linear CSV with API file.
3. Give the import an **Import source name**, such as `migration-october`. Use the same name every time you import from the same place.
4. Choose your file.
5. For a CSV or JSON file, choose which column holds each field. Every issue needs a source record ID, a title, a team and a status; description, priority, assignee, project, cycle, labels, estimate, due date, dates, parent, dependencies and duplicates are optional. Linear and Jira profiles read their supported columns for you. Jira requires explicit confirmation of each status and priority mapping.
6. Choose defaults for empty cells, such as a default team or status. When your file uses a different name for something, match it with **Add reference mapping**: for example, the status "In Review" to your Started status.
7. Choose **Preview import**.

In a CSV file, put several labels or dependencies in one cell separated by commas; in JSON, use a list. Point a parent, dependency or duplicate at another row as `source:` and that row's ID, or at an issue already in Vector as `native:` and its identifier, such as `native:FLW-12`.

## Review, then apply

The preview lists every row with a problem, and nothing can be applied until they are fixed. Change the file or the matching and preview again.

It also lists the values Vector will not keep on the issues, under **Not imported, kept in the original file**. Read them, tick **I reviewed these omissions** when shown, then choose **Apply reviewed run**. The run publishes staged batches; each batch is all or nothing. If it stops partway through, published batches remain and **Read / resume** continues from the next batch. Importing sends no notifications, emails or invitations, and keeps the created and updated dates from your file.

Rows already imported under the same source name are not created again, so importing a file twice is safe. If a row has changed since, or someone has edited its issue in Vector, the preview shows it as a problem instead of overwriting anything.

## Linear exports

Use Linear's [workspace issue CSV export](https://linear.app/docs/exporting-data). Vector reads its Team, Title, Description, Status, Estimate, Priority, Project, Assignee, Labels, Cycle Name, Created, Updated, Due Date and Parent issue columns. Comments and attached files are not in that export, so they do not come across. An issue archived in Linear comes across as an ordinary issue, and the preview lists it.

For comments, attachment links and relations that the CSV omits, choose **Linear CSV with API file** and supply the owner-produced file described in [Linear API file](../LINEAR-API-FILE.md). Attachment bytes still do not come across.

## Jira exports

Export Jira Cloud issues with **All Fields**, then choose **Jira All Fields CSV (supported profile)**. Review the date format, mappings, comments, relationships and omissions before applying. Attachment links are optional; attached file bytes are not fetched. See [the supported Jira profile](../JIRA-CSV.md).

Linear and Jira profiles are tested with generated files. No real owner export has been supplied for either, and other export variants remain unverified.

## After an import

Each import is listed under **Retained import runs**:

- **Download originals** gives you back the exact file you imported, including any columns Vector did not use.
- **Read / resume** shows how far the import got and finishes one that was interrupted.
- **Roll back** removes that import's issues once you confirm. It refuses if anyone has edited an imported issue or its links since, so it never undoes later work. The issue numbers it used are not given out again.
