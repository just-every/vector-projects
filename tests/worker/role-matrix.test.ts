import {unregisteredAndSettingsJourney} from './role-door-journey';
import {viewerVisibilityJourney} from './role-viewer-journey';
import {privateVisibilityJourney} from './role-private-journey';
import { exerciseAudit } from './audit-scenario';
import { guestVisibilityJourney } from "./role-guest-journey";
import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import type { Administration } from "../../src/core/features/administration/schema";
import { readArchive } from "@runeditrun/rer/modules/portability";
import contract from "../../CONTRACT.md?raw";
import { matrix, type RowId } from "../../src/core/features/roles/matrix";
import { initiativeMatrixProbes, subscriptionPersonalProbe, releaseMatrixProbes, githubRuleProbes, probes, type Probe } from "./role-probes";
import { resetLimits, roleWorkspace, snapshot, type Kind } from "./role-fixture";

const teams = async (response: Response) => ((await response.json()) as Administration).teams;
const audits = (action: string) =>
  env.DB.prepare("SELECT a.actor_operator_id AS actor,d.previous_value_json AS previous,d.next_value_json AS next FROM audit_records a JOIN administration_audit_details d ON d.audit_id=a.id WHERE a.action=? ORDER BY a.id")
    .bind(action).all().then((rows) => rows.results);

it('[ROLE-005] native actions populate an immutable workspace audit view and exactly filtered CSV for Owners and Admins, while Members and Guests are refused', {timeout:120_000}, async () => {
  await exerciseAudit(await roleWorkspace());
});


