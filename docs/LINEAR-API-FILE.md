# The Linear API file

Linear's CSV export ([Exporting data](https://linear.app/docs/exporting-data))
carries issues but not their comments, attachment links or relations other than
the parent. Linear's GraphQL API has them. You can produce one JSON file with
them, on your own machine with your own Linear API key, and Vector merges it
with the CSV in the same reviewed run (`--format linear-api-json`, or "Linear CSV
with API file" in Settings → Move in).

Vector never calls Linear, never holds your Linear key, and never fetches a
link from the file.

## Make the file

Create a personal API key in Linear (Settings → Security & access). The API
takes it in the `Authorization` header with no `Bearer` prefix
([GraphQL API](https://linear.app/developers/graphql)). From this checkout:

```sh
LINEAR_API_KEY=lin_api_your_key node scripts/data/linear-api-file.mjs --team ENG --out /absolute/linear-api.json
```

`--team` is the team key (the `ENG` in `ENG-123`). Run it once per team you move.
The script pages through every issue of that team, including archived ones, and
through any issue with more than 50 comments, attachments or relations, then
writes the file with mode 0600. Your key stays in the environment variable; it is
never printed or written.

The script sends this query to `https://api.linear.app/graphql`, 25 issues at a
time, following `pageInfo.endCursor` while `hasNextPage` is true
([Pagination](https://linear.app/developers/pagination)):

```graphql
query VectorMoveIn($team: String!, $after: String) {
  issues(first: 25, after: $after, includeArchived: true, filter: { team: { key: { eq: $team } } }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      identifier
      parent { identifier }
      comments(first: 50) { pageInfo { hasNextPage endCursor } nodes { body createdAt user { displayName name } externalUser { name } botActor { name } } }
      attachments(first: 50) { pageInfo { hasNextPage endCursor } nodes { title url } }
      relations(first: 50) { pageInfo { hasNextPage endCursor } nodes { type relatedIssue { identifier } } }
    }
  }
}
```

For a longer connection it asks for the next page of that one connection:

```graphql
query VectorMoveInMore($id: String!, $after: String) {
  issue(id: $id) { comments(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { body createdAt user { displayName name } externalUser { name } botActor { name } } } }
}
```

(with `attachments` or `relations` in place of `comments`). The field names come
from Linear's published schema: `Issue.identifier`, `Issue.parent`,
`Comment.body`, `Comment.createdAt`, `Comment.user`, `Comment.externalUser`,
`Comment.botActor`, `Attachment.title`, `Attachment.url`, `IssueRelation.type`
(`blocks`, `duplicate`, `related`, `similar`) and `IssueRelation.relatedIssue`.

## The shape Vector accepts

```json
{
  "format": "vector-linear-api-v1",
  "issues": [
    {
      "identifier": "ENG-123",
      "parent": { "identifier": "ENG-100" },
      "comments": { "nodes": [ { "body": "Markdown text", "createdAt": "2025-03-04T10:11:12.000Z", "user": { "displayName": "Jane", "name": "Jane Doe" } } ] },
      "attachments": { "nodes": [ { "title": "Design", "url": "https://docs.example.com/design" } ] },
      "relations": { "nodes": [ { "type": "blocks", "relatedIssue": { "identifier": "ENG-124" } } ] }
    }
  ]
}
```

`parent` may be `null`; `comments`, `attachments` and `relations` may be absent.
A comment's author is the first of `user.displayName`, `user.name`,
`externalUser.name` and `botActor.name`.

## What Vector does with it

Each API issue joins the CSV row with the same `ID`, and travels with that row:
the reviewed fingerprint, retained originals (both files, byte for byte) and the
"changed file conflicts" rule cover it like any column.

- **Comments** become imported comments with their original body and creation
  time. The author's name is kept as a read-only name snapshot, shown as
  "Jane (imported)". No operator is created for that person, no mention resolves,
  nobody is subscribed and no notification, mail or webhook is sent.
- **Attachments** become named links through the same HTTPS-only rule as links a
  person adds (ISSUE-009). Vector never fetches them. Any other scheme
  (`javascript:`, `http:`, `file:`, or a URL with credentials) is refused with its
  row, and nothing of the run is written until it is fixed.
- **Relations.** `blocks` becomes a dependency (the related issue is blocked) and
  `duplicate` makes the issue a duplicate of the related issue, when both issues
  are in the run. When the other issue is not in the run, the relation is not
  linked and the reconciliation report lists it with its row. `related` becomes a symmetric related link without blocking when both issues
  are imported in this run. Reciprocal entries produce one pair. `similar` has
  no matching link and remains in the report.
- **Parent** fills in a parent the CSV left empty.
- **Attachment file bytes** are not in the API file (it lists links), and the
  report says so.

Refused before anything is written, each with its position and Linear ID: an
issue in the API file that is not a row of the CSV, a comment for such an issue,
an unsafe link, a malformed node, or a repeated identifier.

No owner API file has been supplied. This is tested with files from the
generator in `tests/fixtures/import/linear/generate.mjs` and with the export
script against a local stand-in for Linear's endpoint, not against Linear.
