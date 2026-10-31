import { agentResourceParityJourney } from './core-agent-resource-parity.mjs';
import { agentApprovalJourney } from './core-agent-approval-journey.mjs';
import { openAccountMenu } from './ui-controls-checks.mjs';
import { streamControlsReady } from './core-stream-controls-browser.mjs';
import { requestLedger } from './core-request-ledger.mjs';
import { intakePolicyJourney } from './core-intake-policy-journey.mjs';
import { projectMembershipJourney } from './core-project-membership-journey.mjs';
import { currentDisjointJourney } from './core-current-disjoint-journey.mjs';
import { currentRecentlyDoneJourney } from './core-current-recently-done-journey.mjs';
import { currentNextJourney } from './core-current-next-journey.mjs';
import { currentNowJourney } from './core-current-now-journey.mjs';
import { projectRiskJourney } from './core-project-risk-journey.mjs';
import { projectHealthJourney } from './core-project-health-journey.mjs';
import { manualOrderJourney } from './core-manual-order-journey.mjs';
import { workloadJourney } from './core-workload-journey.mjs';
import { subissuesJourney } from './core-subissues-journey.mjs';
import { cycleMembershipJourney } from './core-cycle-membership-journey.mjs';
import { withInvitedOperator } from './core-operator-journey.mjs';
import { streamControlsJourney } from './core-stream-controls-journey.mjs';
import { boardJourney } from './core-board-journey.mjs';
import { expectedBoardConflicts } from './core-board-support.mjs';
import { expectedUndoConflicts } from './core-undo-properties.mjs';
import { followerJourney } from './core-follower-journey.mjs';
import { keyboardJourney } from './core-keyboard-journey.mjs';
import { draftJourney, expectedDraftFailures } from './core-draft-journey.mjs';
import { currentJourney } from './core-current-journey.mjs';
import { threadsJourney } from './core-threads-journey.mjs';
import { myWorkTabsJourney } from './core-my-work-tabs-journey.mjs';
import { pageAudit } from './core-page-audit.mjs';
import { localAuthArguments,localAuthSecret } from './outbox-session.mjs';
import { confirmLink } from './outbox-session.mjs';
// Settle native polling before replacing an authorized private document.
import {
  beforePrivateNavigation,
  settleReads,
  trackRequests,
} from "./collaboration-navigation.mjs";
import { verificationDirectory } from "../../scripts/verification-paths.mjs";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
// Resolve the serializer from the pinned Start package, with its actual plugins.
// This public no-input JSON decoder needs no fabricated Start request context.
const startRequire = createRequire(
  import.meta.resolve("@tanstack/react-start"),
);
const transportRequire = createRequire(
  startRequire.resolve("@tanstack/start-client-core/package.json"),
);
const { fromCrossJSON } = transportRequire("seroval");
const { defaultSerovalPlugins } = transportRequire("@tanstack/router-core");
const root = process.cwd(),
  base = "http://127.0.0.1:15924",
  state = `.wrangler/vector-e2e/runs/${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`,
  evidence = resolve(verificationDirectory);
// CI partitions the independent invited-operator journeys; the public command
// keeps the complete serial proof. Both partitions retain the shared doors.
const journeyGroup = process.argv[2] ?? 'all';
assert.ok(['all', 'current', 'planning'].includes(journeyGroup), 'Unknown runtime journey partition');
const ids = {
  sarah: "01J00000000000000000000002",
  flow: "01J00000000000000000000010",
  started: "01J00000000000000000000023",
};
await mkdir(evidence, { recursive: true });
function command(args) {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: resolve(verificationDirectory, "wrangler-logs"),
    },
    maxBuffer: 16 * 1024 * 1024,
  });
}
function sql(query) {
  const text = command([
    "d1",
    "execute",
    "vector-local",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--persist-to",
    state,
    "--command",
    query,
    "--json",
  ]);
  return JSON.parse(text)[0].results;
}
command([
  "d1",
  "migrations",
  "apply",
  "vector-local",
  "--local",
  "--config",
  "wrangler.jsonc",
  "--persist-to",
  state,
]);
let worker,
  workerLog = "";