it("[TEAM-007 TEAM-008 ROLE-007 OPS-001] a Member joins and leaves a public team from the directory, a Guest cannot join, a team keeps an owner, and leaving keeps assigned work listed for its owners", async () => {
  const w = await roleWorkspace();
  const platform = (await w.mutate("/settings/teams", "POST", { name: "Platform", identifierPrefix: "PLATF" })).teams.find((t) => t.name === "Platform")!;
  // TEAM-008: the same Member session and scoped token follow each setting change.
  const readOnly=await w.fresh('member',false);
  expect((await w.call(`/settings/operators/${readOnly.id}/role`,'PATCH',{role:'viewer',teamIds:[]})).status).toBe(200);
  const viewerCreates=async()=>{for(const surface of ['call','api'] as const){expect((await readOnly[surface](surface==='call'?'/settings/teams':'/teams','POST',{name:'synthetic-vector-1947',identifierPrefix:'SYNREAD'})).status).toBe(403);if(surface==='call')expect((await readOnly.call('/settings/teams/creation','PUT',{membersMayCreate:true})).status).toBe(403);}};
  await viewerCreates();
  const memberCreate={name:"synthetic-vector-member-team",identifierPrefix:"SYNMEM"};
  expect((await w.member.call("/settings/teams","POST",memberCreate)).status).toBe(403);
  expect((await w.member.api("/teams","POST",memberCreate)).status).toBe(403);
  expect((await w.admin.call("/settings/teams/creation","PUT",{membersMayCreate:true})).status).toBe(200);
  expect((await w.member.call("/settings/teams/creation","PUT",{membersMayCreate:false})).status).toBe(403);
  await viewerCreates();
  for(const surface of ['call','api'] as const){
    expect((await w.member[surface](surface==='call'?'/settings/teams':'/teams','POST',{name:'synthetic-vector-989',identifierPrefix:'SYNDENY',isPrivate:true})).status).toBe(403);
    for(const who of [w.people.owner,w.admin]){const name='synthetic-vector-'+(surface==='call'?990:992)+(who===w.admin?'1':'0');const made=await who[surface](surface==='call'?'/settings/teams':'/teams','POST',{name,identifierPrefix:'SYN'+(surface==='call'?'N':'A')+(who===w.admin?'D':'O'),isPrivate:true});expect(made.status).toBe(surface==='call'?200:201);const body=await made.json() as any,created=surface==='call'?body.teams.find((t:any)=>t.name===name):body;expect(created.isPrivate).toBe(true);expect((await w.call(`/settings/teams/${created.id}/privacy`,'PUT',{isPrivate:false})).status).toBe(200);}
  }
  expect((await w.guest.call("/settings/teams","POST",memberCreate)).status).toBe(403);
  expect((await w.guest.api("/teams","POST",memberCreate)).status).toBe(403);
  const created=await w.member.api("/teams","POST",memberCreate);
  expect(created.status).toBe(201);
  const owned=await created.json() as Administration["teams"][number];
  expect(owned.isPrivate).toBe(false);
  expect(await env.DB.prepare("SELECT is_private FROM teams WHERE id=?").bind(owned.id).first("is_private")).toBe(0);
  expect(owned.members).toEqual([{operatorId:w.member.id,role:"owner"}]);
  expect((await w.call("/settings/teams/creation","PUT",{membersMayCreate:false})).status).toBe(200);
  expect((await w.member.call("/settings/teams","POST",{name:"synthetic-vector-next-team",identifierPrefix:"SYNNEXT"})).status).toBe(403);
  expect((await w.member.api("/teams","POST",{name:"synthetic-vector-next-api-team",identifierPrefix:"SYNAPI"})).status).toBe(403);
  expect((await w.guest.api("/teams","POST",{name:"synthetic-vector-guest-team",identifierPrefix:"SYNGST"})).status).toBe(403);
  expect((await w.state()).teams.find(team=>team.id===owned.id)?.isPrivate).toBe(false);
  expect((await w.state()).teams.find(team=>team.id===owned.id)?.members).toEqual([{operatorId:w.member.id,role:"owner"}]);
  expect(await audits("workspace.team_creation_changed")).toHaveLength(2);
  // TEAM-007: invite-only changes joining, never public work visibility.
  const inviteTeam=(await w.mutate("/settings/teams","POST",{name:"synthetic-vector-invite-team",identifierPrefix:"SYNINV"})).teams.find(team=>team.name==="synthetic-vector-invite-team")!;
  expect((await w.call(`/settings/teams/${inviteTeam.id}/members/${w.lead.id}`,"PUT",{role:"owner"})).status).toBe(200);
  expect((await w.lead.call(`/settings/teams/${inviteTeam.id}/membership`,"PUT",{mode:"invite_only",requestsEnabled:true})).status).toBe(200);
  expect((await w.member.call(`/teams/${inviteTeam.id}/join`,"POST",{})).status).toBe(403);
  const publicIssue=await w.call("/issues","POST",{title:"synthetic-vector-public-invite-work",teamId:inviteTeam.id});
  expect(publicIssue.status).toBe(201);
  const visible=await publicIssue.json() as {identifier:string};
  expect((await w.member.call(`/issues/${visible.identifier}`)).status).toBe(200);
  expect((await w.member.call(`/teams/${inviteTeam.id}/requests`,"POST",{})).status).toBe(200);
  const pending=await snapshot(["team_join_requests","team_members","audit_records"]);
  expect((await w.member.call(`/teams/${inviteTeam.id}/requests`,"POST",{})).status).toBe(200);
  expect(await snapshot(["team_join_requests","team_members","audit_records"])).toEqual(pending);
  expect(await env.DB.prepare("SELECT 1 FROM team_members WHERE team_id=? AND operator_id=?").bind(inviteTeam.id,w.member.id).first()).toBeNull();
  expect((await w.member.call(`/settings/teams/${inviteTeam.id}/requests/${w.member.id}/decision`,"POST",{decision:"approved"})).status).toBe(403);
  expect((await w.member.call(`/settings/teams/${inviteTeam.id}/members/${w.admin.id}`,"PUT",{role:"member"})).status).toBe(403);
  for(const path of [`/teams/${inviteTeam.id}/join`,`/teams/${inviteTeam.id}/requests`])expect((await w.guest.call(path,"POST",{})).status).toBe(403);
  expect(await snapshot(["team_join_requests","team_members","audit_records"])).toEqual(pending);
  const approve=()=>w.lead.call(`/settings/teams/${inviteTeam.id}/requests/${w.member.id}/decision`,"POST",{decision:"approved"});
  expect((await approve()).status).toBe(200);
  const approved=await snapshot(["team_join_requests","team_members","audit_records"]);
  expect((await approve()).status).toBe(200);
  expect(await snapshot(["team_join_requests","team_members","audit_records"])).toEqual(approved);
  expect(await env.DB.prepare("SELECT role FROM team_members WHERE team_id=? AND operator_id=?").bind(inviteTeam.id,w.member.id).first("role")).toBe("member");
  const another=await w.fresh("member",false);
  expect((await another.call(`/teams/${inviteTeam.id}/requests`,"POST",{})).status).toBe(200);
  expect((await w.admin.call(`/settings/teams/${inviteTeam.id}/requests/${another.id}/decision`,"POST",{decision:"declined"})).status).toBe(200);
  expect(await env.DB.prepare("SELECT 1 FROM team_members WHERE team_id=? AND operator_id=?").bind(inviteTeam.id,another.id).first()).toBeNull();
  expect((await w.call(`/settings/teams/${inviteTeam.id}/membership`,"PUT",{mode:"invite_only",requestsEnabled:false})).status).toBe(200);
  expect((await another.call(`/teams/${inviteTeam.id}/requests`,"POST",{})).status).toBe(403);
  expect((await w.call(`/settings/operators/${another.id}`,"DELETE")).status).toBe(200);
  expect(await env.DB.prepare("SELECT count(*) n FROM team_join_requests WHERE requester_id=?").bind(another.id).first("n")).toBe(0);
  // Owners and Admins create teams and become their first team owner.
  expect(platform.members).toEqual([{ operatorId: w.owner, role: "owner" }]);
  const member = w.as(w.member), lead = w.as(w.lead), guest = w.as(w.guest);

  const joined = await member(`/teams/${platform.id}/join`, "POST", {});
  expect(joined.status).toBe(200);
  expect((await teams(joined)).find((t) => t.id === platform.id)!.members).toContainEqual({ operatorId: w.member.id, role: "member" });
  const left = await member(`/teams/${platform.id}/leave`, "POST", {});
  expect(left.status).toBe(200);
  expect((await teams(left)).find((t) => t.id === platform.id)!.members).toEqual([{ operatorId: w.owner, role: "owner" }]);

  // A Guest joins nothing by themselves, and only a team owner or Admin manages
  // members; refusals change nothing.
  const tables = ["team_members", "team_departures", "audit_records"];
  const before = await snapshot(tables);
  expect((await guest(`/teams/${platform.id}/join`, "POST", {})).status).toBe(403);
  expect((await member(`/settings/teams/${platform.id}/members/${w.member.id}`, "PUT", { role: "owner" })).status).toBe(403);
  expect(await snapshot(tables)).toEqual(before);
  // A team owner removes members, but only an Owner or Admin adds a Guest (ROLE-003).
  expect((await lead(`/settings/teams/${w.team.id}/members/${w.guest.id}`, "DELETE")).status).toBe(200);
  expect((await lead(`/settings/teams/${w.team.id}/members/${w.guest.id}`, "PUT", { role: "member" })).status).toBe(403);
  expect((await w.as(w.admin)(`/settings/teams/${w.team.id}/members/${w.guest.id}`, "PUT", { role: "member" })).status).toBe(200);

  // The last team owner stays until another is named; an Admin always may act.
  expect(await (await w.call(`/teams/${platform.id}/leave`, "POST", {})).json()).toMatchObject({ error: "last_team_owner" });
  expect((await w.as(w.admin)(`/settings/teams/${platform.id}/members/${w.lead.id}`, "PUT", { role: "owner" })).status).toBe(200);
  expect((await w.call(`/teams/${platform.id}/leave`, "POST", {})).status).toBe(200);
  expect((await lead(`/teams/${platform.id}/leave`, "POST", {})).status).toBe(409);

  // Leaving keeps assigned work assigned and listed for the team's owners.
  expect((await member(`/teams/${platform.id}/join`, "POST", {})).status).toBe(200);
  const started = platform.statuses.find((status) => status.category === "started")!.id;
  const assigned = await w.call("/issues", "POST", { title: "Rotate the platform keys", teamId: platform.id, statusId: started, assigneeOperatorId: w.member.id });
  expect(assigned.status).toBe(201);
  const issue = (await assigned.json()) as { identifier: string };
  expect((await member(`/teams/${platform.id}/leave`, "POST", {})).status).toBe(200);
  const listed = (await teams(await lead("/settings/administration"))).find((t) => t.id === platform.id)!;
  expect(listed.departedAssignments).toEqual([{ identifier: issue.identifier, title: "Rotate the platform keys", assigneeOperatorId: w.member.id }]);
  // A public team's membership never narrows what a member sees.
  expect(((await (await member(`/issues/${issue.identifier}`)).json()) as { assignee: { id: string } | null }).assignee?.id).toBe(w.member.id);
  const work = JSON.stringify(await (await member("/my-work")).json());
  expect(work).toContain(issue.identifier);
  expect(JSON.stringify(await (await member("/current")).json())).toContain(issue.identifier);
  expect(JSON.stringify(await (await member("/search?q=" + encodeURIComponent("platform keys"))).json())).toContain(issue.identifier);
  expect(JSON.stringify(await (await member("/notifications")).json())).toContain(issue.identifier);

  // Every change is audited once, with its actor and the membership before and after.
  expect((await audits("team.member_joined")).map((row) => row.actor)).toEqual([w.member.id, w.member.id]);
  // Entries made within one millisecond order by their random identifiers, so compare them as sets.
  expect((await audits("team.member_left")).map((row) => row.actor).sort()).toEqual([w.member.id, w.owner, w.member.id].sort());
  expect((await audits("team.member_removed")).map((row) => [row.actor, JSON.parse(String(row.previous))])).toEqual([[w.lead.id, { operatorId: w.guest.id, role: "member" }]]);
  expect(await audits("team.member_role_changed")).toEqual([]);
  expect((await audits("team.member_added")).map((row) => JSON.parse(String(row.next)))).toContainEqual({ operatorId: w.lead.id, role: "owner" });
});

