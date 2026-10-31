import {issueTemplatesJourney} from './issue-templates-journey.mjs';
import {assertRoleDoorCoverage} from './role-door-coverage.mjs';
import { exerciseAuditView, exerciseAuditAccess } from './admin-audit-journey.mjs';
import { projectFieldsJourney } from './core-project-fields-journey.mjs';
import assert from "node:assert/strict";
import {
  createAdminRequestDiagnostics,
  writeAdminFailureReceipt,
} from "./admin-request-diagnostics.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { contract } from "../contract.ts";
import { verificationDirectory } from "../../scripts/verification-paths.mjs";
import {
  createAdminRuntime,
  bootstrapOwner,
} from "./admin-runtime-support.mjs";
import { createStateRecorder, exportData } from "./browser-state.mjs";
import {
  auditEmptyWorkspace,
  inviteProjectLead,
  assertSignOut,
  exerciseWorkspaceRoles,
} from "./admin-access-journey.mjs";
import { createTeamWorkflow, removeUsedStatus, exerciseTeamRoles, teamCreationPermission, teamJoinPermissions } from "./admin-team-journey.mjs";
import { authorLabel, deleteAppliedLabel, memberLabelCreation } from "./admin-label-journey.mjs";
import {
  authorProject,
  milestonesJourney,
  authorCycles,
  archiveProject,
} from "./admin-project-cycle-journey.mjs";
import {
  createAdministrationIssue,
  exerciseCycleCommitments,
} from "./admin-issue-journey.mjs";
import { exerciseCycleList } from "./admin-cycle-list-journey.mjs";
import { archiveRestoreTeam } from "./admin-archive-team-journey.mjs";
import { assertSignOutReadLifecycle } from "./signout-read-lifecycle.mjs";
import { assertDocumentReadRecovery } from "./document-read-app-journey.mjs";

const evidence = resolve(verificationDirectory, "admin-browser");
await mkdir(evidence, { recursive: true });
await rm(resolve(evidence, "admin-failure-safe.json"), { force: true });
const temporary = resolve(evidence, "temporary");
await mkdir(temporary, { recursive: true });
process.env.TMPDIR = temporary;
const requestDiagnostics = createAdminRequestDiagnostics();
const results = [],
  checks = [],
  databases = [],
  browserDiagnostics = [];