function start(origin = base) {
  worker = spawn(
    process.execPath,
    [
      resolve("tests/e2e/worker-serve.mjs"),
      "--config",
      "dist/server/wrangler.json",
      "--local",
      "--test-scheduled",
      "--ip",
      "127.0.0.1",
      "--port",
      "15924",
      "--inspector-port",
      "0",
      "--persist-to",
      state,
      "--var",
      "APP_ORIGIN:" + origin,
      ...localAuthArguments,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: resolve(verificationDirectory, "wrangler-logs"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  worker.stdout.on("data", (b) => (workerLog += b));
  worker.stderr.on("data", (b) => (workerLog += b));
}
async function ready() {
  for (let i = 0; i < 150; i++) {
    if (worker.exitCode !== null) throw new Error(workerLog);
    try {
      if (
        (await fetch(base + "/health", { headers: { Connection: "close" } })).ok
      )
        return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Local worker did not become ready\n" + workerLog);
}
async function stop() {
  if (!worker) return;
  try {
    process.kill(-worker.pid, "SIGTERM");
  } catch {}
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + "/health", { headers: { Connection: "close" } });
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Owned runtime did not stop");
}
function req(path, init = {}) {
  return fetch(base + path, {
    redirect: "manual",
    ...init,
    headers: { ...init.headers, Connection: "close" },
  }).catch((error) => {
    throw new Error((init.method ?? "GET") + " " + path + " failed", {
      cause: error,
    });
  });
}
const results = [];
function record(id, detail) {
  results.push({ clause: id, passed: true, detail });
  console.info("[Vector runtime] Passed " + id);
}
let browser, browserPage;
try {
  start();
  await ready();
  const home = await req("/");
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /<!DOCTYPE html>/i);
  assert.match(homeHtml, /<title>[^<]+<\/title>/);
  assert.match(homeHtml, /<h1[^>]*>/);
  // The configured owner has already bootstrapped this fixture. The lobby's
  // claim state is independent of the owner's remaining workspace review.
  assert.equal((await (await req("/setup/state")).json()).state, "claimed");
  assert.match(homeHtml, /href="\/signin"/);
  for (const path of ["/rer-theme.css", "/brand/mark.svg", "/brand/band.svg", "/fonts/fonts.css"])
    assert.equal((await req(path)).status, 200);
  for (const path of [
    "/not-a-route",
    "/assets/not-real.js",
    "/src/main.tsx",
    "/@vite/client",
  ]) {
    for (const headers of [{}, { "Sec-Fetch-Mode": "navigate" }])
      assert.equal((await req(path, { headers })).status, 404, path);
  }
  await stop();
  start("http://canonical-owner.test:15924");
  let denied;
  for (let i = 0; i < 100; i++) {
    try {
      denied = await req("/");
      if (denied.status === 404) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(
    denied?.status,
    404,
    "The emitted Worker rejects a request outside its configured owner host",
  );
  await stop();
  start();
  await ready();
  record(
    "HOME-001",
    "Installed Lobby server-renders its heading and sign-in action for the persisted owner claim; metadata and assets verified.",
  );
  record(
    "RENDER-404",
    "Unknown documents/assets/dev paths and unsupported host return genuine 404, including navigate requests.",
  );
  sql(`UPDATE operators SET name='Sarah Chen' WHERE id='${ids.sarah}'`);
  sql("DELETE FROM access_rate_limits");
  const email = sql(`SELECT email FROM operators WHERE id='${ids.sarah}'`)[0]
    .email;
  const auth = await req("/auth/request", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ email, returnTo: "/app/my-work" }),
  });
  assert.equal(auth.status, 202);
  const link = sql(
    "SELECT json_extract(message,'$.text') AS sign_in_url FROM rer_mail_development_outbox ORDER BY created_at DESC LIMIT 1",
  )[0].sign_in_url.match(/https?:\/\/[^\s]+/)[0];
  const signed = await confirmLink(link);
  assert.equal(signed.status, 303);
  assert.equal(signed.headers.get("location"), "/app/my-work");
  const cookie = signed.headers.get("set-cookie").split(";")[0];
  assert.match(signed.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await confirmLink(link)).status, 400);
  const validHeaders = {
    Cookie: cookie,
    Origin: base,
    "Content-Type": "application/json",
  };
  const privateDoc = await req("/app", {
    headers: { Cookie: cookie, "Sec-Fetch-Mode": "navigate" },
  });
  assert.equal(privateDoc.status, 200);
  assert.match(await privateDoc.text(), /Sarah Chen/);
  sql(`UPDATE operators SET name='Sarah Runtime SSR' WHERE id='${ids.sarah}'`);
  const changedHtml = await (
    await req("/app", { headers: { Cookie: cookie } })
  ).text();
  assert.match(changedHtml, /Sarah Runtime SSR/);
  record(
    "RENDER-SSR",
    "Initial private HTML renders bound native identity; changed D1 name appears in the next raw document.",
  );
  assert.equal(
    (await req("/app/no-such-page", { headers: { Cookie: cookie } })).status,
    404,
  );
  const loaders = (await readdir("dist/server/assets")).filter(
    (n) => n.startsWith("loaders-") && n.endsWith(".js"),
  );
  const source = await readFile("dist/server/assets/" + loaders[0], "utf8");
  for (const name of await readdir("dist/client/assets")) {
    if (!name.endsWith(".js")) continue;
    const client = await readFile("dist/client/assets/" + name, "utf8");
    assert.doesNotMatch(
      client,
      /magic_links|token_hash|local_mail_outbox|blob_key|INSERT INTO operator_sessions/,
      "Server-only implementation leaked into " + name,
    );
  }
  const id = source.match(/id:\s*"([a-f0-9]{64})"/)[1];
  const rpcHeaders = {
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "x-tsr-serverFn": "true",
    Accept: "application/json",
  };
  const rpcUrl = "/_serverFn/" + id;
  const positive = await req(rpcUrl, {
    headers: { ...rpcHeaders, Cookie: cookie },
  });
  const positiveBody = await positive.text();
  assert.equal(positive.status, 200);
  assert.match(positiveBody, /Sarah Runtime SSR/);
  assert.ok(positive.headers.get("x-tss-serialized"));
  assert.match(positive.headers.get("content-type"), /application\/json/);
  const decoded = fromCrossJSON(JSON.parse(positiveBody), {
    plugins: defaultSerovalPlugins,
  });
  assert.deepEqual(decoded.result, {
    id: ids.sarah,
    name: "Sarah Runtime SSR",
    resources: {},
    editorConfigured: false,
    theme: "system",
  });
  assert.equal(decoded.error, undefined);
  const token = cookie.split("=")[1];
  const {opaqueToken,hashToken} = await import('../../vendor/base/operator-auth/crypto.mjs');
  const expired = opaqueToken(), revoked = opaqueToken();
  const now = Date.now();
  for (const [i,t,expires,revoke] of [[1,expired,now-1000,null],[2,revoked,now+86400000,now]])
    sql(`INSERT INTO oa_sessions(id,operator_id,operator_version,kind,token_hash,expires_at,revoked_at,created_at) SELECT 'e2e-session-${i}',id,version,'native','${await hashToken(localAuthSecret,'session',t)}',${expires},${revoke??'NULL'},${now} FROM oa_operators WHERE id='${ids.sarah}'`);
  const matrix = [];
  for (const [stateName, value] of [
    ["missing", ""],
    ["expired", "operator_session_local_" + new URL(base).port + "=" + expired],
    ["revoked", "operator_session_local_" + new URL(base).port + "=" + revoked],
  ]) {
    for (const path of [
      "/api",
      "/api/session",
      "/api/current",
      "/api/unknown",
    ]) {
      const r = await req(path, { headers: { Cookie: value, Origin: base } });
      assert.equal(r.status, 401);
      const body = await r.text();
      assert.ok(!body.includes("Sarah Runtime SSR"));
      matrix.push({ state: stateName, surface: path, status: r.status, body });
    }
    for (const path of [
      "/app",
      "/app/my-work",
      "/app/my-work/FLW-842",
      "/app/current/FLW-842",
      "/app/projects",
      "/app/projects/01J00000000000000000000040",
      "/app/new-issue",
      "/app/issues/FLW-842",
      "/app/no-such-page",
    ]) {
      const r = await req(path, {
        headers: { Cookie: value, "Sec-Fetch-Mode": "navigate" },
      });
      assert.equal(r.status, 302);
      assert.equal(
        r.headers.get("location"),
        "/signin?returnTo=" + encodeURIComponent(path),
      );
      assert.equal(await r.text(), "");
      matrix.push({
        state: stateName,
        surface: path,
        status: r.status,
        location: r.headers.get("location"),
      });
    }
    const rpc = await req(rpcUrl, {
      headers: { ...rpcHeaders, Cookie: value },
    });
    const body = await rpc.text();
    assert.equal(rpc.status, 200);
    assert.match(body, /signin/);
    assert.ok(!body.includes("Sarah Runtime SSR"));
    matrix.push({
      state: stateName,
      surface: "loadOperator",
      status: rpc.status,
      contentType: rpc.headers.get("content-type"),
      body,
    });
  }
  await writeFile(
    evidence + "/session-matrix.json",
    JSON.stringify(
      {
        positive: {
          status: positive.status,
          contentType: positive.headers.get("content-type"),
          serialization: positive.headers.get("x-tss-serialized"),
          body: positiveBody,
          decodedResult: decoded.result,
        },
        matrix,
      },
      null,
      2,
    ),
  );
  const originProbes = [];
  for (const probe of [
    {
      label: "contradictory hostile Origin",
      Origin: "https://hostile.test",
      "Sec-Fetch-Site": "same-origin",
    },
    {
      label: "browser-realistic cross-site",
      Origin: "https://hostile.test",
      "Sec-Fetch-Site": "cross-site",
    },
    {
      label: "contradictory cross-site metadata",
      Origin: base,
      "Sec-Fetch-Site": "cross-site",
    },
  ]) {
    const { label, ...headers } = probe;
    const response = await req(rpcUrl, {
      headers: { ...rpcHeaders, ...headers, Cookie: cookie },
    });
    const body = await response.text();
    assert.equal(response.status, 403, label);
    assert.ok(!body.includes("Sarah Runtime SSR"), label);
    originProbes.push({ label, status: response.status, body });
  }
  const sameWireControl = await req(rpcUrl, {
    headers: { ...rpcHeaders, Cookie: cookie },
  });
  assert.equal(sameWireControl.status, 200);
  assert.match(await sameWireControl.text(), /Sarah Runtime SSR/);
  await writeFile(
    evidence + "/origin-consistency.json",
    JSON.stringify(
      { positiveStatus: sameWireControl.status, originProbes },
      null,
      2,
    ),
  );
  assert.equal(
    (await req("/api/unknown", { headers: { Cookie: cookie, Origin: base } }))
      .status,
    404,
  );
  record(
    "BASE-ACCESS-002",
    "Missing, expired and revoked native sessions denied on known/unknown Hono APIs, all private document families and the only generated function; same-wire positive control and raw matrix retained.",
  );
  const create = await req("/api/issues", {
    method: "POST",
    headers: validHeaders,
    body: JSON.stringify({
      title: "Runtime persistence check",
      teamId: ids.flow,
    }),
  });
  assert.equal(create.status, 201);
  const issue = await create.json();
  const update = await req("/api/issues/" + issue.identifier, {
    method: "PATCH",
    headers: validHeaders,
    body: JSON.stringify({
      expectedVersion: 1,
      title: "Persisted across restart",
      statusId: ids.started,
    }),
  });
  assert.equal(update.status, 200);
  assert.equal(
    (
      await req("/api/issues/" + issue.identifier, {
        method: "PATCH",
        headers: validHeaders,
        body: JSON.stringify({ expectedVersion: 1, title: "Stale overwrite" }),
      })
    ).status,
    409,
  );
  const upload = await req("/api/issues/" + issue.identifier + "/files", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "text/plain",
      "X-File-Name": "restart.txt",
    },
    body: "R2 survives restart",
  });
  assert.equal(upload.status, 201);
  const file = await upload.json();
  assert.equal(
    (
      await req("/api/issues/" + issue.identifier + "/comments", {
        method: "POST",
        headers: validHeaders,
        body: JSON.stringify({ body: "Persistent discussion" }),
      })
    ).status,
    201,
  );
  await stop();
  start();
  await ready();
  assert.equal(
    (
      await (
        await req("/api/issues/" + issue.identifier, {
          headers: { Cookie: cookie },
        })
      ).json()
    ).title,
    "Persisted across restart",
  );
  assert.equal(
    await (
      await req("/api/issues/" + issue.identifier + "/files/" + file.id, {
        headers: { Cookie: cookie },
      })
    ).text(),
    "R2 survives restart",
  );
  assert.equal(
    (
      await (
        await req("/api/issues/" + issue.identifier + "/discussion", {
          headers: { Cookie: cookie },
        })
      ).json()
    ).comments[0].body,
    "Persistent discussion",
  );
  record(
    "CORE-PERSISTENCE",
    "Created/updated issue, native session, comment and R2 file survive emitted runtime restart; stale update changes nothing.",
  );
  const scheduledUpload = await req(`/api/issues/${issue.identifier}/files`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "text/plain",
      "X-File-Name": "scheduled-recovery.txt",
    },
    body: "Scheduled removal recovery evidence",
  });
  assert.equal(scheduledUpload.status, 201);
  const scheduledFile = await scheduledUpload.json();
  const removalRequestedAt = new Date().toISOString();
  sql(
    `UPDATE issue_files SET removal_requested_at='${removalRequestedAt}',removal_actor_operator_id='${ids.sarah}' WHERE id='${scheduledFile.id}'`,
  );
  // Wrangler's current built-in local event trigger works with no_bundle Start
  // emissions. Its older /__scheduled middleware requires bundling, so enabling
  // --test-scheduled alone cannot inject that path into this emitted artifact.
  // This dispatches the genuine scheduled export, not an application endpoint.
  const scheduledPath =
    "/cdn-cgi/local/scheduled?cron=" + encodeURIComponent("* * * * *");
  const scheduledResponse = await req(scheduledPath);
  assert.equal(scheduledResponse.status, 200);
  await scheduledResponse.text();
  const recoveredFile = sql(
    `SELECT removal_confirmed_at,deleted_at,name,content_type FROM issue_files WHERE id='${scheduledFile.id}'`,
  )[0];
  assert.ok(recoveredFile.removal_confirmed_at);
  assert.ok(recoveredFile.deleted_at);
  assert.equal(recoveredFile.name, "");
  assert.equal(recoveredFile.content_type, "");
  assert.equal(
    (
      await req(`/api/issues/${issue.identifier}/files/${scheduledFile.id}`, {
        headers: { Cookie: cookie },
      })
    ).status,
    404,
  );
  assert.equal(
    sql(
      `SELECT COUNT(*) n FROM audit_records WHERE subject_id='${scheduledFile.id}' AND action='file.deleted'`,
    )[0].n,
    1,
  );
  const repeatedSchedule = await req(scheduledPath);
  assert.equal(repeatedSchedule.status, 200);
  await repeatedSchedule.text();
  assert.equal(
    sql(
      `SELECT COUNT(*) n FROM audit_records WHERE subject_id='${scheduledFile.id}' AND action='file.deleted'`,
    )[0].n,
    1,
  );
  record(
    "BASE-OPS-005",
    "Actual emitted scheduled export recovers a persisted file-removal intent; download denies removed bytes, metadata is erased, and repeated local cron produces one deletion audit.",
  );
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--use-mock-keychain", "--password-store=basic", ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? ["--no-sandbox"] : [])] });
  // Browser reads and context.request calls can outlast workerd's 5 s idle
  // socket lifetime between journey steps; never reuse an idle connection.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { Connection: "close" },
  });
  const page = await context.newPage(),
    errors = [],
    failed = [],
    documents = [];
  browserPage = page;
  const externalRequests = [],
    classifiedConsole = [];
  let expectedConflictUrl = null;
  let expectedBulkConflictUrl = null;
  const classifiedDraftConsole = [];
  const classifiedBulkConsole = [];
  const classifiedBoardConsole = [];
  const classifiedUndoConsole = [];
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== base) {
      externalRequests.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const imageRequests = [];
  await page.route("https://vector-image.invalid/**", async (route) => {
    imageRequests.push({
      url: route.request().url(),
      referer: route.request().headers().referer ?? null,
    });
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxL8AAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (expectedDraftFailures.has(m.location().url) && classifiedDraftConsole.length === 0 &&
        /^Failed to load resource: the server responded with a status of 500(?: \([^)]*\))?$/.test(m.text())) {
      classifiedDraftConsole.push({ url: m.location().url, text: m.text(), expected: "Deliberate metadata GET500 with visible error and recovery asserted" });
      return;
    }
    if (expectedUndoConflicts.has(m.location().url) &&
        /^Failed to load resource: the server responded with a status of 409(?: \([^)]*\))?$/.test(m.text())) {
      classifiedUndoConsole.push({ url: m.location().url, text: m.text(), expected: "Deliberate stale Undo POST409, with unchanged issue and activity asserted" });
      return;
    }
    if (expectedBoardConflicts.has(m.location().url) &&
        /^Failed to load resource: the server responded with a status of 409(?: \([^)]*\))?$/.test(m.text())) {
      classifiedBoardConsole.push({ url: m.location().url, text: m.text(), expected: "Deliberate stale board PATCH409" });
      return;
    }
    // The keyboard flow deliberately submits one stale bulk version and
    // asserts its exact 409 response, unchanged issues, and explicit retry.
    if (expectedBulkConflictUrl && m.location().url === expectedBulkConflictUrl &&
        /^Failed to load resource: the server responded with a status of 409(?: \([^)]*\))?$/.test(m.text()) &&
        classifiedBulkConsole.length === 0) {
      classifiedBulkConsole.push({ url: m.location().url, text: m.text(), expected: "Deliberate stale bulk POST409" });
      return;
    }
    if (
      expectedConflictUrl &&
      m.location().url === expectedConflictUrl &&
      /^Failed to load resource: the server responded with a status of 409(?: \([^)]*\))?$/.test(
        m.text(),
      ) &&
      classifiedConsole.length === 0
    ) {
      classifiedConsole.push({
        url: m.location().url,
        text: m.text(),
        expected: "Deliberate stale edit PATCH409",
      });
    } else errors.push(m.text() + ' at ' + m.location().url);
  });
  page.on("requestfailed", (r) => {
    failed.push(r.url() + ":" + r.failure()?.errorText);
    console.info("[Failed browser request] " + JSON.stringify({ url: r.url(), page: page.url(), at: Date.now(), error: r.failure()?.errorText }));
  });
  trackRequests(page);
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame())
      documents.push(new URL(r.url()).pathname);
  });
  await page.goto(base + "/signin");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  const browserAuthRequest = page.waitForResponse(
    (response) =>
      response.url() === base + "/auth/request" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Send sign-in link", exact: true })
    .click();
  assert.equal((await browserAuthRequest).status(), 202);
  const browserSignInLink = sql(
    "SELECT json_extract(message,'$.text') AS sign_in_url FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='sarah@vector.test' ORDER BY created_at DESC LIMIT 1",
  )[0].sign_in_url.match(/https?:\/\/[^\s]+/)[0];
  await page.goto(browserSignInLink);
  await page.getByRole("button", {name:"Confirm",exact:true}).click();
  await page.getByRole("heading", { name: "Current", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Why this needs attention", exact: true })
    .waitFor();
  // Leaving Current unmounts the inspector; let its reads finish first.
  await settleReads(page);
  if (journeyGroup !== 'planning') {
  await withInvitedOperator(page, context, base, state, () => currentDisjointJourney(page, context, base, async (id, name, currentPage) => {
    await currentPage.screenshot({ path: evidence + '/' + name + '.png', fullPage: true });
    record(id, name);
  }), 'synthetic-vector-1901');
  await withInvitedOperator(page, context, base, state, () => currentRecentlyDoneJourney(page, context, base, async (id, name, currentPage) => {
    await currentPage.screenshot({ path: evidence + '/' + name + '.png', fullPage: true });
    record(id, name);
  }), 'synthetic-vector-1902');
  await withInvitedOperator(page, context, base, state, () => currentNowJourney(page, context, base, async (id, name, currentPage) => {
    await currentPage.screenshot({ path: evidence + '/' + name + '.png', fullPage: true });
    record(id, name);
  }), 'synthetic-vector-1903');
  await withInvitedOperator(page, context, base, state, () => currentNextJourney(page, context, base, async (id, name, currentPage) => {
    await currentPage.screenshot({ path: evidence + '/' + name + '.png', fullPage: true });
    record(id, name);
  }), 'synthetic-vector-1904');
  await currentJourney(page, context, base, ids.flow, evidence, record);
  expectedBulkConflictUrl = `${base}/api/issues/bulk`;
  // Independent keyboard, board and stream fixtures retain their assertions
  // under real invited Owners, each with the ordinary operator request budget.
  let keyboardFixture = 1910;
  await withInvitedOperator(page, context, base, state, () =>
    keyboardJourney(page, context, base, record, journey =>
      withInvitedOperator(page, context, base, state, journey, `synthetic-vector-${++keyboardFixture}`), { state, sql, evidence }), 'synthetic-vector-1910');
  expectedBulkConflictUrl = null;
  await withInvitedOperator(page, context, base, state, () => boardJourney(page, context, base, record), 'synthetic-vector-1920');
  // Each viewport proves the complete persisted-preference flow for its own Owner.
  for (const width of [1440, 390])
    await withInvitedOperator(page, context, base, state, () =>
      streamControlsJourney(page, context, base, record, undefined, [width]), `synthetic-vector-${1921 + Number(width === 390)}`);
  }
  if (journeyGroup !== 'current') {
  await withInvitedOperator(page, context, base, state, () =>
    agentResourceParityJourney({page, context, base, state, sql, evidence, record}), 'synthetic-vector-3412');
  await draftJourney(page, context, base, ids.flow, ids.sarah, record);
  await threadsJourney(page, context, base, state, ids.flow, evidence, record);
  const followerContext = await browser.newContext({ storageState: await context.storageState(), viewport: page.viewportSize() });
  const followerPage = await followerContext.newPage();
  followerPage.on('pageerror', error => errors.push(error.message));
  followerPage.on('console', message => { if (message.type() === 'error') errors.push(message.text() + ' at ' + message.location().url); });
  try {
    await followerPage.goto(base + '/app');
    await withInvitedOperator(followerPage, followerContext, base, state,
      () => followerJourney(followerPage, followerContext, page, context, base, record), 'Payment follow-up teammate');
  } finally { await followerContext.close(); }
  await myWorkTabsJourney(page, context, base, state, ids.flow, evidence, record);
  await withInvitedOperator(page, context, base, state, () => manualOrderJourney(page, context, base, record), 'synthetic-vector-1930');
  await withInvitedOperator(page, context, base, state, () => workloadJourney(page, context, base, record), 'synthetic-vector-1931');
  await agentApprovalJourney(page, context, base, state, evidence, record);
  await withInvitedOperator(page, context, base, state, () => projectHealthJourney(page, context, base, record), 'synthetic-vector-1932');
  await withInvitedOperator(page, context, base, state, () => projectRiskJourney(page, context, base, record), 'synthetic-vector-1933');
  await withInvitedOperator(page, context, base, state, () => projectMembershipJourney(page, context, base, async (id, name, currentPage) => {
    await currentPage.screenshot({ path: evidence + '/' + name + '.png', fullPage: true });
    record(id, name);
  }, state), 'Project maintenance teammate');
  await withInvitedOperator(page, context, base, state, () => intakePolicyJourney(page, context, base, async (id, name, currentPage) => {
    await currentPage.screenshot({ path: evidence + '/' + name + '.png', fullPage: true });
    record(id, name);
  }), 'Intake routing teammate');
  await withInvitedOperator(page, context, base, state, () => cycleMembershipJourney(page, context, base, record), 'synthetic-vector-1934');
  await withInvitedOperator(page, context, base, state, () => subissuesJourney(page, context, base, record), 'synthetic-vector-1935');
  }
  await pageAudit(page, base, issue.identifier, evidence, record);
  await beforePrivateNavigation(page, base + '/app');
  await page.goto(base + '/app');
  await page.waitForLoadState('networkidle');
  await streamControlsReady(page);
  await settleReads(page);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page
    .getByRole("link", { name: "My work", exact: true })
    .first()
    .click();
  await page.getByRole("heading", { name: "My work", exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  await settleReads(page);
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  await page
    .getByRole("link", { name: "Projects", exact: true })
    .first()
    .click();
  await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  const portfolioResponse = await context.request.get(base + "/api/projects");
  assert.equal(portfolioResponse.status(), 200);
  const portfolio = await portfolioResponse.json();
  assert.ok(portfolio.projects.length > 0, "Seeded portfolio supplies real progress rows");
  const progressEvidence = [];
  for (const project of portfolio.projects) {
    const progress = page.locator(`a.project-row[href="/app/projects/${project.id}"] .project-row__progress`);
    await progress.waitFor();
    const text = await progress.innerText();
    if (project.progress.percentage === null) {
      assert.ok(!/\d+(?:\.\d+)?%/.test(text), "Zero denominator never invents a percentage");
    } else {
      const counts = text.match(/(\d+)\s*\/\s*(\d+)/);
      const percent = text.match(/(\d+(?:\.\d+)?)%/);
      assert.ok(counts && percent, "Progress exposes completed/total counts beside percentage");
      assert.deepEqual([Number(counts[1]), Number(counts[2]), Number(percent[1])], [project.progress.completed, project.progress.total, project.progress.percentage]);
    }
    progressEvidence.push({ id: project.id, progress: project.progress, rendered: text });
  }
  await writeFile(evidence + "/project-progress-browser.json", JSON.stringify(progressEvidence, null, 2));
  record("PROJ-004", "Real portfolio rows expose API completed/total counts beside their percentage; null progress has no invented percentage.");
  await beforePrivateNavigation(page, base + "/app/issues/" + issue.identifier);
  await page.goto(base + "/app/issues/" + issue.identifier);
  await page
    .getByRole("heading", { name: "Persisted across restart", exact: true })
    .waitFor();
  // Edit issue covers title and description only; other fields use inline pickers.
  await page.getByRole("button", { name: "Edit issue", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Browser verified update");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page
    .getByRole("heading", { name: "Browser verified update", exact: true })
    .waitFor();
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill(
      "**Browser evidence**\n\n<script>window.injection=1</script>\n\n[Unsafe](javascript:alert(1)) [Reference](https://vector-link.invalid/evidence)\n\n![Diagram](https://vector-image.invalid/pixel.png)",
    );
  assert.equal(
    await page
      .getByRole("textbox", { name: "Add a comment", exact: true })
      .count(),
    1,
    "comment composer keeps its accessible name after entering a draft",
  );
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await page
    .locator(".comment-entry .safe-markdown strong")
    .filter({ hasText: "Browser evidence" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.injection), undefined);
  assert.equal(
    await page
      .locator(
        ".safe-markdown script,.safe-markdown form,.safe-markdown iframe,.safe-markdown img",
      )
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole("link", { name: "Unsafe", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Reference", exact: true })
      .getAttribute("rel"),
    "noopener noreferrer",
  );
  // A committed DOM containing no img/source/preload cannot initiate an image
  // fetch. Wait through browser frames rather than assuming streaming documents
  // or background tracker refreshes have a global network-idle phase.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.deepEqual(imageRequests, []);
  await page
    .getByRole("button", { name: "Load image: Diagram", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".markdown-image img")].some(
        (img) => img.complete && img.naturalWidth === 1,
      ),
    undefined,
    { timeout: 15_000 },
  );
  assert.equal(imageRequests.length, 1);
  assert.equal(imageRequests[0].referer, null);
  const browserComment = page.locator(".comment-entry").filter({
    has: page
      .locator(".safe-markdown strong")
      .filter({ hasText: "Browser evidence" }),
  });
  await browserComment
    .getByRole("button", { name: "Edit comment", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Edit comment", exact: true })
    .fill(
      "**Edited browser evidence**\n\n![Replacement](https://vector-image.invalid/replacement.png)",
    );
  assert.equal(
    await page
      .getByRole("textbox", { name: "Edit comment", exact: true })
      .count(),
    1,
    "comment editor keeps its accessible name after entering a draft",
  );
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await page
    .locator(".safe-markdown strong")
    .filter({ hasText: "Edited browser evidence" })
    .waitFor();
  assert.equal(await page.locator(".markdown-image img").count(), 0);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    imageRequests.length,
    1,
    "Replacing an image must not inherit permission to load the old URL.",
  );
  const filename = "日本語's browser evidence.txt";
  await page.getByLabel("Attach a file", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: Buffer.from("Browser upload evidence"),
  });
  const fileLink = page.getByRole("link", { name: filename, exact: true });
  await fileLink.waitFor();
  const fileResponse = await context.request.get(
    base + (await fileLink.getAttribute("href")),
  );
  assert.equal(fileResponse.status(), 200);
  assert.equal(await fileResponse.text(), "Browser upload evidence");
  await page
    .locator(".file-entry")
    .filter({ has: fileLink })
    .getByRole("button", { name: "Remove file", exact: true })
    .click();
  await fileLink.waitFor({ state: "detached" });
  const issueLinks = page.locator(".named-links").filter({
    has: page.getByRole("heading", { name: "Links", exact: true }),
  });
  async function readBrowserJson(path) {
    const response = await context.request.get(base + path, {
      timeout: 15_000,
    });
    assert.equal(response.status(), 200, path);
    return response.json();
  }
  async function addBrowserLink(section, name, url) {
    const details = section.locator("details");
    if ((await details.getAttribute("open")) === null)
      await section.locator("summary").click();
    await section.getByLabel("Name", { exact: true }).fill(name);
    await section.getByLabel("HTTPS URL", { exact: true }).fill(url);
    await section
      .getByRole("button", { name: "Add link", exact: true })
      .click();
    const anchor = section.getByRole("link", { name, exact: true });
    await anchor.waitFor();
    assert.equal(await anchor.getAttribute("href"), url);
    assert.equal(await anchor.getAttribute("rel"), "noopener noreferrer");
    assert.equal(await anchor.getAttribute("referrerpolicy"), "no-referrer");
    return anchor;
  }
  async function removeBrowserLink(section, anchor) {
    const name = await anchor.textContent();
    await section
      .locator(".file-entry")
      .filter({ has: page.getByRole("link", { name, exact: true }) })
      .getByRole("button", { name: "Remove link", exact: true })
      .click();
    await anchor.waitFor({ state: "detached" });
  }
  const browserIssueLink = await addBrowserLink(
    issueLinks,
    "Browser issue evidence",
    "https://vector-link.invalid/issue",
  );
  await removeBrowserLink(issueLinks, browserIssueLink);
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill("Browser link ownership");
  const ownershipResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${base}/api/issues/${issue.identifier}/comments` &&
      response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const ownershipResponse = await ownershipResponsePromise;
  assert.equal(ownershipResponse.status(), 201);
  const ownershipData = await readBrowserJson(
    `/api/issues/${issue.identifier}/discussion`,
  );
  const ownershipCommentId = ownershipData.comments.find(
    (comment) => comment.body === "Browser link ownership",
  )?.id;
  assert.ok(
    ownershipCommentId,
    "Browser-created comment is persisted under its issue",
  );
  const ownershipComment = page
    .locator(".comment-entry")
    .filter({ hasText: "Browser link ownership" });
  await ownershipComment.waitFor();
  const commentLinks = ownershipComment.locator(".named-links");
  const browserCommentLink = await addBrowserLink(
    commentLinks,
    "Browser comment evidence",
    "https://vector-link.invalid/comment",
  );
  await removeBrowserLink(commentLinks, browserCommentLink);
  await addBrowserLink(
    commentLinks,
    "Cascade evidence",
    "https://vector-link.invalid/cascade",
  );
  const linksBeforeDeletion = (
    await readBrowserJson(`/api/issues/${issue.identifier}/links`)
  ).links;
  const cascadeLink = linksBeforeDeletion.find(
    (entry) => entry.commentId === ownershipCommentId,
  );
  assert.ok(cascadeLink);
  await ownershipComment
    .getByRole("button", { name: "Delete comment", exact: true })
    .click();
  await ownershipComment.waitFor({ state: "detached" });
  const erasedLink = sql(
    `SELECT name,url,deleted_at FROM issue_links WHERE id='${cascadeLink.id}'`,
  )[0];
  assert.equal(erasedLink.name, null);
  assert.equal(erasedLink.url, null);
  assert.ok(erasedLink.deleted_at);
  const linksAfterDeletion = (
    await readBrowserJson(`/api/issues/${issue.identifier}/links`)
  ).links;
  assert.ok(
    !linksAfterDeletion.some((entry) => entry.commentId === ownershipCommentId),
  );
  assert.equal(
    sql(
      `SELECT COUNT(*) n FROM audit_records WHERE subject_id='${cascadeLink.id}' AND action='link.deleted'`,
    )[0].n,
    1,
  );
  record(
    "ISSUE-008 ISSUE-009",
    "Browser creates/removes named HTTPS issue and comment links; deleting the comment erases its link name/URL and records one deletion audit without fetching external URLs.",
  );

  const editBefore = await readBrowserJson(`/api/issues/${issue.identifier}`);
  // Edit issue covers title and description only; other fields use inline pickers.
  await page.getByRole("button", { name: "Edit issue", exact: true }).click();
  const titleInput = page.getByLabel("Title", { exact: true });
  await titleInput.fill("Unsaved local operator draft");
  const descriptionInput = page.getByLabel("Description", { exact: true });
  await descriptionInput.fill("Unsaved local description draft");
  assert.equal(
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .count(),
    1,
    "issue description keeps its accessible name after entering a draft",
  );
  const concurrent = await req(`/api/issues/${issue.identifier}`, {
    method: "PATCH",
    headers: validHeaders,
    body: JSON.stringify({
      expectedVersion: editBefore.version,
      title: "Concurrent authenticated API update",
    }),
  });
  assert.equal(concurrent.status, 200);
  const concurrentIssue = await concurrent.json();
  const refreshLink = await addBrowserLink(
    issueLinks,
    "Refresh parent evidence",
    "https://vector-link.invalid/refresh",
  );
  await page
    .getByRole("heading", { name: concurrentIssue.title, exact: true })
    .waitFor();
  assert.equal(await titleInput.inputValue(), "Unsaved local operator draft");
  assert.equal(
    await descriptionInput.inputValue(),
    "Unsaved local description draft",
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Your unsaved edit has been kept" })
    .waitFor();
  expectedConflictUrl = `${base}/api/issues/${issue.identifier}`;
  const conflictResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === expectedConflictUrl &&
      response.request().method() === "PATCH",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const conflictResponse = await conflictResponsePromise;
  assert.equal(conflictResponse.status(), 409);
  assert.equal(
    conflictResponse.request().postDataJSON().expectedVersion,
    editBefore.version,
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Reload before applying your edit" })
    .waitFor();
  assert.equal(await titleInput.inputValue(), "Unsaved local operator draft");
  assert.equal(
    await descriptionInput.inputValue(),
    "Unsaved local description draft",
  );
  const afterConflict = await readBrowserJson(
    `/api/issues/${issue.identifier}`,
  );
  assert.equal(afterConflict.title, concurrentIssue.title);
  assert.equal(afterConflict.version, concurrentIssue.version);
  assert.equal(afterConflict.description, concurrentIssue.description);
  assert.deepEqual(conflictResponse.request().postDataJSON(), {
    expectedVersion: editBefore.version,
    title: "Unsaved local operator draft",
    description: "Unsaved local description draft",
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expectedConflictUrl = null;
  await page.getByRole("button", { name: "Reload issue", exact: true }).click();
  await page.waitForFunction(
    (title) => document.querySelector('input[name="title"]')?.value === title,
    concurrentIssue.title,
    { timeout: 15_000 },
  );
  assert.equal(
    await descriptionInput.inputValue(),
    concurrentIssue.description,
  );
  await page.getByRole("button", { name: "Cancel edit", exact: true }).click();
  await removeBrowserLink(issueLinks, refreshLink);
  record(
    "ISSUE-006",
    "Open editor keeps its draft and original expectedVersion through a parent refresh; concurrent API write causes PATCH409 without overwrite, and explicit validated reload replaces the draft.",
  );

  await beforePrivateNavigation(page, base + "/app/new-issue");
  await page.goto(base + "/app/new-issue");
  await page.getByRole("heading", { name: "New issue", exact: true }).waitFor();
  const browserCreatedTitle = "Browser created work " + Date.now();
  await page.getByRole("textbox", { name: /^Title/ }).fill(browserCreatedTitle);
  await page.getByLabel(/^Description/).fill("**Native browser creation**");
  assert.equal(
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .count(),
    1,
    "new issue description has a stable accessible name independent of its draft and Markdown hint",
  );
  await page.getByLabel(/^Team/).selectOption(ids.flow);
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${base}/api/issues` &&
      response.request().method() === "POST",
    { timeout: 15_000 },
  );
  const createTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page
    .getByRole("button", { name: "Create issue", exact: true })
    .first()
    .click();
  const browserCreatedResponse = await createResponsePromise;
  assert.equal(browserCreatedResponse.status(), 201);
  await page.waitForURL(/\/app\/issues\/FLW-[1-9][0-9]*$/, { timeout: 15_000 });
  const browserCreatedIdentifier = new URL(page.url()).pathname
    .split("/")
    .at(-1);
  const browserCreated = await readBrowserJson(
    `/api/issues/${browserCreatedIdentifier}`,
  );
  await page
    .getByRole("heading", { name: browserCreatedTitle, exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => performance.timeOrigin),
    createTimeOrigin,
  );
  assert.equal(browserCreated.status.category, "backlog");
  assert.equal(browserCreated.version, 1);
  assert.match(browserCreated.identifier, /^FLW-[1-9][0-9]*$/);
  record(
    "ISSUE-001",
    "Native browser New Issue submits persisted Backlog work and navigates to the returned stable identifier without a document reload.",
  );
  await beforePrivateNavigation(page, base + "/app/new-issue");
  await page.goto(base + "/app/new-issue");
  await page.getByRole("radio", { name: /Intake/ }).check();
  await page
    .getByRole("heading", { name: "New intake", exact: true })
    .waitFor();
  const intakeTitle = "Browser operator intake " + Date.now();
  await page.getByRole("textbox", { name: /^Title/ }).fill(intakeTitle);
  await page.getByLabel(/^Team/).selectOption(ids.flow);
  await page
    .getByLabel(/^Evidence summary/)
    .fill("Customer observed a queue delay.");
  await page.getByLabel(/^Evidence link/).fill("https://example.test/intake");
  await page.getByText("Measurements · optional", { exact: true }).click();
  await page
    .getByRole("button", { name: "Add measurement", exact: true })
    .click();
  await page
    .getByLabel("Measurement 1 name", { exact: true })
    .fill("delaySeconds");
  await page
    .getByLabel("Measurement 1 type", { exact: true })
    .selectOption("number");
  await page.getByLabel("Measurement 1 value", { exact: true }).fill("0");
  await page.getByText("Customer reports · optional", { exact: true }).click();
  await page
    .getByRole("button", { name: "Add customer report", exact: true })
    .click();
  await page
    .getByLabel("Customer report 1 customer", { exact: true })
    .fill("Synthetic customer");
  await page
    .getByLabel("Customer report 1 summary", { exact: true })
    .fill("Delay observed twice");
  await page
    .getByLabel("Customer report 1 link", { exact: true })
    .fill("https://example.test/customer");
  await page
    .locator(".new-issue-header")
    .getByRole("button", { name: "← Back", exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/app/issues/" + browserCreated.identifier);
  await page.getByRole("heading", { name: browserCreatedTitle, exact: true }).waitFor();
  await beforePrivateNavigation(page, base + "/app/new-issue");
  await page.goto(base + "/app/new-issue");
  await page
    .getByRole("heading", { name: "New intake", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: /^Title/ }).inputValue(),
    intakeTitle,
  );
  assert.equal(
    await page.getByLabel("Measurement 1 value", { exact: true }).inputValue(),
    "0",
  );
  assert.equal(
    await page
      .getByLabel("Customer report 1 summary", { exact: true })
      .inputValue(),
    "Delay observed twice",
  );
  await page.screenshot({
    path: evidence + "/operator-intake-form.png",
    fullPage: true,
  });
  const intakeResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === base + "/api/intake" &&
      response.request().method() === "POST",
    { timeout: 15000 },
  );
  let releaseIntake;
  const intakeGate = new Promise((resolve) => {
    releaseIntake = resolve;
  });
  let intakeRequestArrived;
  const intakeArrival = new Promise((resolve) => {
    intakeRequestArrived = resolve;
  });
  const holdIntake = async (route) => {
    intakeRequestArrived();
    await intakeGate;
    await route.continue();
  };
  await page.route(base + "/api/intake", holdIntake);
  await page
    .getByRole("button", { name: "Create intake", exact: true })
    .first()
    .click();
  await intakeArrival;
  assert.equal(
    await page.getByRole("textbox", { name: /^Title/ }).isDisabled(),
    true,
  );
  assert.equal(await page.getByLabel(/^Team/).isDisabled(), true);
  assert.equal(
    await page.getByRole("radio", { name: /Intake/ }).isDisabled(),
    true,
  );
  releaseIntake();

  const intakeResponse = await intakeResponsePromise;
  await page.unroute(base + "/api/intake", holdIntake);
  assert.equal(intakeResponse.status(), 201);
  await page.waitForURL(/\/app\/issues\/FLW-[1-9][0-9]*$/, { timeout: 15000 });
  const intakeIdentifier = new URL(page.url()).pathname.split("/").at(-1);
  const browserIntake = await readBrowserJson(
    `/api/issues/${intakeIdentifier}`,
  );
  assert.equal(browserIntake.status.category, "intake");
  assert.equal(browserIntake.evidence[0].originKind, "operator");
  assert.equal(browserIntake.evidence[0].measurements.delaySeconds, 0);
  assert.equal(
    browserIntake.evidence[0].customerReports[0].customer,
    "Synthetic customer",
  );
  assert.deepEqual(browserIntake.evidence[0].assertions, {});
  await page
    .getByText("Sarah Runtime SSR reported", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator(".assertion-list")
      .getByText("Suggested next step", { exact: true })
      .count(),
    0,
  );
  const intakeCurrent = await readBrowserJson("/api/current");
  assert.ok(
    intakeCurrent.sections["needs-decision"].some(
      (row) => row.identifier === browserIntake.identifier,
    ),
  );
  await page.screenshot({
    path: evidence + "/operator-intake-evidence.png",
    fullPage: true,
  });
  record(
    "INTAKE-001",
    "Native browser creates operator-attributed Intake with primitive measurements and customer reports, durable first evidence and no invented policy assertion; Current includes its persisted identifier.",
  );

  const triage = page.locator(".decision-panel");
  await triage
    .getByRole("heading", { name: "Make the triage call", exact: true })
    .waitFor();
  await triage.getByRole("tab", { name: "Defer", exact: true }).click();
  const { effectiveTimezone } = await readBrowserJson("/api/settings/personal-time");
  const localDeferralTime = await page.evaluate((timezone) => {
    const future = new Date(Date.now() + 600000);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(future).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }, effectiveTimezone);
  await triage.getByLabel(/^Return for decision/).fill(localDeferralTime);
  const deferResponsePromise = page.waitForResponse(
    (response) =>
      response.url() ===
        base + `/api/issues/${browserIntake.identifier}/defer` &&
      response.request().method() === "POST",
  );
  await triage
    .getByRole("button", { name: "Defer decision", exact: true })
    .click();
  assert.equal((await deferResponsePromise).status(), 200);
  await triage
    .getByRole("tab", { name: "End deferral", exact: true })
    .waitFor();
  const afterDeferCurrent = await readBrowserJson("/api/current");
  assert.ok(
    !afterDeferCurrent.sections["needs-decision"].some(
      (row) => row.identifier === browserIntake.identifier,
    ),
  );
  await triage.getByRole("tab", { name: "End deferral", exact: true }).click();
  const earlyReturnPromise = page.waitForResponse(
    (response) =>
      response.url() ===
        base + `/api/issues/${browserIntake.identifier}/return` &&
      response.request().method() === "POST",
  );
  await triage
    .getByRole("button", { name: "End deferral now", exact: true })
    .click();
  assert.equal((await earlyReturnPromise).status(), 200);
  await triage
    .getByRole("tab", { name: "End deferral", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await triage
      .getByRole("button", { name: "End deferral now", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await triage
      .getByRole("tab", { name: "Accept", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  const earlyReturned = await readBrowserJson(
    `/api/issues/${browserIntake.identifier}`,
  );
  assert.equal(earlyReturned.version, 3);
  assert.equal(earlyReturned.deferredUntil, null);
  assert.ok(
    earlyReturned.activity.some(
      (row) =>
        row.kind === "intake.returned" && row.actor === "Sarah Runtime SSR",
    ),
  );
  assert.ok(earlyReturned.decisions.some((row) => row.kind === "deferred"));
  const afterReturnCurrent = await readBrowserJson("/api/current");
  assert.ok(
    afterReturnCurrent.sections["needs-decision"].some(
      (row) => row.identifier === browserIntake.identifier,
    ),
  );
  await triage.getByRole("tab", { name: "Accept", exact: true }).click();
  await triage.getByLabel(/^Assignee/).selectOption(ids.sarah);
  await triage.getByLabel(/^Start status/).selectOption(ids.started);
  await triage
    .getByLabel(/^Reason/)
    .fill("Browser accepts isolated persisted intake");
  const acceptResponsePromise = page.waitForResponse(
    (response) =>
      response.url() ===
        `${base}/api/issues/${browserIntake.identifier}/accept` &&
      response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await triage
    .getByRole("button", { name: "Accept and route work", exact: true })
    .click();
  const acceptResponse = await acceptResponsePromise;
  assert.equal(acceptResponse.status(), 200);
  const accepted = await readBrowserJson(
    `/api/issues/${browserIntake.identifier}`,
  );
  assert.equal(accepted.status.id, ids.started);
  assert.equal(accepted.assignee.id, ids.sarah);
  assert.equal(accepted.version, 4);
  assert.ok(
    accepted.decisions.some(
      (decision) =>
        decision.kind === "accepted" &&
        decision.reason === "Browser accepts isolated persisted intake",
    ),
  );
  await triage.waitFor({ state: "detached" });
  record(
    "INTAKE-005",
    "Browser-created native operator Intake defers, returns early and accepts with persisted evidence, version increments and retained decisions; signed source delivery is pending.",
  );
  const dueCreated = await req("/api/intake", {
    method: "POST",
    headers: {
      cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Scheduled operator intake",
      teamId: ids.flow,
    }),
  });
  assert.equal(dueCreated.status, 201);
  const dueIssue = await dueCreated.json();
  const dueDeferral = await req(`/api/issues/${dueIssue.identifier}/defer`, {
    method: "POST",
    headers: {
      cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expectedVersion: 1,
      returnAt: new Date(Date.now() + 2500).toISOString(),
      reason: "Scheduled local return",
    }),
  });
  assert.equal(dueDeferral.status, 200);
  await dueDeferral.arrayBuffer();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const dueSchedule = await req(scheduledPath);
  assert.equal(dueSchedule.status, 200);
  await dueSchedule.arrayBuffer();
  const dueReturned = await readBrowserJson(
    `/api/issues/${dueIssue.identifier}`,
  );
  assert.equal(dueReturned.deferredUntil, null);
  assert.equal(dueReturned.version, 3);
  assert.equal(
    dueReturned.activity.filter((row) => row.kind === "intake.returned").length,
    1,
  );
  assert.equal(dueReturned.activity.at(-1).actor, "Deferral return automation");
  assert.equal(dueReturned.decisions.at(-1).reason, "Scheduled local return");
  const dueRepeat = await req(scheduledPath);
  assert.equal(dueRepeat.status, 200);
  await dueRepeat.arrayBuffer();
  const dueAgain = await readBrowserJson(`/api/issues/${dueIssue.identifier}`);
  assert.equal(dueAgain.version, 3);
  record(
    "INTAKE-006",
    "Actual emitted scheduled export clears due persisted deferral once with named automation/version/activity, retains old decision, and repeated cron does not duplicate; browser early return is separately verified.",
  );
  await writeFile(
    evidence + "/operator-intake-return.json",
    JSON.stringify(
      {
        passed: true,
        created: browserIntake.identifier,
        earlyReturned: earlyReturned.version,
        accepted: accepted.version,
        scheduled: {
          identifier: dueIssue.identifier,
          version: dueAgain.version,
          actor: "Deferral return automation",
          returnedExactlyOnce: true,
        },
      },
      null,
      2,
    ),
  );
  await beforePrivateNavigation(page, base + "/app/issues/" + issue.identifier);
  await page.goto(base + "/app/issues/" + issue.identifier);
  await page
    .getByRole("heading", { name: concurrentIssue.title, exact: true })
    .waitFor();
  await writeFile(
    evidence + "/links-editor-intake-browser.json",
    JSON.stringify(
      {
        passed: true,
        namedIssueAndCommentLinks: true,
        commentLinkErasure: {
          commentId: ownershipCommentId,
          linkId: cascadeLink.id,
        },
        draftPreservedAcrossParentRefresh: true,
        originalExpectedVersion: editBefore.version,
        conflictStatus: conflictResponse.status(),
        concurrentVersion: concurrentIssue.version,
        classifiedConsole: [...classifiedConsole, ...classifiedBulkConsole, ...classifiedUndoConsole],
        explicitReload: true,
        browserCreated: {
          identifier: browserCreated.identifier,
          status: browserCreated.status.category,
        },
        intakeAccepted: {
          identifier: accepted.identifier,
          version: accepted.version,
        },
        operatorIntakeCreated: {
          identifier: browserIntake.identifier,
          version: browserIntake.version,
          sourceFixture: false,
        },
        earlyReturn: { version: earlyReturned.version, retainedDecision: true },
        sourceIntakePending: true,
        scheduledRemovalConfirmed: true,
      },
      null,
      2,
    ),
  );
  await writeFile(
    evidence + "/markdown-upload-browser.json",
    JSON.stringify(
      {
        passed: true,
        formatting: true,
        rawHtmlAndUnsafeLinksRemoved: true,
        imageRequests,
        replacementRequiresNewPermission: true,
        unicodeUploadDownloadRemoval: true,
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: evidence + "/core-journey-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: evidence + "/core-journey-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "No horizontal overflow on mobile",
  );
  assert.equal(classifiedDraftConsole.length, journeyGroup === 'current' ? 0 : 1, 'Exactly the injected metadata failure is classified');
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  assert.deepEqual(externalRequests, []);
  record(
    "RENDER-BROWSER",
    "Hydration and internal navigation retain performance.timeOrigin; UI issue/comment/link persistence works; raw HTML is removed; only the intentional metadata GET500 and stale-edit PATCH409 and stale-bulk POST409 resource console events are classified; no unexpected page/console/request errors or external URL fetches; desktop/mobile screenshots captured.",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const browserSignoutPromise = page.waitForResponse(
    (response) =>
      response.url() === base + "/auth/signout" &&
      response.request().method() === "POST",
  );
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const browserSignout = await browserSignoutPromise;
  assert.equal(browserSignout.status(), 204);
  const browserSessionCookie = (await browserSignout.request().allHeaders())
    .cookie;
  assert.ok(browserSessionCookie);
  await page.waitForURL("**/signin");
  assert.equal(
    (await req("/api/session", { headers: { Cookie: browserSessionCookie } }))
      .status,
    401,
  );
  const originalSignout = await req("/auth/signout", {
    method: "POST",
    headers: validHeaders,
    body: "{}",
  });
  assert.equal(originalSignout.status, 204);
  await originalSignout.arrayBuffer();
  assert.equal(
    (await req("/api/session", { headers: { Cookie: cookie } })).status,
    401,
  );
  record(
    "BASE-ACCESS-001",
    "Native allow-listed single-use sign-in and persisted session revoke work through emitted Worker and browser. Local outbox only; external delivery remains unverified.",
  );
  sql(`UPDATE operators SET name='Sarah Chen' WHERE id='${ids.sarah}'`);
  await writeFile(
    evidence + "/runtime-results.json",
    JSON.stringify({ passed: true, results, documents, requestLedger: requestLedger(sql) }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: true, checks: results.length, evidence }, null, 2),
  );
} catch (error) {
  if (browserPage && !browserPage.isClosed()) {
    await writeFile(
      evidence + "/runtime-failure-dom.html",
      await browserPage.content(),
    ).catch(() => {});
    await browserPage
      .screenshot({
        path: evidence + "/runtime-failure-browser.png",
        fullPage: true,
        timeout: 5_000,
      })
      .catch(() => {});
  }
  await writeFile(
    evidence + "/runtime-failure.log",
    String(error.stack) + "\n" + workerLog,
  );
  throw error;
} finally {
  if (browser) await browser.close();
  await stop();
}