it("[ROLE-009 CYCLE-001 CYCLE-007 TEAM-002 AUTO-003] a team's two permissions decide who changes its settings and cycles; each change is audited once and exported", async () => {
  const w = await roleWorkspace();
  const member = w.as(w.member), guest = w.as(w.guest), lead = w.as(w.lead), admin = w.as(w.admin);
  const status = w.team.statuses.find((s) => s.category === "backlog")!;
  const rename = (actor: typeof member, name: string) => actor(`/settings/teams/${w.team.id}/statuses/${status.id}`, "PATCH", { name });
  let week = 0;
  const cycle = (actor: typeof member) => {
    const day = (offset: number) => new Date(Date.UTC(2031, 0, 6 + 7 * week + offset)).toISOString().slice(0, 10) + "T09:00";
    week += 1;
    return actor("/settings/cycles", "POST", { teamId: w.team.id, name: `Planning week ${week}`, startsLocal: day(0), endsLocal: day(5), capacity: null });
  };
  const schedule = (actor: typeof member) => actor(`/settings/teams/${w.team.id}/cycle-schedule`, "PUT", { weeks: 2, startWeekday: 1, cooldownWeeks: 0, upcomingCount: 2 });
  const set = (actor: typeof member, settings: string, planning: string) => actor(`/settings/teams/${w.team.id}/permissions`, "PUT", { settings, planning });
  const autoClose = (actor: typeof member) => actor(`/settings/teams/${w.team.id}/housekeeping`, "PUT", { closeAfterDays: 30, archiveAfterDays: null, exemptBugs: true });
  expect([w.team.settingsPermission, w.team.planningPermission]).toEqual(["team_owners", "all_members"]);

  // Defaults: a Member who does not own the team plans cycles but not its settings.
  expect((await cycle(member)).status).toBe(200);
  expect((await schedule(member)).status).toBe(200);
  expect((await rename(member, "Queued")).status).toBe(403);
  expect((await autoClose(member)).status).toBe(403);
  // Only the team's owners, an Owner or an Admin set the permissions; Guests fail both.
  const unchanged = await snapshot(["teams", "cycles", "workflow_statuses", "audit_records"]);
  expect((await set(member, "all_members", "team_owners")).status).toBe(403);
  for (const attempt of [cycle(guest), schedule(guest), rename(guest, "Guest name"), autoClose(guest), set(guest, "all_members", "team_owners")])
    expect((await attempt).status).toBe(403);
  expect(await snapshot(["teams", "cycles", "workflow_statuses", "audit_records"])).toEqual(unchanged);

  expect((await set(lead, "all_members", "team_owners")).status).toBe(200);
  expect((await cycle(member)).status).toBe(403);
  expect((await schedule(member)).status).toBe(403);
  expect((await rename(member, "Queued")).status).toBe(200);
  expect((await autoClose(member)).status).toBe(200);
  for (const attempt of [cycle(guest), schedule(guest), rename(guest, "Guest name"), autoClose(guest)]) expect((await attempt).status).toBe(403);
  // Team owners, Owners and Admins pass whatever the values.
  for (const actor of [lead, admin, w.call]) expect((await cycle(actor)).status).toBe(200);

  // Each changed permission is one audit entry, carried by the portable export.
  const created = await w.call("/portability/exports", "POST", {});
  const job = ((await created.json()) as { id: string }).id;
  while (((await (await w.call(`/portability/exports/${job}/advance`, "POST", { maxParts: 16 })).json()) as { phase: string }).phase === "building");
  const rows: { table: string; row: Record<string, unknown> }[] = [];
  for await (const record of readArchive((await w.call(`/portability/exports/${job}/download`)).body!))
    if (record.kind === "part") for (const item of record.items) if (item.kind === "row") rows.push(item as { table: string; row: Record<string, unknown> });
  const changes = rows.filter((item) => item.table === "audit_records" && item.row.action === "team.permission_changed");
  expect(changes.map((item) => item.row.actor_operator_id)).toEqual([w.lead.id, w.lead.id]);
  const details = changes.map((change) => rows.find((item) => item.table === "administration_audit_details" && item.row.audit_id === change.row.id)!.row);
  // Both entries come from one transaction, so the export orders them by their random identifiers.
  expect(details.map((row) => [JSON.parse(String(row.previous_value_json)), JSON.parse(String(row.next_value_json))])).toEqual(expect.arrayContaining([
    [{ settings: "team_owners" }, { settings: "all_members" }], [{ planning: "all_members" }, { planning: "team_owners" }]]));
});

