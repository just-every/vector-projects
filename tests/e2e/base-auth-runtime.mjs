import { finishFirstRun } from './first-run-fixture.mjs';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { readLocalD1 } from './local-d1-read.mjs';
import { devKey, keyHeader } from './dev-gate.mjs';
import { readDevelopmentLink } from './outbox-session.mjs';
import { freePort } from '@runeditrun/rer/adapter-settings';

// A fixed port inside the ephemeral range can already be held by another
// socket on a shared runner. One free port serves both starts of this run.
const port = await freePort(), origin = `http://127.0.0.1:${port}`;
const state = `.wrangler/base-auth-${process.pid}`;
const evidence = resolve(process.env.VECTOR_AUTH_EVIDENCE ?? '.wrangler/base-auth-evidence');
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
const processEnvironment = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve('.wrangler/base-auth-logs') };
const config = {
  APP_ORIGIN: origin, SEED_SAMPLE_DATA: 'false', MAIL_MODE: 'local-outbox',
  FIRST_OWNER_EMAIL: 'owner@auth-runtime.test', FIRST_OWNER_NAME: 'Workspace owner',
  WORKSPACE_NAME: 'Auth runtime', WORKSPACE_TIMEZONE: 'UTC',
  DEFAULT_TEAM_NAME: 'Delivery', DEFAULT_TEAM_PREFIX: 'AUTH',
  SESSION_SECRET: 'synthetic-fixture-local-runtime-secret-at-least-32-characters',
  MAIL_FROM: 'Vector <signin@auth-runtime.test>', RER_DEV_KEY: devKey,
};
const run = args => execFileSync(process.execPath, [wrangler,...args], { encoding:'utf8',env:processEnvironment,maxBuffer:16*1024*1024 });
const sql = query => readLocalD1(state, query);
const link = email => sql(`SELECT json_extract(message,'$.text') AS sign_in_url FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='${email}' ORDER BY created_at DESC,sequence DESC LIMIT 1`)[0].sign_in_url.match(/https?:\/\/[^\s]+/)[0];
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
let worker, browser;
async function start() {
  worker = spawn(process.execPath,[wrangler,'dev','--config','dist/server/wrangler.json','--local','--ip','127.0.0.1','--port',String(port),'--inspector-port','0','--persist-to',state,...Object.entries(config).flatMap(([key,value])=>['--var',key+':'+value])],{env:processEnvironment,detached:true,stdio:'ignore'});
  for(let attempt=0;attempt<150;attempt++) {
    if(worker.exitCode!==null) throw Error('Auth Worker exited before readiness');
    try { if((await fetch(origin+'/health')).ok) return; } catch {}
    await pause(200);
  }
  throw Error('Auth Worker readiness timed out');
}
async function stop() {
  if(!worker) return;
  const owned=worker; worker=null;
  try { process.kill(-owned.pid,'SIGTERM'); } catch(error) { if(error.code!=='ESRCH') throw error; }
  for(let attempt=0;attempt<100&&owned.exitCode===null;attempt++) await pause(50);
  if(owned.exitCode===null) try {process.kill(-owned.pid,'SIGKILL');} catch(error) {if(error.code!=='ESRCH') throw error;}
  // The restart reuses this port, so the old Worker must have released it.
  for(let attempt=0;attempt<100&&owned.exitCode===null;attempt++) await pause(50);
}
try {
  await mkdir(evidence,{recursive:true});
  run(['d1','migrations','apply','vector-local','--local','--config','wrangler.jsonc','--persist-to',state]);
  await start();
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/signin');
  await page.getByLabel('Email',{exact:true}).fill(config.FIRST_OWNER_EMAIL);
  const sent=page.waitForResponse(response=>response.url()===origin+'/auth/request'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Send sign-in link',exact:true}).click();
  assert.equal((await sent).status(),202);
  // The email-link path stays proven: the test observes delivery at the mail edge.
  assert.equal((await fetch(origin+'/__dev/outbox')).status,404,'the captured-mail viewer is retired');
  assert.equal((await fetch(origin+'/__dev/outbox',{headers:keyHeader('not-the-key-'+'x'.repeat(43))})).status,404);
  const ownerLink=await readDevelopmentLink(origin,(path,method,body,cookie,headers)=>fetch(origin+path,{method,headers}),config.FIRST_OWNER_EMAIL,state);
  assert.equal(new URL(ownerLink).pathname,'/auth/confirm');
  await page.goto(ownerLink);
  assert.equal(sql('SELECT count(*) n FROM oa_sessions')[0].n,0);
  await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await page.waitForURL(origin+'/setup');
  await finishFirstRun(page,origin);await page.goto(origin+'/app');
  await page.waitForURL(origin+'/app');
  assert.ok((await context.cookies()).some(cookie=>cookie.name==='operator_session_local_'+port));
  assert.ok(!(await context.cookies()).some(cookie=>cookie.name==='vector_session'));
  let handoffSubmissions=0;
  page.on('request',request=>{if(request.url()===origin+'/auth/request')handoffSubmissions++;});
  const spec=JSON.parse(await readFile('management/integration/deployment-spec.json','utf8'));
  const signInUrl=new URL(spec.surfaces.app.signIn.path,origin);
  signInUrl.searchParams.set('login_hint',config.FIRST_OWNER_EMAIL);
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:width===1440?1000:844});
    for(const [returnTo,destination,name] of [
      [undefined,'/app','app'],
      ['/app/settings','/app/settings','settings'],
      ['https://forbidden.example.test/','/app','unsafe'],
    ]) {
      const handoff=new URL(signInUrl);
      if(returnTo) handoff.searchParams.set('returnTo',returnTo);
      await page.goto(handoff.href);
      assert.equal(page.url(),origin+destination,`signed-in ${name} handoff at ${width}`);
      assert.equal(await page.getByRole('button',{name:'Send sign-in link',exact:true}).count(),0);
      assert.equal(handoffSubmissions,0,'an admitted handoff never requests another email');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:resolve(evidence,`signed-in-handoff-${name}-${width}.png`),fullPage:true});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/app/settings/people');
  await page.getByRole('heading',{name:'People',exact:true,level:1}).waitFor();
  await page.getByRole('button',{name:'Invite',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Invited peer');
  await page.getByLabel('Email',{exact:true}).fill('peer@auth-runtime.test');
  await page.getByLabel('Role',{exact:true}).selectOption('admin');
  await page.getByRole('button',{name:'Send invitation',exact:true}).click();
  const invited=page.waitForResponse(response=>response.url()===origin+'/api/settings/operators/invite');
  await page.getByRole('button',{name:'Confirm and send',exact:true}).click();
  const invitation = await invited;
  assert.equal(invitation.status(),202);
  assert.equal((await invitation.json()).delivery,'local');
  const peerContext=await browser.newContext();
  const peer=await peerContext.newPage(); peer.on('pageerror',error=>errors.push(error.message));
  await peer.goto(link('peer@auth-runtime.test'));
  await peer.getByRole('button',{name:'Confirm',exact:true}).click();
  await peer.waitForURL(origin+'/app');
  await peer.goto(origin+'/app/settings/people');
  // An Admin removes Members and itself, never an Owner, and invites Members, named-team Guests or Viewers.
  await peer.getByRole('link',{name:/Invited peer \(you\)/}).click();
  await peer.getByRole('button',{name:'Leave workspace',exact:true}).waitFor();
  await peer.goto(origin+'/app/settings/people');
  await peer.getByRole('link',{name:/Workspace owner/}).click();
  await peer.getByText('Installation owner',{exact:false}).first().waitFor();
  assert.equal(await peer.getByRole('button',{name:/^(Remove|Leave)/}).count(),0);
  await peer.goto(origin+'/app/settings/people');
  await peer.getByRole('button',{name:'Invite',exact:true}).click();
  assert.deepEqual(await peer.getByLabel('Role',{exact:true}).locator('option').allTextContents(),['Member','Guest','Viewer']);
  await peer.getByLabel('Name',{exact:true}).fill('Invited member');
  await peer.getByLabel('Email',{exact:true}).fill('member@auth-runtime.test');
  await peer.getByRole('button',{name:'Send invitation',exact:true}).click();
  const memberInvite=peer.waitForResponse(response=>response.url()===origin+'/api/settings/operators/invite');
  await peer.getByRole('button',{name:'Confirm and send',exact:true}).click();
  assert.equal((await memberInvite).status(),202);
  const memberLink=link('member@auth-runtime.test');
  await page.reload();
  await page.getByRole('link',{name:/Invited peer/}).click();
  await page.getByRole('button',{name:'Remove Invited peer',exact:true}).waitFor();
  await page.screenshot({path:resolve(evidence,'base-invite-settings-1440.jpg'),type:'jpeg',quality:85,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:resolve(evidence,'base-invite-settings-390.jpg'),type:'jpeg',quality:85,fullPage:true});
  await page.getByRole('button',{name:'Remove Invited peer',exact:true}).click();
  const removed=page.waitForResponse(response=>response.url().startsWith(origin+'/api/settings/operators/')&&response.request().method()==='DELETE');
  await page.getByRole('button',{name:'Confirm removal',exact:true}).click();
  assert.equal((await removed).status(),200);
  await page.getByRole('link',{name:/Invited peer/}).waitFor({state:'detached'});
  // The removal answers by returning to the People list without them.
  await page.getByRole('group',{name:'Remove this member?',exact:true}).waitFor({state:'detached'});
  await page.getByRole('list',{name:'People',exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/app/settings/people');
  assert.equal((await peer.request.get(origin+'/api/session')).status(),401);
  assert.equal((await fetch(memberLink)).status,400);
  // Unload app documents while preserving both native cookie jars across restart.
  await Promise.all(browser.contexts().flatMap(context=>context.pages()).map(page=>page.goto('about:blank')));
  await stop(); await start();
  assert.equal((await peerContext.request.get(origin+'/api/session')).status(),401);
  await page.goto(origin+'/app/settings');
  await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
  await peerContext.close();
  assert.equal(sql('SELECT count(*) n FROM operators WHERE removed_at IS NULL')[0].n,1);
  assert.equal(sql('SELECT count(*) n FROM workflow_statuses')[0].n,7);
  assert.deepEqual(errors,[]);
  await stop();
  await managedMailRuntime(browser);
  await writeFile(resolve(evidence,'report.json'),JSON.stringify({status:'passed',checks:['rendered sign-in uses Base','GET confirmation does not admit','POST confirmation sets Base cookie','Settings invitation delivered to explicit outbox','invited Admin invites only Members','setup owner protection','responsive settings','removal revokes session and issued invite','restart preserves peer revocation and owner Base session'],scope:'local emitted Worker and headless browser; no remote delivery claimed'},null,2)+'\n');
  console.log('Base authentication runtime: 9 checks passed; '+evidence);
} finally {
  await browser?.close(); await stop();
}

// Exercise the emitted production Worker; only the external relay is a fake.
async function managedMailRuntime(browser) {
  const { createRequire } = await import('node:module');
  const { readdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { unstable_getMiniflareWorkerOptions } = await import('wrangler');
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = require(createRequire(require.resolve('wrangler')).resolve('miniflare'));
  const built = resolve('dist/server/wrangler.json'), root = dirname(built);
  const { workerOptions, main } = unstable_getMiniflareWorkerOptions(built);
  const entry = resolve(root, main);
  const modules = readdirSync(root, { recursive: true }).filter(name => /\.m?js$/.test(name))
    .map(name => join(root, name)).sort((a,b) => (b === entry) - (a === entry)).map(path => ({type:'ESModule',path}));
  const appOrigin = 'https://vector.example.test', relay = 'https://relay.example.test/api/managed-mail/send';
  const calls = [], edges = []; let relayStatus = 202;
  const mf = new Miniflare(convertV4MiniflareOptions({ rootPath: root, upstream: appOrigin,
    resourcePersistencePath: resolve(state,'v3'), unsafeTriggerHandlers: true,
    workers: [{ name:'vector-local',modulesRoot:root,modules,...workerOptions,
      bindings:{...workerOptions.bindings,...config,APP_ORIGIN:appOrigin,MAIL_MODE:'production',MAIL_PROVIDER:'rer',
        MAIL_API_KEY:'synthetic-fixture-managed-mail-key',MAIL_RELAY_URL:relay,RER_DEV_KEY:''},
      outboundService: async request => {
        // The Node service bridge reconstructs Request.redirect; assert the
        // real no-follow behavior below. The existing Worker mail test observes init.
        edges.push({url:request.url,method:request.method,
          authorized:request.headers.get('Authorization')==='Bearer synthetic-fixture-managed-mail-key',
          contentType:request.headers.get('Content-Type')});
        calls.push(await request.json());
        return Response.json(relayStatus === 202 ? {accepted:true} : {error:'relay refusal'}, {
          status:relayStatus,headers:relayStatus === 302 ? {Location:'https://forbidden.example.test/'} : {'Retry-After':'120'},
        });
      },
    }],
  }));
  let context;
  try {
    await mf.ready;
    const db = await mf.getD1Database('DB');
    const call = (path,method='GET',body,cookie='') => mf.dispatchFetch(appOrigin+path,{method,redirect:'manual',
      headers:{Host:new URL(appOrigin).host,Origin:appOrigin,'Content-Type':'application/json',Cookie:cookie,'CF-Connecting-IP':'192.0.2.44'},
      body:body === undefined ? undefined : JSON.stringify(body)});
    await db.prepare('DELETE FROM oa_limits').run(); await db.prepare('DELETE FROM access_rate_limits').run();
    const requested=await call('/auth/request','POST',{email:config.FIRST_OWNER_EMAIL});
    assert.equal(requested.status,202,JSON.stringify({response:await requested.clone().text(),edges}));
    assert.deepEqual(edges[0],{url:relay,method:'POST',authorized:true,contentType:'application/json'});
    const wire = calls[0];
    assert.deepEqual(Object.keys(wire).sort(),['html','subject','text','to']);
    assert.equal(wire.to,config.FIRST_OWNER_EMAIL); assert.ok(wire.subject && wire.text && wire.html);
    const link = new URL(wire.text.match(/https:\/\/[^\s]+/)[0]);
    assert.equal(link.origin+link.pathname,appOrigin+'/auth/confirm');
    const confirmed = await call('/auth/confirm','POST',{token:link.searchParams.get('token')});
    assert.equal(confirmed.status,303); const cookie=confirmed.headers.get('set-cookie').split(';')[0];
    console.log('Emitted Worker relay: exact POST envelope + bearer + JSON; redirect=manual; Auto-Submitted accepted; sign-in confirmed.');
    assert.equal((await call('/api/settings/operators/invite','POST',{email:'sam@managed-runtime.test',displayName:'Sam Rivera'},cookie)).status,202);
    const inviteLink = new URL(calls.at(-1).text.match(/https:\/\/[^\s]+/)[0]);
    assert.equal((await call('/auth/confirm','POST',{token:inviteLink.searchParams.get('token')})).status,303);
    const peer = await db.prepare("SELECT id FROM operators WHERE email='sam@managed-runtime.test'").first();
    const team = await db.prepare('SELECT id FROM teams LIMIT 1').first();
    relayStatus=429; const started=Date.now();
    const created=await call('/api/issues','POST',{title:'Prepare customer onboarding',description:'Private details stay in Vector',teamId:team.id,assigneeOperatorId:peer.id},cookie);
    assert.equal(created.status,201); const issue=await created.json();
    const delivery=()=>db.prepare('SELECT status,attempts,next_attempt_at FROM notification_deliveries WHERE identifier=?').bind(issue.identifier).first();
    let queued=await delivery(); assert.equal(queued.status,'retry'); assert.equal(queued.attempts,1);
    assert.ok(Date.parse(queued.next_attempt_at)>=started+120000);
    const count=calls.length;
    await mf.dispatchFetch(appOrigin+'/cdn-cgi/local/scheduled');
    assert.equal(calls.length,count,'Retry-After prevents an early send');
    // Advance the persisted due time through the fixture DB, then use real Cron.
    await db.prepare('UPDATE notification_deliveries SET next_attempt_at=? WHERE identifier=?').bind(new Date(Date.now()-1000).toISOString(),issue.identifier).run();
    relayStatus=202; await mf.dispatchFetch(appOrigin+'/cdn-cgi/local/scheduled');
    queued=await delivery(); assert.equal(queued.status,'accepted'); assert.equal(queued.attempts,2);
    console.log('Emitted Worker relay: invitation sent; 429 queued for Retry-After=120; early Cron withheld; due Cron accepted attempt 2.');
    for (const status of [302,401]) {
      relayStatus=status; await db.prepare('DELETE FROM oa_limits').run(); await db.prepare('DELETE FROM access_rate_limits').run();
      const before=calls.length, failed=await call('/auth/request','POST',{email:config.FIRST_OWNER_EMAIL});
      assert.equal(failed.status,503); assert.deepEqual(await failed.json(),{error:'mail_unavailable'});
      assert.equal(calls.length,before+1);
      assert.notEqual((await db.prepare('SELECT revoked_at FROM oa_tokens ORDER BY created_at DESC,rowid DESC LIMIT 1').first()).revoked_at,null);
    }
    assert.ok(edges.every(edge=>edge.url===relay)); assert.equal(edges.length,calls.length);
    console.log('Emitted Worker relay: 302 refused without following; 401 retires the link and returns the public mail problem.');
    context=await browser.newContext();
    await context.route('**/*',async route=>{
      const request=route.request(),response=await mf.dispatchFetch(request.url(),{method:request.method(),headers:{...request.headers(),Host:new URL(appOrigin).host},body:request.postDataBuffer()??undefined,redirect:'manual'});
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
    const page=await context.newPage(); let submissions=0;
    page.on('request',request=>{if(request.url()===appOrigin+'/auth/request')submissions++;});
    // Follow the same generated app handoff that RER's Open app consumes.
    const spec=JSON.parse(await readFile('management/integration/deployment-spec.json','utf8'));
    const signInUrl=new URL(spec.surfaces.app.signIn.path,appOrigin);
    if(spec.surfaces.app.signIn.loginHint) signInUrl.searchParams.set('login_hint','alex.morgan@example.test');
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:width===1440?1000:844});
      await page.goto(signInUrl.href);
      await page.getByRole('button',{name:'Send sign-in link',exact:true}).waitFor({state:'visible'});
      assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),'alex.morgan@example.test');
      assert.equal(submissions,0); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:resolve(evidence,`login-hint-${width}.png`),fullPage:true});
      await db.prepare('DELETE FROM oa_limits').run(); await db.prepare('DELETE FROM access_rate_limits').run();
      await page.getByLabel('Email',{exact:true}).fill(config.FIRST_OWNER_EMAIL);
      await page.getByRole('button',{name:'Send sign-in link',exact:true}).click();
      await page.getByRole('status').waitFor();
      assert.match(await page.getByRole('status').innerText(),/mail settings/);
      await page.screenshot({path:resolve(evidence,`mail-problem-${width}.png`),fullPage:true});
      submissions=0;
    }
    await page.goto(appOrigin+'/signin');
    assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),'');
    for(const hint of ['not-an-email','<script>']) {
      const invalid=await call('/signin?login_hint='+encodeURIComponent(hint));
      assert.equal(invalid.status,307);
      assert.equal(new URL(invalid.headers.get('Location'),appOrigin).pathname,'/signin');
      assert.equal(new URL(invalid.headers.get('Location'),appOrigin).searchParams.has('login_hint'),false);
    }
    console.log('Emitted Worker browser: login_hint prefilled without submitting; blank/invalid hints ignored; plain 401 mail problem at 1440 and 390.');
  } finally { await context?.close(); await mf.dispose(); }
}
