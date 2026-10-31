import {exerciseReferences} from './collaboration-references.mjs';
import { navigate } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { poll } from "./admin-runtime-support.mjs";
import { deliveryPresentation } from "./collaboration-delivery-ui.mjs";
import { paginationAndRemoval } from "./collaboration-pagination.mjs";
import { collaborationReads } from "./collaboration-reads.mjs";
import { collaborationPreferences } from "./collaboration-preferences.mjs";
import {
  counts,
  receipt,
  selectMention,
  settledMail,
} from "./collaboration-support.mjs";

export async function collaborationEvents({
  page,
  peer,
  runtime,
  issue,
  operator,
  capture,
  peerCapture,
  clause,
  timings,
  fixtures,
}) {
  const path = `/api/issues/${issue.identifier}`;
  const owner = runtime.sql(
    "SELECT * FROM operators WHERE email='owner@admin-runtime.test'",
  )[0];
  await navigate(peer, runtime.base + "/app/inbox");
  await peer.getByText("Nothing new.", { exact: true }).waitFor();
  await peerCapture("inbox-empty");
  const timeOrigin = await peer.evaluate(() => performance.timeOrigin);
  async function live(name, action, expected) {
    const start = performance.now();
    await action();
    await peer
      .locator(".inbox-row")
      .filter({ hasText: issue.identifier })
      .first()
      .waitFor({ timeout: Math.max(1, 5000 - (performance.now() - start)) });
    await peer
      .getByText(`${expected} unread`, { exact: true })
      .first()
      .waitFor({ timeout: Math.max(1, 5000 - (performance.now() - start)) });
    // The unread counter and inbox list refresh independently.
    await peer.waitForFunction(
      (expected) =>
        document.querySelectorAll(".inbox-row.is-unread").length === expected,
      expected,
      { timeout: Math.max(1, 5000 - (performance.now() - start)) },
    );
    const elapsedMs = performance.now() - start;
    assert.ok(
      elapsedMs <= 5000,
      `${name}: row and count visible within 5 seconds (${elapsedMs})`,
    );
    assert.equal(
      await peer.evaluate(() => performance.timeOrigin),
      timeOrigin,
      "recipient never reloaded",
    );
    assert.equal(
      await peer.locator(".inbox-row.is-unread").count(),
      expected,
      "all expected unread rows rendered with count",
    );
    timings.push({
      width: page.viewportSize().width,
      name,
      elapsedMs,
      measuredBeforeSubmit: true,
      recipientTimeOrigin: timeOrigin,
    });
    await peerCapture(name);
  }
  await clause(
    "NOTIFY-001",
    "live assignment and self suppression",
    async () => {
      await live(
        "inbox-assignment",
        () =>
          receipt(page, path, "PATCH", () =>
            page
              .getByLabel("Issue assignee", { exact: true })
              .selectOption(operator.id),
          ),
        1,
      );
      await settledMail(runtime, 1);
      assert.deepEqual(counts(runtime, issue, operator), { inbox: 1, mail: 1 });
      assert.equal(
        runtime.sql(
          `SELECT count(*) n FROM notifications WHERE recipient_id='${owner.id}'`,
        )[0].n,
        0,
      );
    },
  );
  await clause(
    "ISSUE-013",
    "keyboard selected stable description mention",
    async () => {
      await page
        .getByRole("button", { name: "Edit issue", exact: true })
        .click();
      const editor = page.locator(".issue-editor-controls [name=description]");
      await editor.fill("PRIVATE_DESCRIPTION_SENTINEL\n\n");
      await selectMention(editor, page, operator.name, () =>
        capture("description-mention-options"),
      );
      assert.equal(
        await page
          .getByRole("textbox", { name: "Description", exact: true })
          .count(),
        1,
        "selected description mention does not become part of the accessible name",
      );
      await capture("description-selected-mention");
      await live(
        "inbox-description-mention",
        () =>
          receipt(page, path, "PATCH", () =>
            page
              .getByRole("button", { name: "Save changes", exact: true })
              .click(),
          ),
        2,
      );
      const body = runtime.sql(
        `SELECT description FROM issues WHERE id='${issue.id}'`,
      )[0].description;
      assert.ok(body.includes(`@{${operator.id}|`));
      await settledMail(runtime, 2);
    },
  );
  async function comment(text, mention = false) {
    const editor = page.getByLabel("Add a comment", { exact: true });
    await editor.fill(text);
    if (mention) await selectMention(editor, page, operator.name);
    assert.equal(
      await page
        .getByRole("textbox", { name: "Add a comment", exact: true })
        .count(),
      1,
      "comment draft and selected mentions do not become part of the accessible name",
    );
    await receipt(page, path + "/comments", "POST", () =>
      page.getByRole("button", { name: "Add comment", exact: true }).click(),
    );
  }
  await clause(
    "NOTIFY-002",
    "followed comment mention overlap produces one row and one mail",
    async () => {
      const before = counts(runtime, issue, operator);
      await live(
        "inbox-comment-mention-overlap",
        () => comment("PRIVATE_COMMENT_SENTINEL ", true),
        3,
      );
      await settledMail(runtime, 3);
      assert.deepEqual(counts(runtime, issue, operator), {
        inbox: before.inbox + 1,
        mail: before.mail + 1,
      });
      const last = runtime.sql(
        `SELECT * FROM notifications WHERE recipient_id='${operator.id}' ORDER BY created_at DESC,id DESC`,
      )[0];
      assert.deepEqual(JSON.parse(last.causes_json).sort(), [
        "comment",
        "mention",
      ]);
      assert.equal(
        runtime.sql(
          `SELECT count(*) n FROM issue_followers WHERE issue_id='${issue.id}' AND operator_id='${operator.id}'`,
        )[0].n,
        1,
      );
    },
  );
  await clause(
    "NOTIFY-002",
    "followers receive plain comments without email and commenter self suppression",
    async () => {
      const before = counts(runtime, issue, operator);
      await live(
        "inbox-followed-comment",
        () => comment("A follower-visible plain comment."),
        4,
      );
      assert.deepEqual(counts(runtime, issue, operator), {
        inbox: before.inbox + 1,
        mail: before.mail,
      });
    },
  );
  await clause(
    "ISSUE-013",
    "description edit mentions only newly added recipients and leaves unknown tokens literal",
    async () => {
      const before = counts(runtime, issue, operator);
      await page
        .getByRole("button", { name: "Edit issue", exact: true })
        .click();
      const editor = page.locator(".issue-editor-controls [name=description]");
      const previous = await editor.getAttribute("data-canonical-body");
      await editor.press("ControlOrMeta+A");
      await editor.press("ArrowRight");
      assert.ok(
        await editor.evaluate(
          (element) =>
            element.selectionStart === element.value.length &&
            element.selectionEnd === element.value.length,
        ),
        "description append starts at the end of the full document",
      );
      await editor.pressSequentially(" extra unknown @Nobody");
      await capture("description-unknown-mention-empty-options");
      const refreshed = page.waitForResponse(response =>
        new URL(response.url()).pathname === path && response.request().method() === "GET" && response.ok(),
      );
      const saved = await receipt(page, path, "PATCH", () =>
        page.getByRole("button", { name: "Save changes", exact: true }).click(),
      );
      assert.ok((await (await refreshed).json()).version >= saved.version, "description refresh includes the successful writing version before reopening");
      await page.locator(".issue-description").getByText(/extra unknown @Nobody/).waitFor();
      assert.deepEqual(
        counts(runtime, issue, operator),
        before,
        "retained mention and unknown text cause no new notification",
      );
      assert.ok(
        runtime
          .sql(`SELECT description FROM issues WHERE id='${issue.id}'`)[0]
          .description.includes(previous),
      );
      assert.equal(
        runtime.sql(`SELECT description FROM issues WHERE id='${issue.id}'`)[0]
          .description,
        previous + " extra unknown @Nobody",
        "description retains the full canonical body and appends the literal suffix",
      );
      await capture("description-retained-mention-unknown-literal");
    },
  );
  await clause(
    "ISSUE-013",
    "remove and re-add selected mention creates a new edit event once",
    async () => {
      const before = counts(runtime, issue, operator);
      await page
        .getByRole("button", { name: "Edit issue", exact: true })
        .click();
      await page
        .locator(".issue-editor-controls [name=description]")
        .fill("Description without mention. Unknown @Nobody remains literal.");
      const refreshed = page.waitForResponse(response =>
        new URL(response.url()).pathname === path && response.request().method() === "GET" && response.ok(),
      );
      const removed = await receipt(page, path, "PATCH", () =>
        page.getByRole("button", { name: "Save changes", exact: true }).click(),
      );
      assert.deepEqual(
        counts(runtime, issue, operator),
        before,
        "removal neither notifies nor retracts",
      );
      await capture("description-mention-removed");
      assert.ok((await (await refreshed).json()).version >= removed.version, "mention removal refresh includes its successful writing version before reopening");
      await page.locator(".issue-description").getByText("Description without mention. Unknown @Nobody remains literal.", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Edit issue", exact: true })
        .click();
      await selectMention(
        page.locator(".issue-editor-controls [name=description]"),
        page,
        operator.name,
      );
      await capture("description-new-edit-mention");
      await live(
        "inbox-new-description-edit-mention",
        () =>
          receipt(page, path, "PATCH", () =>
            page
              .getByRole("button", { name: "Save changes", exact: true })
              .click(),
          ),
        5,
      );
      await settledMail(runtime, 4);
      assert.deepEqual(counts(runtime, issue, operator), {
        inbox: before.inbox + 1,
        mail: before.mail + 1,
      });
    },
  );
  await collaborationReads({
    peer,
    runtime,
    issue,
    operator,
    peerCapture,
    clause,
    path,
    owner,
  });
  await clause('ISSUE-017','native description and comment reactions synchronize without notifications',async()=>{
    await navigate(peer,runtime.base+'/app/issues/'+issue.identifier);
    await navigate(page,runtime.base+'/app/issues/'+issue.identifier);
    await page.getByRole('group',{name:'Comment reactions',exact:true}).last().waitFor();
    await peer.getByRole('group',{name:'Comment reactions',exact:true}).last().waitFor();
    const before=runtime.sql('SELECT count(*) n FROM notifications')[0].n;
    for(const label of ['Description reactions','Comment reactions']) {
      const own=page.getByRole('group',{name:label,exact:true}).last();
      const other=peer.getByRole('group',{name:label,exact:true}).last();
      const started=performance.now();
      await receipt(page,path+'/reactions','PUT',()=>own.getByRole('button',{name:'Add 👍 reaction',exact:true}).click());
      await other.getByRole('button',{name:'Add 👍 reaction',exact:true}).filter({hasText:'1'}).waitFor({timeout:Math.max(1,5000-(performance.now()-started))});
      await own.getByRole('button',{name:'Remove 👍 reaction',exact:true}).waitFor();
      await own.getByLabel('Who reacted 👍',{exact:true}).click();
      await own.getByRole('listitem').filter({hasText:owner.name}).waitFor();
      await capture('reactions-'+(label==='Description reactions'?'description':'comment'));
      await own.screenshot({path:'.artifacts/verification/collaboration-browser/reactions-'+(label==='Description reactions'?'description':'comment')+'-'+page.viewportSize().width+'.png'});
      await receipt(page,path+'/reactions','DELETE',()=>own.getByRole('button',{name:'Remove 👍 reaction',exact:true}).click());
    }
    assert.equal(runtime.sql('SELECT count(*) n FROM notifications')[0].n,before);
  });
  await exerciseReferences({page,runtime,issue,evidence:runtime.evidence ?? ".artifacts/verification/references"});
  await collaborationPreferences({
    page,
    peer,
    runtime,
    issue,
    operator,
    capture,
    peerCapture,
    clause,
    comment,
    owner,
  });
  await deliveryPresentation({
    page,
    peer,
    runtime,
    issue,
    operator,
    comment,
    peerCapture,
    clause,
    fixtures,
  });
  await paginationAndRemoval({
    page,
    peer,
    runtime,
    issue,
    operator,
    comment,
    peerCapture,
    capture,
    clause,
    fixtures,
  });
}