type Cells = Record<"Owner" | "Admin" | "Member" | "Guest", string>;
/** The oracle is CONTRACT.md's role-matrix table itself, read cell by cell. */
const contractMatrix = (() => {
  const rows = new Map<string, Cells>();
  for (const line of contract.slice(contract.indexOf("| Action | Owner | Admin | Member | Guest |")).split("\n").slice(2)) {
    if (!line.startsWith("|")) break;
    const [action, Owner, Admin, Member, Guest] = line.split("|").slice(1, -1).map((cell) => cell.trim());
    rows.set(action, { Owner, Admin, Member, Guest });
  }
  return rows;
})();
const column: Record<Kind, keyof Cells> = { owner: "Owner", admin: "Admin", lead: "Member", member: "Member", guest: "Guest" };
type Context = { inTeam: boolean; settings: string; planning: string; memberInvites: boolean; memberTeamCreation?: boolean };
/** What a cell promises this person: the lead owns the probed team and leads
 * the probed project, the other Member and the Guest belong to the team, and
 * every team is public (ROLE-002). */
function promised(cell: string, who: Kind, c: Context) {
  const text = cell.toLowerCase();
  if(text.startsWith('public teams'))return 'allow';
  // Recovery-dependent grants remain refused until recoverable deletion ships.
  if (text.includes("after recoverable delete")) return "forbidden";
  if (text.startsWith("no (yes when the workspace permits Members".toLowerCase())) return c.memberTeamCreation ? "allow" : "forbidden";
  if (text.startsWith("no (yes when the invite setting is on")) return c.memberInvites ? "allow" : "forbidden";
  if (text.startsWith("where request is visible")) return "allow";
  if (text.startsWith("yes") || text === "own" || text.startsWith("member's teams")) return "allow";
  // The probe gives every Member an editable initiative and an Owner-approved destination (INIT-001).
  if (text === "editable initiative and approved destination only") return "allow";
  if (text.startsWith("no") || text === "apply only") return "forbidden";
  if (text.startsWith("team owner only") || text === "the project's lead only") return who === "lead" ? "allow" : "forbidden";
  if (text === "team setting") return who === "lead" || c.settings === "all_members" ? "allow" : "forbidden";
  if (text === "planning setting") return who === "lead" || c.planning === "all_members" ? "allow" : "forbidden";
  if (text === "under invited teams' issues and projects only") return c.inTeam ? "allow" : "hidden";
  if (text === "invited teams only" || text === "only views covering only invited teams") return c.inTeam ? "allow" : "hidden";
  throw new Error("The journey cannot read this cell yet: " + cell);
}
const outcome = (status: number) => status >= 200 && status < 300 ? "allow" : status === 403 ? "forbidden" : status === 404 ? "hidden" : `status ${status}`;
const watched = ["issue_templates","documents","document_revisions","document_comments","issue_specifications","operators", "oa_operators", "oa_tokens", "vector_invitation_roles", "workspace_settings", "teams", "team_members", "team_departures", "team_join_requests",
  "workflow_statuses", "team_cycle_schedules", "issues", "issue_comments", "issue_files", "intake_decisions", "cycles", "labels", "projects",
  "project_milestones", "saved_views", "issue_reactions", "issue_aliases", "issue_alias_prefixes", "audit_records", "vector_integration_sources", "vector_integration_tokens", "rer_portability_jobs",
  "initiative_graph", "initiatives", "initiative_projects", "releases", "release_issues", "release_projects", "github_automation_rules", "vector_slack_allowed_channels", "vector_channel_bindings", "vector_initiative_destination_approvals", "vector_initiative_scoped_bindings", "vector_initiative_channel_bindings", "vector_webhook_destinations", "vector_restore_operator_grants"];

