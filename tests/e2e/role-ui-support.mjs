import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);

/** Role screens are inspected at both widths: no serious or critical axe
 * finding, no horizontal overflow, and one capture per state. */
export function roleScreens(evidence) {
  const folder = resolve(evidence, "roles");
  return async function inspect(page, region, name) {
    await mkdir(folder, { recursive: true });
    const source = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await region.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${width}: no horizontal overflow`);
      await page.evaluate((source) => {
        if (window.axe) return;
        const script = document.createElement("script");
        const nonce = document.querySelector("script[nonce]")?.nonce;
        if (nonce) script.nonce = nonce;
        script.textContent = source;
        document.head.append(script);
      }, source);
      const findings = await page.evaluate(async () => (await window.axe.run()).violations
        .filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })));
      assert.deepEqual(findings, [], `${name} ${width}: no serious or critical axe findings`);
      // A capture taller than the viewport would stitch the sticky Settings
      // navigation and the fixed mobile bar over the region; hide them for it.
      await region.evaluate((root) => {
        for (const element of document.querySelectorAll("body *"))
          if (["fixed", "sticky"].includes(getComputedStyle(element).position) && !root.contains(element) && !element.contains(root))
            element.setAttribute("data-capture-hidden", "");
      });
      await region.screenshot({ path: resolve(folder, `${name}-${width}.png`), style: "[data-capture-hidden] { visibility: hidden !important; }" });
      await page.evaluate(() => document.querySelectorAll("[data-capture-hidden]").forEach((element) => element.removeAttribute("data-capture-hidden")));
    }
  };
}

/** ROLE-003's real invitation and assignment UI, plus Guest work pages at
 * desktop and mobile widths. The caller keeps its existing Member session. */
export async function exerciseGuestRoles({page,browser,runtime,clause,evidence}) {
  const {navigate,settleReads}=await import('./collaboration-navigation.mjs');
  const {openDisclosures}=await import('./ui-controls-checks.mjs');
  const {base,sql}=runtime, inspect=roleScreens(evidence);
  const teams=sql('SELECT id,name FROM teams ORDER BY created_at,id');
  const invitedTeam=teams.find(team=>team.name===runtime.config.DEFAULT_TEAM_NAME);
  assert.ok(invitedTeam);
  const headers={Origin:base};
  const post=async(path,data,status=200)=>{
    const response=await page.request.post(base+path,{headers,data});
    assert.equal(response.status(),status,await response.text());
    return response.json();
  };
  const outside=(await post('/api/settings/teams',{name:'Guest excluded delivery',identifierPrefix:'GSEXCL'})).teams.find(team=>team.name==='Guest excluded delivery');
  const owner=sql('SELECT setup_operator_id AS id FROM workspace_installation')[0];
  const project=(await post('/api/settings/projects',{name:'Guest scoped delivery',leadOperatorId:owner.id})).projects.find(project=>project.name==='Guest scoped delivery');
  const visible=await post('/api/issues',{title:'Guest invited delivery issue',teamId:invitedTeam.id,projectId:project.id},201);
  const hidden=await post('/api/issues',{title:'Guest excluded delivery issue',teamId:outside.id,projectId:project.id},201);
  const cycle=(await post('/api/settings/cycles',{name:'Guest invited delivery cycle',teamId:invitedTeam.id,startsLocal:'2038-01-04T09:00',endsLocal:'2038-01-08T09:00',capacity:null})).cycles.find(cycle=>cycle.name==='Guest invited delivery cycle');
  await navigate(page,base+'/app/settings/people');
  await openDisclosures(page);
  const members=page.getByRole('region',{name:'Members',exact:true});
  let context;
  try {
    await clause('ROLE-003','an Owner invites a Guest to named teams from desktop and mobile Settings',async()=>{
      await members.getByLabel('Name',{exact:true}).fill('Agency collaborator');
      await members.getByLabel('Email',{exact:true}).fill('synthetic-vector-803@vector.test');
      await members.getByLabel('Role',{exact:true}).selectOption('guest');
      const group=members.getByRole('group',{name:'Teams this Guest can access',exact:true});
      await group.getByRole('checkbox',{name:invitedTeam.name,exact:true}).check();
      await inspect(page,members,'guest-named-team-invitation');
      const sent=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/settings/operators/invite');
      await members.getByRole('button',{name:'Send invitation',exact:true}).click();
      assert.equal((await sent).status(),202);
    });
    const link=sql("SELECT json_extract(message,'$.text') AS text FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='synthetic-vector-803@vector.test' ORDER BY created_at DESC,sequence DESC LIMIT 1")[0].text.match(/https?:\/\/[^\s]+/)[0];
    context=await browser.newContext({viewport:{width:1440,height:1000}});
    const guest=await context.newPage(), errors=[];
    guest.on('pageerror',error=>errors.push(error.message));
    await guest.goto(link);
    await guest.getByRole('button',{name:'Confirm',exact:true}).click();
    await guest.waitForURL(base+'/app');
    const get=async path=>{const response=await guest.request.get(base+path);assert.equal(response.status(),200,path);return response.json();};
    await clause('ROLE-003','the invited Guest sees only invited work, a scoped project and cycle, and their Guest label at 1440 and 390',async()=>{
      const options=await get('/api/options');
      assert.deepEqual(options.teams.map(team=>team.id),[invitedTeam.id]);
      assert.ok(options.operators.some(person=>person.name==='Agency collaborator (Guest)'));
      for(const path of ['/api/issues','/api/search?q=delivery','/api/notifications','/api/projects','/api/metadata']) {
        const body=JSON.stringify(await get(path));
        assert.ok(!body.includes(hidden.identifier),path);
        assert.ok(!body.includes('Guest excluded delivery'),path);
      }
      await navigate(guest,base+'/app/issues/'+visible.identifier);
      await guest.getByRole('heading',{name:'Guest invited delivery issue',exact:true}).waitFor();
      await inspect(guest,guest.locator('main:visible').first(),'guest-issue-read');
      await navigate(guest,base+'/app/projects/'+project.id);
      await guest.getByRole('heading',{name:project.name,exact:true}).waitFor();
      await guest.getByRole('link',{name:new RegExp(visible.identifier)}).first().waitFor();
      assert.equal(await guest.getByRole('button',{name:'Add milestone',exact:true}).count(),0);
      assert.equal(await guest.getByRole('form',{name:`Edit project ${project.name}`,exact:true}).count(),0);
      await inspect(guest,guest.locator('main:visible').first(),'guest-project-read');
      await navigate(guest,base+'/app/cycles/'+cycle.id);
      await guest.getByRole('heading',{name:cycle.name,exact:true}).waitFor();
      await guest.getByRole('heading',{name:'Workload',exact:true}).waitFor();
      await settleReads(guest);
      await inspect(guest,guest.locator('main:visible').first(),'guest-cycle-read');
      await navigate(guest,base+'/app/cycles');
      await guest.getByRole('link',{name:'Open '+cycle.name,exact:true}).waitFor();
      assert.equal(await guest.getByRole('form',{name:'Create cycle',exact:true}).count(),0);
      assert.equal(await guest.getByRole('button',{name:'Save cycle schedule',exact:true}).count(),0);
      await navigate(guest,base+'/app/settings');
      await guest.getByRole('navigation',{name:'Settings sections'}).locator('.settings-nav-name',{hasText:'Notifications'}).waitFor();
      assert.deepEqual(await guest.getByRole('navigation',{name:'Settings sections'}).locator('.settings-nav-name').allTextContents(),['Profile','Notifications']);
      await navigate(guest,base+'/app/settings/profile');
      await guest.getByRole('heading',{name:'Profile',exact:true}).waitFor();
      assert.equal(await guest.getByRole('region',{name:'Members',exact:true}).count(),0);
      assert.equal(await guest.getByRole('heading',{name:'API tokens',exact:true}).count(),0);
      await navigate(guest,base+'/app/settings/people');await guest.getByText('You can’t open this page.').waitFor();
      await navigate(guest,base+'/app/settings/profile');
      await inspect(guest,guest.locator('main:visible').first(),'guest-account-only');
    });
    const id=sql("SELECT id FROM operators WHERE email='synthetic-vector-803@vector.test'")[0].id;
    await clause('ROLE-003','an Owner changes an accepted Guest to Member and back through the named-team role form; its open session follows immediately',async()=>{
      await navigate(page,base+'/app/settings/people');
      await openDisclosures(page);
      let form=members.getByRole('form',{name:'Role for Agency collaborator (Guest)',exact:true});
      await form.getByRole('combobox').selectOption('member');
      let saved=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/settings/operators/${id}/role`);
      await form.getByRole('button',{name:'Change role',exact:true}).click();
      assert.equal((await saved).status(),200);
      assert.equal((await get('/api/metadata')).viewer.role,'member');
      form=members.getByRole('form',{name:'Role for Agency collaborator',exact:true});
      await form.getByRole('combobox').selectOption('guest');
      await form.getByRole('checkbox',{name:invitedTeam.name,exact:true}).check();
      await inspect(page,members,'guest-named-team-assignment');
      saved=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/settings/operators/${id}/role`);
      await form.getByRole('button',{name:'Change role',exact:true}).click();
      assert.equal((await saved).status(),200);
      assert.equal((await get('/api/metadata')).viewer.role,'guest');
      assert.equal((await guest.request.get(base+'/api/issues/'+hidden.identifier)).status(),404);
      assert.equal((await guest.request.post(base+'/api/settings/integrations/tokens',{headers,data:{name:'Guest cannot mint',scopes:['issues:read']}})).status(),403);
    });
    assert.deepEqual(errors,[],'Guest browser page errors');
  } finally { await context?.close(); }
}
