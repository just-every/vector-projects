import {documentThreadScenario} from './document-thread-scenario';
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { contractWith } from "../contract-tags";
import { collaborationFixture } from "./collaboration-fixture";
import { changeComment } from "../../src/core/features/discussion/repository";
import { CommentPermissionError } from "../../src/core/features/discussion/permissions";

type Anchor = {quote:string;start:number;end:number;removed:boolean};
const source = "First repeat. **Quoted report** needs review. Second repeat.";
const anchor = {quote:"Quoted report",start:source.indexOf("Quoted report"),end:source.indexOf("Quoted report")+"Quoted report".length,expectedDescription:source};
type Comment = { anchor: Anchor | null; id: string; parentId: string | null; body: string | null; actor: string; canEdit: boolean; canDelete: boolean; resolvedAt: string | null; resolvedBy: string | null; deletedAt: string | null };

async function threadFixture() {
  const f = await collaborationFixture(),
    issue = await f.create({ title: "Thread subject", description: source });
  const post = async (cookie: string, body: string, parentId?: string, quoted = false) => {
    const response = await f.any(cookie, `/issues/${issue.identifier}/comments`, "POST", { body, ...(parentId ? { parentId } : {}), ...(quoted ? {anchor} : {}) });
    expect(response.status, await response.clone().text()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  const comments = async (cookie = f.cookie) =>
    ((await f.data(cookie, `/issues/${issue.identifier}/discussion`)) as { comments: Comment[] }).comments
      .map((c) => ({ ...c, canEdit: Boolean(c.canEdit), canDelete: Boolean(c.canDelete) }));
  const kinds = async () =>
    (await env.DB.prepare("SELECT kind,actor_operator_id AS actor FROM issue_activity WHERE issue_id=? AND kind LIKE 'thread.%' ORDER BY created_at,id").bind(issue.id).all()).results;
  const names = Object.fromEntries(
    (await env.DB.prepare("SELECT id,name FROM operators WHERE id IN (?,?,?)").bind(f.owner, f.bob, f.cara).all<{ id: string; name: string }>()).results.map((row) => [row.id, row.name]),
  );
  return { f, issue, post, comments, kinds, names };
}

contractWith(
  it,
  "ISSUE-008",
  "replies form ordered threads; resolving names who and when; a new reply or reopen clears it",
  async () => {
    const { f, issue, post, comments, kinds, names } = await threadFixture();
    const root = await post(f.cookie, "Which browser fails?", undefined, true);
    const first = await post(f.bobCookie, "Safari 18", root);
    const second = await post(f.caraCookie, "Also Firefox", root);
    // Replies attach only to a top-level comment of the same issue.
    expect((await f.any(f.bobCookie, `/issues/${issue.identifier}/comments`, "POST", { body: "Nested", parentId: first })).status).toBe(404);
    let shown = await comments();
    expect(shown.map((c) => [c.id, c.parentId])).toEqual([[root, null], [first, root], [second, root]]);

    const resolve = (cookie: string, resolved: boolean, id = root) =>
      f.any(cookie, `/issues/${issue.identifier}/comments/${id}/resolution`, "POST", { resolved });
    expect((await resolve(f.bobCookie, true)).status).toBe(200);
    expect((await resolve(f.bobCookie, true)).status).toBe(200);
    shown = await comments();
    expect(shown[0]).toMatchObject({ resolvedBy: names[f.bob] });
    expect(Date.parse(shown[0]!.resolvedAt!)).toBeGreaterThan(Date.now() - 60_000);
    expect(await kinds()).toEqual([{ kind: "thread.resolved", actor: f.bob }]);
    // Resolution belongs to a thread, never to a reply.
    expect((await resolve(f.bobCookie, true, first)).status).toBe(404);

    const third = await post(f.cookie, "Fixed in build 42?", root);
    shown = await comments();
    expect(shown[0]).toMatchObject({ resolvedAt: null, resolvedBy: null });
    expect(shown.at(-1)).toMatchObject({ id: third, parentId: root });
    expect(await kinds()).toEqual([{ kind: "thread.resolved", actor: f.bob }, { kind: "thread.reopened", actor: f.owner }]);

    expect((await resolve(f.caraCookie, true)).status).toBe(200);
    expect((await resolve(f.bobCookie, false)).status).toBe(200);
    expect((await comments())[0]).toMatchObject({ resolvedAt: null });
    expect((await kinds()).map((row) => row.kind)).toEqual(["thread.resolved", "thread.reopened", "thread.resolved", "thread.reopened"]);

    // The quote and its selected occurrence survive reload and edits before it.
    expect((await comments())[0].anchor).toEqual({quote:anchor.quote,start:anchor.start,end:anchor.end,removed:false});
    let current = await f.data(f.cookie, `/issues/${issue.identifier}`);
    const prefix = "🧭 New context. ";
    let updated = await f.call(`/issues/${issue.identifier}`, "PATCH", {expectedVersion:current.version,description:prefix+source+" Extra context."});
    expect(updated.status,await updated.clone().text()).toBe(200);
    current = await updated.json();
    expect((await comments())[0].anchor).toEqual({quote:anchor.quote,start:anchor.start+Array.from(prefix).length,end:anchor.end+Array.from(prefix).length,removed:false});
    updated = await f.call(`/issues/${issue.identifier}`, "PATCH", {expectedVersion:current.version,description:(prefix+source).replace("Quoted report", "")});
    expect(updated.status).toBe(200);
    current = await updated.json();
    expect((await comments())[0]).toMatchObject({id:root,body:"Which browser fails?",anchor:{quote:"Quoted report",removed:true}});
    expect((await comments()).filter(c=>c.parentId===root).map(c=>c.id)).toEqual([first,second,third]);
    expect((await f.call(`/issues/${issue.identifier}`, "PATCH", {expectedVersion:current.version,description:source})).status).toBe(200);
    expect((await comments())[0].anchor?.removed).toBe(true, "Restoring matching text never resurrects an old anchor");

    await documentThreadScenario();

    // Two identical quotes still refer to different occurrences.
    const repeat = {quote:"repeat",start:source.lastIndexOf("repeat"),end:source.lastIndexOf("repeat")+6,expectedDescription:source};
    const repeated = await f.call(`/issues/${issue.identifier}/comments`, "POST", {body:"Second occurrence",anchor:repeat});
    expect(repeated.status).toBe(201);
    const repeatId = (await repeated.json() as {id:string}).id;
    current = await f.data(f.cookie, `/issues/${issue.identifier}`);
    expect((await f.call(`/issues/${issue.identifier}`, "PATCH", {expectedVersion:current.version,description:source.replace("Second repeat.", "Second part.")})).status).toBe(200);
    expect((await comments()).find(c=>c.id===repeatId)?.anchor).toMatchObject({quote:"repeat",removed:true});

  },
);

contractWith(
  it,
  "ISSUE-008 OPS-001",
  "only the author edits a comment; authors, Owners and Admins delete it and a Member cannot delete another's",
  async () => {
    const { f, issue, post, comments } = await threadFixture();
    const owners = await post(f.cookie, "Owner's note", undefined, true);
    const bobs = await post(f.bobCookie, "Bob's note", owners);

    // Another operator's comment is read-only for edits, whatever their role.
    const edit = await f.any(f.bobCookie, `/issues/${issue.identifier}/comments/${owners}`, "PATCH", { body: "Rewritten by Bob" });
    expect(edit.status).toBe(403);
    expect(await edit.json()).toMatchObject({ error: "forbidden" });
    expect((await comments(f.bobCookie)).find((c) => c.id === owners)).toMatchObject({ body: "Owner's note", canEdit: false });
    expect((await f.any(f.bobCookie, `/issues/${issue.identifier}/comments/${bobs}`, "PATCH", { body: "Bob's edited note" })).status).toBe(200);
    expect((await f.call(`/issues/${issue.identifier}/comments/${bobs}`, "PATCH", { body: "Owner rewrite" })).status).toBe(403);

    const caraRoot = await post(f.caraCookie, "Cara's root"), reply = await post(f.cookie, "Reply under Cara's root", caraRoot);
    // A Member deletes only their own comments; an Admin or Owner deletes anyone's.
    // Bob was invited as a Member; Cara's promotion applies to her open session.
    expect((await f.call(`/settings/operators/${f.cara}/role`, "PATCH", { role: "admin" })).status).toBe(200);
    expect((await f.any(f.bobCookie, `/issues/${issue.identifier}/comments/${owners}`, "DELETE")).status).toBe(403);
    await expect(changeComment(env.DB, issue, owners, f.bob, null)).rejects.toThrow(CommentPermissionError);
    expect((await comments()).find((c) => c.id === owners)).toMatchObject({ deletedAt: null, body: "Owner's note" });
    const another = await post(f.cookie, "Second owner note");
    expect((await f.any(f.caraCookie, `/issues/${issue.identifier}/comments/${another}`, "DELETE")).status).toBe(200);
    expect(await changeComment(env.DB, issue, bobs, f.bob, null)).toBe(true);
    const deletion = await env.DB.prepare("SELECT actor_operator_id AS actor FROM audit_records WHERE action='comment.deleted' AND subject_id=?").bind(another).first();
    expect(deletion).toEqual({ actor: f.cara });

    // The owner's delete of another's comment through the public route leaves a
    // tombstone that keeps the thread's replies.
    expect((await comments()).find((c) => c.id === caraRoot)).toMatchObject({ canDelete: true, canEdit: false });
    expect((await f.call(`/issues/${issue.identifier}/comments/${caraRoot}`, "DELETE")).status).toBe(200);
    const after = await comments();
    expect(after.find((c) => c.id === caraRoot)).toMatchObject({ body: null });
    expect(after.find((c) => c.id === caraRoot)!.deletedAt).not.toBeNull();
    expect(after.find((c) => c.id === reply)).toMatchObject({ parentId: caraRoot, body: "Reply under Cara's root" });

    const snapshot = async () => Object.fromEntries(await Promise.all(["issue_comments","issue_activity","audit_records","issue_followers","issue_mentions","notifications","notification_events","notification_deliveries"].map(async table=>[table,(await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));
    let before = await snapshot();
    for (const input of [{body:"Invalid quote",anchor:{...anchor,quote:"Not the selected text"}}, {body:"Reply anchor",parentId:owners,anchor}]) {
      expect((await f.call(`/issues/${issue.identifier}/comments`, "POST", input)).status).toBe(400);
      expect(await snapshot()).toEqual(before);
    }
    // A stale source refuses all thread, activity, notification and follower writes.
    expect((await f.call(`/issues/${issue.identifier}/comments`, "POST", {body:"Stale quote",anchor:{...anchor,expectedDescription:source+" stale"}})).status).toBe(409);
    expect(await snapshot()).toEqual(before);
    expect((await f.any(f.bobCookie, `/issues/${issue.identifier}/comments/${owners}`, "PATCH", {body:"Unauthorized edit"})).status).toBe(403);
    expect(await snapshot()).toEqual(before);
    expect((await f.call(`/issues/${issue.identifier}/comments/${owners}`, "PATCH", {body:"Edited by its author"})).status).toBe(200);
    expect((await comments()).find(c=>c.id===owners)).toMatchObject({body:"Edited by its author",anchor:{quote:anchor.quote,removed:false}});

    // Current team ownership, rather than a copied permission, admits moderation.
    const team = f.initial.teams[0].id;
    expect((await f.call(`/settings/teams/${team}/members/${f.bob}`, "PUT", {role:"owner"})).status).toBe(200);
    const moderated = await post(f.caraCookie,"Moderator removes this quote",undefined,true);
    const retainedReply = await post(f.cookie,"Retained after moderation",moderated);
    expect((await comments(f.bobCookie)).find(c=>c.id===moderated)?.canDelete).toBe(true);
    expect((await f.any(f.bobCookie,`/issues/${issue.identifier}/comments/${moderated}`,"DELETE")).status).toBe(200);
    expect((await comments()).find(c=>c.id===moderated)).toMatchObject({body:null,anchor:null});
    expect((await comments()).find(c=>c.id===retainedReply)).toMatchObject({body:"Retained after moderation",parentId:moderated});
    expect(await env.DB.prepare("SELECT actor_operator_id AS actor FROM audit_records WHERE action='comment.deleted' AND subject_id=?").bind(moderated).first()).toEqual({actor:f.bob});
    expect((await f.call(`/settings/teams/${team}/members/${f.bob}`, "PUT", {role:"member"})).status).toBe(200);
    before = await snapshot();
    expect((await f.any(f.bobCookie,`/issues/${issue.identifier}/comments/${owners}`,"DELETE")).status).toBe(403);
    expect(await snapshot()).toEqual(before);

    // Guests create anchored threads only in invited teams; Viewers never write.
    expect((await f.call(`/settings/operators/${f.bob}/role`,"PATCH",{role:"guest",teamIds:[team]})).status).toBe(200);
    const guest = await post(f.bobCookie,"Guest's quoted thread",undefined,true);
    expect((await comments(f.bobCookie)).find(c=>c.id===guest)?.anchor?.quote).toBe(anchor.quote);
    const otherTeam = (await f.mutate("/settings/teams","POST",{name:"synthetic-vector-anchor",identifierPrefix:"ANCHOR"})).teams.find(t=>t.identifierPrefix==="ANCHOR")!;
    const outside = await f.create({teamId:otherTeam.id,description:source});
    before = await snapshot();
    expect((await f.any(f.bobCookie,`/issues/${outside.identifier}/comments`,"POST",{body:"Outside Guest scope",anchor})).status).toBe(404);
    expect((await f.any(f.bobCookie,`/issues/${outside.identifier}/discussion`)).status).toBe(404);
    expect(await snapshot()).toEqual(before);
    expect((await f.call(`/settings/operators/${f.cara}/role`,"PATCH",{role:"viewer"})).status).toBe(200);
    before = await snapshot();
    expect((await f.any(f.caraCookie,`/issues/${issue.identifier}/comments`,"POST",{body:"Viewer quote",anchor})).status).toBe(403);
    expect(await snapshot()).toEqual(before);
    expect((await f.call(`/settings/operators/${f.bob}`,"DELETE")).status).toBe(200);
    before = await snapshot();
    expect((await f.any(f.bobCookie,`/issues/${issue.identifier}/comments`,"POST",{body:"Revoked quote",anchor})).status).toBe(401);
    expect(await snapshot()).toEqual(before);
    expect((await f.call(`/issues/${issue.identifier}/comments/${owners}`,"DELETE")).status).toBe(200);
    expect((await comments()).find(c=>c.id===owners)).toMatchObject({body:null,anchor:null});
    expect(await env.DB.prepare("SELECT description_anchor FROM issue_comments WHERE id=?").bind(owners).first()).toEqual({description_anchor:null});
    expect(await env.DB.prepare("SELECT count(*) AS n FROM issue_followers WHERE issue_id=? AND operator_id=?").bind(issue.id,f.owner).first<number>("n")).toBe(1);

  },
);