// Driven from the registry, this case grows with every row; its time limit is not a product assertion.
it("[ROLE-001 ROLE-007 ROLE-009 NOTIFY-007 OPS-002 INTAKE-005 INTAKE-006 INTAKE-007 INTAKE-011 PROJ-002 CYCLE-001 CYCLE-002 CYCLE-007 VIEW-002 DATA-002 DATA-003 DATA-006 DATA-010 DATA-011] every role-matrix row with a door gives an Owner, an Admin, a Member who owns the team, one who does not and a Guest exactly their cell, through the browser door and /api/v1, and refusals write nothing", { timeout: 120_000 }, async () => {
  const w = await roleWorkspace();
  const outside = (await w.mutate("/settings/teams", "POST", { name: "Roles outside", identifierPrefix: "ROLEOUT" })).teams.find((t) => t.name === "Roles outside")!.id;
  const table = probes(w);
  await unregisteredAndSettingsJourney(w);
  // Driven from the registry: each row a door is registered against has a probe.
  expect(Object.keys(table).sort()).toEqual(Object.keys(matrix).sort());
  const set = async (settings: string, planning: string, memberInvites: boolean, memberTeamCreation = false) => {
    await resetLimits();
    expect((await w.call(`/settings/teams/${w.team.id}/permissions`, "PUT", { settings, planning })).status).toBe(200);
    expect((await w.call("/settings", "PATCH", { timezone: "UTC", memberInvites })).status).toBe(200);
    expect((await w.call("/settings/teams/creation", "PUT", {membersMayCreate:memberTeamCreation})).status).toBe(200);
    return { settings, planning, memberInvites, memberTeamCreation };
  };
  let checked = 0;
  for (const [row, probe] of Object.entries(table) as [RowId, Probe][]) {
    const cells = contractMatrix.get(matrix[row].action);
    expect(cells, `${row} names a CONTRACT.md role-matrix row`).toBeDefined();
    const variants = probe.creates ? [["team_owners","all_members",false,false],["team_owners","all_members",false,true]] as const : probe.permission ? [["team_owners", "all_members", false], ["all_members", "team_owners", false]] as const
      : probe.invites ? [["team_owners", "all_members", false], ["team_owners", "all_members", true]] as const : [["team_owners", "all_members", false]] as const;
    for (const [settings, planning, memberInvites, memberTeamCreation] of variants) {
      const values = await set(settings, planning, memberInvites, memberTeamCreation);
      for (const who of ["owner", "admin", "lead", "member", "guest"] as Kind[])
        for (const team of who === "guest" && probe.outside ? [w.team.id, outside] : [w.team.id])
          for (const [surface, attempt] of [["browser", probe.session], ["/api/v1", probe.api]] as const) {
            if (!attempt) continue;
            await resetLimits();
            const send = await attempt(who, w.people[who], team);
            const want = promised(cells![column[who]], who, { ...values, inTeam: team === w.team.id });
            const before = want === "allow" ? null : await snapshot(watched);
            const response = await send();
            expect(outcome(response.status), `${row} ${surface} ${who}${team === outside ? " outside the team" : ""} ${JSON.stringify(values)}: ${await response.clone().text()}`).toBe(want);
            if (before) expect(await snapshot(watched), `${row} ${surface} ${who} refusal wrote nothing`).toEqual(before);
            checked++;
          }
    }
  }
  for(const {row,probe} of githubRuleProbes(w)){
    const cells=contractMatrix.get(matrix[row].action)!;
    for(const settings of ['team_owners','all_members']){
      const values=await set(settings,'team_owners',false);
      for(const who of ['owner','admin','lead','member','guest'] as Kind[]){
        const send=await probe.session(who,w.people[who],w.team.id);
        const want=promised(cells[column[who]],who,{...values,inTeam:true});
        const before=want==='allow'?null:await snapshot(watched);
        const response=await send();
        expect(outcome(response.status),row+' Git rule '+who+' '+settings).toBe(want);
        if(before)expect(await snapshot(watched)).toEqual(before);
      }
    }
  }
  await set("team_owners", "all_members", false);
  expect(checked).toBeGreaterThan(Object.keys(matrix).length * 5);

  // ROLE-001's own private cells use fresh subjects through both registered transports.
  const privateMatrixTeam=(await w.mutate('/settings/teams','POST',{name:'synthetic-vector-1962',identifierPrefix:'SYNMATR',isPrivate:true})).teams.find(t=>t.name==='synthetic-vector-1962')!;
  const privateMatrixResponse=await w.call('/issues','POST',{teamId:privateMatrixTeam.id,title:'synthetic-vector-1963'});expect(privateMatrixResponse.status).toBe(201);const privateMatrixIssue=await privateMatrixResponse.json() as {identifier:string};
  for(const who of ['admin','lead','member','guest'] as const)for(const send of [w.people[who].call,w.people[who].api])expect((await send('/issues/'+privateMatrixIssue.identifier)).status,who+' private matrix read').toBe(404);
  expect((await w.call('/issues/'+privateMatrixIssue.identifier)).status).toBe(200);
  expect((await w.call(`/settings/teams/${privateMatrixTeam.id}/members/${w.member.id}`,'PUT',{role:'member'})).status).toBe(200);
  for(const send of [w.member.call,w.member.api])expect((await send('/issues/'+privateMatrixIssue.identifier)).status).toBe(200);
  const releaseProbe=releaseMatrixProbes(w),releaseCells=contractMatrix.get(releaseProbe.action)!;
  expect(releaseCells).toBeDefined();
  for(const who of ['owner','admin','lead','member','guest'] as Kind[])for(const surface of ['session','api'] as const){
    const send=await releaseProbe[surface](who,w.people[who],w.team.id);
    const want=promised(releaseCells[column[who]],who,{settings:'team_owners',planning:'team_owners',memberInvites:false,inTeam:true});
    const before=want==='allow'?null:await snapshot(watched),response=await send();
    expect(outcome(response.status),'release '+who).toBe(want);
    if(before)expect(await snapshot(watched)).toEqual(before);
  }

  const initiativeProbe=initiativeMatrixProbes(w),initiativeCells=contractMatrix.get(initiativeProbe.action)!;
  expect(initiativeCells).toBeDefined();
  for(const who of ['owner','admin','lead','member','guest'] as Kind[])for(const surface of ['session','api'] as const){
    const send=await initiativeProbe[surface](who,w.people[who],w.team.id),want=promised(initiativeCells[column[who]],who,{settings:'team_owners',planning:'team_owners',memberInvites:false,inTeam:true});
    const before=want==='allow'?null:await snapshot(watched),response=await send();
    expect(outcome(response.status),'initiative '+who).toBe(want);if(before)expect(await snapshot(watched)).toEqual(before);
  }

  // NOTIFY-007's workspace defaults use the same matrix row as other workspace settings.
  for (const who of ["owner", "admin", "lead", "member", "guest"] as Kind[]) {
    const person = w.people[who], allowed = who === "owner" || who === "admin";
    const tables = ["notification_channel_defaults", "notification_channel_overrides"];
    const before = await snapshot(tables);
    expect((await person.call("/settings/notifications/channel-defaults")).status, who).toBe(allowed ? 200 : 403);
    expect((await person.call("/settings/notifications/channel-defaults", "PUT", {
      channels: [{kind: "comment", emailMode: "daily", slack: false}],
    })).status, who).toBe(allowed ? 200 : 403);
    if (!allowed) expect(await snapshot(tables), who + " cannot change notification defaults").toEqual(before);
    expect((await person.call("/settings/notifications/channels", "PUT", {
      channels: [{kind: "comment", inherit: true}],
    })).status, who + " controls their own notification channels").toBe(200);
  }


  // ISSUE-014: workspace merge/delete use the same management row as rename.
  for (const who of ["owner", "admin", "lead", "member", "guest"] as Kind[]) {
    const make = async (suffix: string) => {
      const name = `synthetic-vector-merge-${who}-${suffix}`;
      const response = await w.people.owner.call("/settings/labels", "POST", {name,color:"#224466"});
      expect(response.status).toBe(200);
      return ((await response.json()) as Administration).labels.find(label=>label.name===name)!.id;
    };
    const source = await make("source"), destination = await make("destination"), person = w.people[who];
    const allowed = who === "owner" || who === "admin";
    const made = await w.people.owner.call("/issues", "POST", {title:`synthetic-vector-merge-${who}`,teamId:w.team.id,labelIds:[source,destination]});
    expect(made.status).toBe(201);
    const issue = await made.json() as {id:string;identifier:string;version:number};
    const saved = await w.people.owner.call("/views", "POST", {name:`synthetic-vector-merge-${who}`,isShared:false,layout:"list",query:{label:source}});
    expect(saved.status).toBe(201);
    const view = await saved.json() as {id:string};
    const before = await snapshot(["labels","issues","issue_labels","saved_views","issue_activity","audit_records"]);
    if (!allowed) expect((await person.call(`/settings/labels/${source}`,"DELETE")).status).toBe(403);
    expect((await person.call(`/settings/labels/${source}/merge`,"POST",{destinationLabelId:destination})).status).toBe(allowed?200:403);
    if (!allowed) { expect(await snapshot(["labels","issues","issue_labels","saved_views","issue_activity","audit_records"])).toEqual(before); continue; }
    expect(await env.DB.prepare("SELECT id FROM labels WHERE id=?").bind(source).first()).toBeNull();
    expect((await env.DB.prepare("SELECT label_id FROM issue_labels WHERE issue_id=? ORDER BY label_id").bind(issue.id).all()).results).toEqual([{label_id:destination}]);
    expect(await env.DB.prepare("SELECT version FROM issues WHERE id=?").bind(issue.id).first("version")).toBe(issue.version+1);
    expect(await env.DB.prepare("SELECT count(*) n FROM issue_activity WHERE issue_id=? AND kind='label.merged'").bind(issue.id).first("n")).toBe(1);
    expect(JSON.parse(String(await env.DB.prepare("SELECT filters_json FROM saved_views WHERE id=?").bind(view.id).first("filters_json"))).label).toBe(destination);
    expect((await person.call(`/settings/labels/${destination}`,"DELETE")).status).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM issues WHERE id=?").bind(issue.id).first()).not.toBeNull();
  }

  // ISSUE-014: the workspace permission gates every creation door on the next request.
  for (const membersMayCreate of [false, true]) {
    expect((await w.people.owner.call("/settings/labels/creation", "PUT", {membersMayCreate})).status).toBe(200);
    const beforeAudits = (await audits("workspace.label_creation_changed")).length;
    expect((await w.people.admin.call("/settings/labels/creation", "PUT", {membersMayCreate})).status).toBe(200);
    expect((await audits("workspace.label_creation_changed")).length).toBe(beforeAudits);
    for (const who of ["owner", "admin", "lead", "member", "guest"] as Kind[]) {
      const person = w.people[who], allowed = who === "owner" || who === "admin" || membersMayCreate && who !== "guest";
      const before = allowed ? null : await snapshot(["labels", "audit_records"]);
      for (const [surface, send] of [["session", person.call], ["api", person.api]] as const) {
        const response = await send(surface === "session" ? "/settings/labels" : "/labels", "POST", {name: `synthetic-vector-${membersMayCreate}-${who}-${surface}`,color: "#224466"});
        expect(response.status, who + surface).toBe(allowed ? surface === "session" ? 200 : 201 : 403);
      }
      if (before) expect(await snapshot(["labels", "audit_records"])).toEqual(before);
      if (who !== "owner" && who !== "admin")
        expect((await person.call("/settings/labels/creation", "PUT", {membersMayCreate: !membersMayCreate})).status).toBe(403);
    }
  }
  expect(await audits("workspace.label_creation_changed")).toHaveLength(2);

  const personalSubscriptions=subscriptionPersonalProbe(w);
  expect(contractMatrix.has(personalSubscriptions.parent)).toBe(true);
  for(const who of ['owner','admin','lead','member','guest'] as Kind[]){
    const send=await personalSubscriptions.attempt(who,w.people[who],w.team.id);
    expect((await send()).status,'own subscription '+who).toBe(201);
  }

  // Open Settings pages (ROLE-008 row): Members open Account, the member
  // directory and their personal tokens; a Guest opens Account only.
  const pages = contractMatrix.get("Open Settings pages (ROLE-008)")!;
  expect(pages.Guest).toBe("Account only");
  for (const who of ["owner", "admin", "lead", "member", "guest"] as Kind[]) {
    const call = w.people[who].call, all = pages[column[who]] === "every page";
    expect((await call("/settings/appearance")).status, who).toBe(200);
    const labelsPage = await call("/settings/administration");
    expect(labelsPage.status, who + " reads Labels through the existing administration door").toBe(who === "guest" ? 403 : 200);
    if (who !== "guest") expect(await labelsPage.json()).toHaveProperty("labels");
    expect(outcome((await call("/settings")).status), who).toBe(all || pages[column[who]].includes("member directory") ? "allow" : "forbidden");
    expect(outcome((await call("/settings/integrations/tokens")).status), who).toBe(all || pages[column[who]].includes("personal integrations and tokens") ? "allow" : "forbidden");
  }
});

