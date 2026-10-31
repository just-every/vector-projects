import { lifecycleOperation, observeLifecycle, lifecycleEvidence } from "./collaboration-lifecycle.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { contract } from "../contract.ts";
import { verificationDirectory } from "../../scripts/verification-paths.mjs";
import { createStateRecorder } from "./browser-state.mjs";
import { bootstrapOwner } from "./admin-runtime-support.mjs";
import { createTeamWorkflow } from "./admin-team-journey.mjs";
import { authorLabel } from "./admin-label-journey.mjs";
import { authorProject, authorCycles } from "./admin-project-cycle-journey.mjs";
import { createCollaborationIssue } from "./collaboration-issue.mjs";
import {
  collaborationRuntime,
  inviteRecipient,
  exportCollaboration,
  rowCustody,
} from "./collaboration-support.mjs";
import { disabledEmailJourney } from "./collaboration-disabled.mjs";
import { collaborationEvents } from "./collaboration-events.mjs";

const evidence = resolve(verificationDirectory, "collaboration-browser");
await mkdir(evidence, { recursive: true });
const results = [],
  checks = [],
  databases = [],
  timings = [],
  diagnostics = [],
  readbacks = [],
  fixtures = [],
  installations = [];
let browser, runtime, page, peer, context, recipient;
await contract(
  "OPS-004",
  "real first-owner collaboration at mobile",
  async () => {
    try {
      browser = await chromium.launch({
        headless: true,
        args: ["--use-mock-keychain", "--password-store=basic"],
      });
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
      ]) {
        runtime = await collaborationRuntime(viewport.width);
        runtime.initialize();
        await runtime.start();
        context = await browser.newContext({ viewport });
        page = await context.newPage();
        const errors = [],
          failed = [],
          badModules = [],
          consoleErrors = [];
        const expectedTemplateConflicts = new Set();
        const observe = (p) => {
          observeLifecycle(p, `${viewport.width}-${p === page ? "actor" : "recipient"}`);
          p.on("console", (message) => {
            if (message.type() === "error")
              consoleErrors.push({
                message: message.text(),
                location: message.location(),
              });
          });
          p.on("pageerror", (e) => errors.push(e.message));
          // Leaving a document aborts the reads it still owns. Only an abort of
          // a read started before a later main-frame navigation is expected;
          // every other failed request, aborted or not, still fails the run.
          let navigations = 0;
          const startedBefore = new WeakMap();
          p.on("request", (r) => {
            if (r.isNavigationRequest() && r.frame() === p.mainFrame()) navigations++;
            else startedBefore.set(r, navigations);
          });
          p.on("requestfailed", (r) => {
            const failure = r.failure();
            if (failure?.errorText === "net::ERR_ABORTED" && startedBefore.has(r) && navigations > startedBefore.get(r)) return;
            failed.push({ url: r.url(), failure });
          });
          p.on("response", (r) => {
            if (r.status() >= 400 && r.request().resourceType() === "script")
              badModules.push({ url: r.url(), status: r.status() });
          });
        };
        observe(page);
        const capture = createStateRecorder(page, evidence, results);
        const scopedCapture = (name) =>
          capture(`${viewport.width}-actor-${name}`);
        async function clause(id, name, run) {
          const snapshot = () =>
            Object.fromEntries(
              [
                "issues",
                "issue_followers",
                "issue_mentions",
                "notifications",
                "notification_events",
                "notification_deliveries",
                "notification_delivery_attempts",
                "notification_mail_audit",
                "rer_mail_development_outbox",
                "issue_notification_mutes",
                "notification_type_mutes",
                "notification_preferences",
              ].map((table) => [table, rowCustody(runtime.sql(`SELECT * FROM ${table}`))]),
            );
          const before = snapshot();
          let failure;
          await contract(id, `${viewport.width}: ${name}`, async () => {
            try {
              await lifecycleOperation(`${viewport.width} ${id}: ${name}`, run, page);
              checks.push({ id, name, width: viewport.width, passed: true });
            } catch (e) {
              failure = e;
              checks.push({
                id,
                name,
                width: viewport.width,
                passed: false,
                message: e.message,
              });
              throw e;
            }
          });
          readbacks.push({
            id,
            name,
            width: viewport.width,
            before,
            after: snapshot(),
          });
          if (failure) throw failure;
        }
        const shared = { page, runtime, capture: scopedCapture, clause, expectedTemplateConflicts };
        await bootstrapOwner(page, runtime);
        const team = await createTeamWorkflow(shared);
        const label = await authorLabel(shared);
        const project = await authorProject(shared);
        await authorCycles({ ...shared, team });
        recipient = await inviteRecipient({ ...shared, browser });
        peer = recipient.peer;
        observe(peer);
        const issue = await createCollaborationIssue({
          ...shared,
          team,
          label,
          project,
        });
        await clause(
          "ISSUE-008",
          "mobile issue retains open description and outcome",
          async () => {
              assert.ok(
                await page
                  .locator(".issue-description .safe-markdown")
                  .getByText("First authored paragraph.", { exact: false })
                  .isVisible(),
                "description open",
              );
              assert.ok(
                await page.locator(".issue-outcome").isVisible(),
                "outcome open",
              );
          },
        );
        const peerCapture = createStateRecorder(peer, evidence, results);
        await collaborationEvents({
          ...shared,
          peer,
          issue,
          operator: recipient.operator,
          peerCapture: (name) =>
            peerCapture(`${viewport.width}-recipient-${name}`),
          timings,
          fixtures,
        });
        assert.deepEqual(errors, [], "no browser page errors");
        assert.deepEqual(failed, [], "no browser request failures");
        assert.deepEqual(badModules, [], "no browser module failures");
        const isRevokedProjection = (address) => {
          const url = new URL(address);
          if (url.origin !== runtime.base) return false;
          const reads = url.pathname === '/api/refresh'
            ? url.searchParams.getAll('read') : [url.pathname];
          return reads.length > 0 && reads.every((read) => {
            const projection = new URL(read, runtime.base);
            return projection.origin === runtime.base &&
              /^\/api\/(?:notifications(?:\/count)?|mentions\/options|triage-responsibility)$/.test(projection.pathname);
          });
        };
        const expectedHttpErrors = consoleErrors.filter(
          (row) =>
            /^Failed to load resource:/.test(row.message) &&
            ((row.location.url === runtime.base + "/api/settings/cycles" &&
              /400/.test(row.message)) ||
              (expectedTemplateConflicts.has(row.location.url) && /409/.test(row.message)) ||
              (/401/.test(row.message) &&
                isRevokedProjection(row.location.url) &&
                runtime.sql(
                  "SELECT count(*) n FROM operators WHERE removed_at IS NOT NULL",
                )[0].n > 0)),
        );
        for (const url of expectedTemplateConflicts)
          assert.equal(expectedHttpErrors.filter(row => row.location.url === url).length, 1, "exactly one asserted stale template refusal");
        assert.deepEqual(
          consoleErrors.filter((row) => !expectedHttpErrors.includes(row)),
          [],
          "no unexpected browser console errors",
        );
        diagnostics.push({
          width: viewport.width,
          errors,
          failed,
          badModules,
          consoleErrors,
          expectedHttpErrors,
        });
        databases.push(
          await exportCollaboration(runtime, evidence, viewport.width),
        );
        await recipient.context.close();
        recipient = null;
        peer = null;
        await context.close();
        context = null;
        page = null;
        await runtime.stop();
        runtime = await collaborationRuntime(viewport.width);
        runtime.config.NOTIFICATION_EMAIL_ENABLED = "false";
        runtime.initialize();
        await runtime.start();
        context = await browser.newContext({ viewport });
        page = await context.newPage();
        observe(page);
        const disabledCapture = createStateRecorder(page, evidence, results);
        await disabledEmailJourney({
          page,
          browser,
          runtime,
          capture: (name) => disabledCapture(`${viewport.width}-actor-${name}`),
          captureFor: (other) => {
            observe(other);
            const capture = createStateRecorder(other, evidence, results);
            return (name) => capture(`${viewport.width}-recipient-${name}`);
          },
          clause,
          installations,
        });
        databases.push(
          await exportCollaboration(
            runtime,
            evidence,
            `${viewport.width}-disabled`,
          ),
        );
        assert.deepEqual(
          errors,
          [],
          "disabled installation browser page errors",
        );
        assert.deepEqual(failed, [], "disabled installation failed requests");
        assert.deepEqual(
          badModules,
          [],
          "disabled installation failed modules",
        );
        await context.close();
        context = null;
        page = null;
        await runtime.stop();
        runtime = null;
      }
      await writeFile(
        resolve(evidence, "collaboration-runtime-results.json"),
        JSON.stringify(
          {
            passed: true,
            checks,
            results,
            databases,
            timings,
            diagnostics,
            readbacks,
            fixtures,
            installations,
            scope:
              "Emitted local Worker and native D1; no sample data; separate native sessions; Base development mail only. No real provider or mailbox proof.",
          },
          null,
          2,
        ) + "\n",
      );
      console.log(
        `Collaboration browser: ${checks.length} clause journeys, ${results.length} functional checkpoints, ${timings.length} live timings passed.`,
      );
    } catch (error) {
      await writeFile(
        resolve(evidence, "collaboration-request-lifecycle.json"),
        JSON.stringify(lifecycleEvidence(), null, 2) + "\n",
      );
      if (peer && !peer.isClosed()) {
        await writeFile(
          resolve(evidence, "peer-failure.html"),
          await peer.content(),
        );
        await peer.screenshot({
          path: resolve(evidence, "peer-failure.png"),
          fullPage: true,
        });
      }
      if (page && !page.isClosed())
        await page.screenshot({
          path: resolve(evidence, "failure.png"),
          fullPage: true,
        });
      await writeFile(
        resolve(evidence, "failure.json"),
        JSON.stringify(
          {
            passed: false,
            message: error.stack,
            checks,
            results,
            timings,
            log: runtime?.log,
          },
          null,
          2,
        ) + "\n",
      );
      // Safe for CI upload: exception classes, SQLite codes and source frames
      // only, never messages, SQL, request values or the raw Worker log.
      // Wrangler prints a request's exception just after sending its 500.
      await new Promise((done) => setTimeout(done, 1000));
      await writeFile(
        resolve(evidence, "collaboration-failure-safe.json"),
        JSON.stringify({ workerExceptions: runtime?.workerExceptions() ?? [] }, null, 2) + "\n",
      );
      throw error;
    } finally {
      await recipient?.context.close();
      await context?.close();
      await browser?.close();
      await runtime?.stop();
    }
  },
);