let browser, page, runtime;
await contract(
  "OPS-003",
  "empty workspace administration through real mobile browser",
  async () => {
    try {
      await assertRoleDoorCoverage();
      browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
      for (const viewport of [
        { width: 390, height: 844 },
      ]) {
        requestDiagnostics.phase("bootstrap");
        runtime = createAdminRuntime(viewport.width);
        runtime.initialize();
        await runtime.start();
        const context = await browser.newContext({ viewport });
        page = await context.newPage();
        requestDiagnostics.observe(page, viewport.width);
        const expectedProjectRejections = new Set();
        const expectedTemplateConflicts = new Set();
        const roleRefusals = new Set();
        const errors = [],
          consoleErrors = [],
          failed = [],
          badResponses = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error")
            consoleErrors.push({
              message: message.text(),
              location: message.location(),
            });
        });
        page.on("requestfailed", (request) =>
          failed.push({ url: request.url(), failure: request.failure() }),
        );
        page.on("response", (response) => {
          if (
            response.status() >= 400 &&
            response.request().resourceType() === "script"
          )
            badResponses.push({
              url: response.url(),
              status: response.status(),
            });
        });
        const capture = createStateRecorder(page, evidence, results);
        const scopedCapture = (name) => capture(`${viewport.width}-${name}`);
        async function clause(id, name, run) {
          requestDiagnostics.phase(name);
          let failure;
          await contract(id, `${viewport.width}: ${name}`, async () => {
            try {
              await run();
              checks.push({ id, name, width: viewport.width, passed: true });
            } catch (error) {
              failure = error;
              checks.push({
                id,
                name,
                width: viewport.width,
                passed: false,
                message: error.message,
              });
              throw error;
            }
          });
          if (failure) throw failure;
        }
        const shared = {
          page,
          browser,
          runtime,
          capture: scopedCapture,
          clause,
          expectedTemplateConflicts,
        };
        await bootstrapOwner(page, runtime);
        await auditEmptyWorkspace(shared);
        const team = await createTeamWorkflow(shared);
        const label = await authorLabel(shared);
        const project = await authorProject(shared);
        await inviteProjectLead({ ...shared, project });
        const roles = await exerciseWorkspaceRoles({ ...shared, evidence, refusals: roleRefusals });
        try {
          await memberLabelCreation({ ...shared, ...roles, evidence, refusals: roleRefusals });
          await exerciseTeamRoles({ ...shared, evidence, refusals: roleRefusals, ...roles });
          await teamCreationPermission({ ...shared, ...roles, evidence });
          await teamJoinPermissions({ ...shared, ...roles, evidence });
          await exerciseAuditAccess({ ...shared, ...roles });
        } finally {
          await roles.context.close();
        }
        await page.setViewportSize(viewport);
        const cycles = await authorCycles({ ...shared, team });
        const issue = await createAdministrationIssue({
          ...shared,
          team,
          label,
          project,
        });
        const immutableCycleReceipts = await exerciseCycleCommitments({
          ...shared,
          issue,
          cycles,
        });
        await exerciseCycleList({ ...shared, issue, cycles });
        await removeUsedStatus({ ...shared, team, issue });
        await deleteAppliedLabel({ ...shared, label, issue });
        await archiveProject({ ...shared, project, issue });
        await archiveRestoreTeam({ ...shared, team, issue });
        await exerciseAuditView({ ...shared, evidence });
        for (const receipt of immutableCycleReceipts)
          assert.deepEqual(
            runtime.sql(
              `SELECT * FROM issue_activity WHERE id='${receipt.id}'`,
            )[0],
            receipt,
            "cycle receipts remain immutable after all administration operations",
          );
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          await projectFieldsJourney({ ...shared, capture: name => capture(name), expectedProjectRejections });
          await milestonesJourney({...shared, capture:name => capture(name)});
        }
        await page.setViewportSize(viewport);
        databases.push(await exportData(runtime, evidence, viewport.width));
        await assertDocumentReadRecovery({
          ...shared,
          capturePage: (actualPage) => {
            const capture = createStateRecorder(
              actualPage,
              evidence,
              results,
            );
            return async (name) => {
              await capture(`${viewport.width}-${name}`);
              return results.at(-1);
            };
          },
        });
        await clause("ISSUE-016", "native and scoped issue templates", () => issueTemplatesJourney(shared));
        requestDiagnostics.phase("ordinary sign-out");
        await assertSignOut(shared);
        await assertSignOutReadLifecycle({
          ...shared,
          capturePage: (actualPage) => {
            assert.notEqual(
              actualPage,
              page,
              "lifecycle capture owns the fresh private page",
            );
            const capture = createStateRecorder(
              actualPage,
              evidence,
              results,
            );
            return async (name) => {
              await capture(`${viewport.width}-${name}`);
              return results.at(-1);
            };
          },
        });
        const expectedHttpErrors = consoleErrors.filter(
          (row) =>
            /^Failed to load resource:/.test(row.message) &&
            ((row.location.url === runtime.base + "/api/settings/cycles" &&
              /400/.test(row.message)) ||
              (row.location.url === runtime.base + "/api/intake" &&
                /409/.test(row.message)) ||
              (expectedProjectRejections.has(row.location.url) && /400/.test(row.message)) ||
              (roleRefusals.has(row.location.url) && /409/.test(row.message)) ||
              (expectedTemplateConflicts.has(row.location.url) && /409/.test(row.message))),
        );
        for (const url of expectedTemplateConflicts)
          assert.equal(expectedHttpErrors.filter(row => row.location.url === url).length, 1, "exactly one asserted stale template refusal");
        assert.equal(expectedHttpErrors.filter(row => expectedProjectRejections.has(row.location.url)).length, 2, "one refused date range per viewport");
        assert.deepEqual(errors, [], "browser page errors");
        assert.deepEqual(
          consoleErrors.filter((row) => !expectedHttpErrors.includes(row)),
          [],
          "unexpected browser console errors",
        );
        browserDiagnostics.push({
          width: viewport.width,
          pageErrors: errors,
          consoleErrors,
          expectedHttpErrors,
          failed,
          badResponses,
        });
        assert.deepEqual(failed, [], "browser failed requests");
        assert.deepEqual(badResponses, [], "browser failed modules");
        await context.close();
        page = null;
        await runtime.stop();
        runtime = null;
      }
      await writeFile(
        resolve(evidence, "admin-runtime-results.json"),
        JSON.stringify(
          {
            passed: true,
            checks,
            results,
            databases,
            browserDiagnostics,
            scope:
              "Emitted local Worker, native D1 and first-owner Base confirmation; empty runtime sample data disabled.",
          },
          null,
          2,
        ) + "\n",
      );
      console.log(
        `Administration browser: ${checks.length} clause journeys, ${results.length} functional checkpoints passed.`,
      );
    } catch (error) {
      await writeAdminFailureReceipt(
        resolve(evidence, "admin-failure-safe.json"),
        {
          error,
          requests: requestDiagnostics.snapshot(),
          workerExceptions: runtime?.workerExceptions() ?? [],
          checks,
        },
      );
      if (page && !page.isClosed())
        await writeFile(
          resolve(evidence, "failure.html"),
          await page.content(),
        );
      if (page && !page.isClosed())
        await page
          .screenshot({
            path: resolve(evidence, "failure.png"),
            fullPage: true,
          })
          .catch(() => {});
      await writeFile(
        resolve(evidence, "failure.json"),
        JSON.stringify(
          {
            passed: false,
            message: error.stack,
            checks,
            results,
            log: runtime?.log,
          },
          null,
          2,
        ) + "\n",
      );
      throw error;
    } finally {
      await browser?.close();
      await runtime?.stop();
    }
  },
);