it("[ROLE-001 OPS-002 OPS-004 INTAKE-005 INTAKE-006 INTAKE-011 VIEW-002 DATA-002 DATA-003 DATA-006 DATA-011] Owners change roles with one audit entry each, effective on the member's next request and token use; the last Owner stays; inherited refusals write nothing", async () => {
  const w = await roleWorkspace();
  const { owner, admin, member, guest } = w.people;
  const role = (who: string, value: string, by = owner) => by.call(`/settings/operators/${who}/role`, "PATCH", { role: value });
  const outsideTeam = (await w.mutate("/settings/teams", "POST", { name: "Roles promotions", identifierPrefix: "ROLEPRO" })).teams.find((t) => t.name === "Roles promotions")!.id;
  let week = 0;
  const cycleIn = (team: string) => ({ teamId: team, name: `Promotion cycle ${++week}`, startsLocal: `2033-0${week}-02T09:00`, endsLocal: `2033-0${week}-06T09:00`, capacity: null });

  // An Owner promotes a Member to Admin and back; an Admin promotes no one to Admin or Owner (OPS-002 row).
  expect((await role(member.id, "admin", admin)).status).toBe(403);
  expect((await role(member.id, "owner", admin)).status).toBe(403);
  expect((await role(member.id, "admin")).status).toBe(200);
  expect((await member.call("/settings", "PATCH", { timezone: "UTC" })).status).toBe(200);
  expect((await member.api("/cycles", "POST", cycleIn(outsideTeam))).status).toBe(201);
  expect((await role(member.id, "member")).status).toBe(200);
  // The demotion applies to the same open session and token on their next request.
  expect((await member.call("/session")).status).toBe(200);
  expect((await member.call("/settings", "PATCH", { timezone: "UTC" })).status).toBe(403);
  expect((await member.api("/cycles", "POST", cycleIn(outsideTeam))).status).toBe(403);
  expect((await member.api("/issues")).status).toBe(200);

  // The last Owner is never demoted or removed; the installation owner stays an Owner.
  const owners = () => w.call("/settings").then((r) => r.json() as Promise<{ operators: { id: string; role: string }[] }>).then((s) => s.operators.filter((o) => o.role === "owner").map((o) => o.id));
  const audited = await snapshot(["audit_records", "operators"]);
  expect(await (await role(owner.id, "admin")).json()).toMatchObject({ error: "last_owner" });
  expect(await (await owner.call(`/settings/operators/${owner.id}`, "DELETE")).json()).toMatchObject({ error: "last_owner" });
  // A Guest must name real teams; invalid assignments write nothing.
  for (const refused of [await role(member.id, "guest"), await owner.call("/settings/operators/invite", "POST", { email: "guest-invite@roles.test", displayName: "Guest", role: "guest" })]) {
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "guest_teams_required" });
  }
  expect(await snapshot(["audit_records", "operators"])).toEqual(audited);
  expect((await role(admin.id, "owner")).status).toBe(200);
  expect(await (await role(owner.id, "member", admin)).json()).toMatchObject({ error: "installation_owner" });
  expect(await owners()).toEqual([owner.id, admin.id]);
  expect((await role(admin.id, "admin")).status).toBe(200);

  // Owners and Admins remove Members; nobody else removes anyone but themselves.
  const leaving = await w.fresh("member"), staying = await w.fresh("member");
  expect((await staying.call(`/settings/operators/${leaving.id}`, "DELETE")).status).toBe(403);
  expect((await admin.call(`/settings/operators/${owner.id}`, "DELETE")).status).toBe(403);
  const memberships = () => env.DB.prepare("SELECT count(*) AS n FROM team_members WHERE operator_id=?").bind(leaving.id).first("n");
  expect(await memberships()).toBe(1);
  expect((await admin.call(`/settings/operators/${leaving.id}`, "DELETE")).status).toBe(200);
  // Removal from the workspace ends every team membership (ROLE-007).
  expect(await memberships()).toBe(0);

  // Inherited cells: refused requests change nothing; Owners and Admins succeed.
  const state = ["issues", "intake_decisions", "vector_integration_sources", "vector_integration_secret_keys", "saved_views", "ik_jobs", "ik_d1_erasure_journal", "audit_records", "rer_portability_jobs", "vector_http_restore"];
  const refuse = async (send: () => Promise<Response>) => {
    await resetLimits();
    const before = await snapshot(state), response = await send();
    expect(response.status, await response.clone().text()).toBe(403);
    expect(await snapshot(state)).toEqual(before);
  };
  const intake = await (await owner.call("/intake", "POST", { title: "Guest decisions", teamId: w.team.id })).json() as { identifier: string; version: number };
  await refuse(() => guest.call(`/issues/${intake.identifier}/accept`, "POST", { expectedVersion: intake.version }));
  await refuse(() => guest.call(`/issues/${intake.identifier}/defer`, "POST", { expectedVersion: intake.version, returnAt: "2033-01-01T00:00:00Z" }));
  const deferred = await (await owner.call(`/issues/${intake.identifier}/defer`, "POST", { expectedVersion: intake.version, returnAt: "2033-01-01T00:00:00Z" })).json() as { version: number };
  await refuse(() => guest.call(`/issues/${intake.identifier}/return`, "POST", { expectedVersion: deferred.version }));
  const shared = await (await owner.call("/views", "POST", { name: "Owner's shared view", isShared: true, layout: "list", query: { team: w.team.id } })).json() as { id: string };
  await refuse(() => member.call(`/views/${shared.id}`, "PATCH", { name: "Not mine to rename" }));
  await refuse(() => member.call(`/views/${shared.id}`, "DELETE"));
  const source = await (await owner.call("/settings/integrations/sources", "POST", { sourceId: "role-source", name: "Role source", teamId: w.team.id })).json() as { id: string };
  for (const who of [member, guest]) {
    await refuse(() => who.call(`/settings/integrations/sources/${source.id}/rotate`, "POST", { overlapHours: 1 }));
    await refuse(() => who.call(`/settings/integrations/sources/${source.id}`, "DELETE"));
  }
  expect((await admin.call(`/settings/integrations/sources/${source.id}/rotate`, "POST", { overlapHours: 1 })).status).toBe(200);
  expect((await owner.call(`/settings/integrations/sources/${source.id}`, "DELETE")).status).toBe(200);
  const rows = Buffer.from(JSON.stringify([{ id: "role-1", title: "Imported role issue", team: w.team.name, status: w.team.statuses.find((s) => s.category === "backlog")!.name,
    created: "2026-09-01T01:02:03.000Z", updated: "2026-09-02T04:05:06.000Z" }])).toString("base64");
  const importInput = { format: "json", source: "role-import", name: "issues.json", base64: rows,
    mapping: { sourceId: "id", title: "title", team: "team", status: "status", createdAt: "created", updatedAt: "updated" } };
  for (const who of [member, guest]) await refuse(() => who.call("/data/import/preview", "POST", importInput));
  // Restoring an archive over HTTP is an Owner's alone (DATA-005 row).
  for (const who of [admin, member]) await refuse(() => who.call("/portability/imports", "POST", { confirmed: true, manifest: { tables: [] } }));
  expect((await admin.call("/data/import/preview", "POST", importInput)).status).toBe(200);
  const review = await (await owner.call("/data/import/preview", "POST", importInput)).json() as { fingerprint: string; effectiveAt: string };
  const applyBody = { input: { ...importInput, effectiveAt: review.effectiveAt }, reviewedFingerprint: review.fingerprint, operationKey: "review:" + review.fingerprint, acknowledgeOmissions: true };
  for (const who of [member, guest]) await refuse(() => who.call("/data/import/apply", "POST", applyBody));
  const applied = await owner.call("/data/import/apply", "POST", applyBody);
  expect(applied.status, await applied.clone().text()).toBe(200);
  const run = await applied.json() as { id: string };
  for (const who of [member, guest]) {
    await refuse(() => who.call("/data/import/apply", "POST", applyBody));
    await refuse(() => who.call(`/data/import/runs/${run.id}/resume`, "POST", {}));
    await refuse(() => who.call(`/data/import/runs/${run.id}/rollback`, "POST", { confirmed: true }));
    await refuse(() => who.call("/data/erasure/preview", "POST", { names: ["Departed Author"] }));
    await refuse(() => who.call("/data/erasure", "POST", { subject: { names: ["Departed Author"] }, confirmation: "erase" }));
  }
  // A run belongs to whoever applied it: each Owner or Admin resumes their own.
  expect((await owner.call(`/data/import/runs/${run.id}/resume`, "POST", {})).status).toBe(200);
  const adminInput = { ...importInput, source: "role-import-admin" };
  const adminReview = await (await admin.call("/data/import/preview", "POST", adminInput)).json() as { fingerprint: string; effectiveAt: string };
  const adminRun = await (await admin.call("/data/import/apply", "POST", { input: { ...adminInput, effectiveAt: adminReview.effectiveAt },
    reviewedFingerprint: adminReview.fingerprint, operationKey: "review:" + adminReview.fingerprint, acknowledgeOmissions: true })).json() as { id: string };
  expect((await admin.call(`/data/import/runs/${adminRun.id}/resume`, "POST", {})).status).toBe(200);
  expect((await admin.call("/data/erasure/preview", "POST", { names: ["Departed Author"] })).status).toBe(200);

  // Every role change is one audit entry naming actor, subject, from and to, carried by the export.
  const created = await owner.call("/portability/exports", "POST", {});
  const job = ((await created.json()) as { id: string }).id;
  while (((await (await owner.call(`/portability/exports/${job}/advance`, "POST", { maxParts: 16 })).json()) as { phase: string }).phase === "building");
  const exported: { table: string; row: Record<string, unknown> }[] = [];
  for await (const record of readArchive((await owner.call(`/portability/exports/${job}/download`)).body!))
    if (record.kind === "part") for (const item of record.items) if (item.kind === "row") exported.push(item as { table: string; row: Record<string, unknown> });
  const changes = exported.filter((item) => item.table === "audit_records" && item.row.action === "operator.role_changed" && [member.id,admin.id,guest.id].includes(String(item.row.subject_id))).map((item) => {

    const detail = exported.find((other) => other.table === "administration_audit_details" && other.row.audit_id === item.row.id)!.row;
    return [item.row.actor_operator_id, item.row.subject_id, JSON.parse(String(detail.previous_value_json)).role, JSON.parse(String(detail.next_value_json)).role];
  });
  expect(changes).toHaveLength(5);
  expect(changes).toEqual(expect.arrayContaining([[owner.id, guest.id, "member", "guest"], [owner.id, member.id, "member", "admin"], [owner.id, member.id, "admin", "member"], [owner.id, admin.id, "admin", "owner"], [owner.id, admin.id, "owner", "admin"]]));
});


it("[ROLE-002 ROLE-003 ROLE-013 OPS-001 OPS-002 WORK-004] current private and invited teams scope native, bearer, search, project, notification and document reads; Viewers remain read-only", {timeout:120_000}, async () => {
  await guestVisibilityJourney(await roleWorkspace());
  await viewerVisibilityJourney(await roleWorkspace());
  // Agent admission closes the retained-artifact erasure fence. Keep this
  // journey after the Viewer's existing erasure-census setup in the shared D1.
  await privateVisibilityJourney(await roleWorkspace());
});
