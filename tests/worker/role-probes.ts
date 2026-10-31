import {jsonMediaType} from '../../src/core/features/oauth-apps/media-types';
import {createServerApp} from '../../src/core/app/server';
import {bindings,origin} from './base-auth-fixture';
import { seedIntakeForTeam, recordedReply } from './email-intake-fixture';
import { expect } from "vitest";
import type { RowId } from "../../src/core/features/roles/matrix";
import type { Kind, Person, roleWorkspace } from "./role-fixture";
import { channelEdge } from "./channel-edge-fixture";

type AdministrationForRequests = {teams:{id:string;name:string}[]};
type Workspace = Awaited<ReturnType<typeof roleWorkspace>>;
type Issue = { id: string; identifier: string; version: number };
type Send = () => Promise<Response>;
/** One attempt at a row's action by `who` on a team (for a Guest, possibly a
 * team they are not in): the Owner prepares its subjects, then it returns the
 * one request to send, through the browser door (`call`) or `/api/v1` (`api`). */
export type Attempt = (who: Kind, actor: Person, team: string) => Promise<Send>;
export type Probe = { permission?: "settings" | "planning"; invites?: true; creates?: true; outside?: true; session: Attempt; api?: Attempt };

const json = async <T>(response: Response | Promise<Response>) => {
  const settled = await response;
  expect([200, 201], await settled.clone().text()).toContain(settled.status);
  return (await settled.json()) as T;
};

/** A request for every role-matrix row that has a door today. */
export function probes(w: Workspace): Record<RowId, Probe> {
  let n = 0;
  const unique = () => ++n;
  const prefix = (stem: string) => { const id = unique(); return stem + String.fromCharCode(65 + Math.floor(id / 26) % 26, 65 + (id % 26)); };
  const owner = w.people.owner;
  const issue = (team: string, extra: Record<string, unknown> = {}) =>
    json<Issue>(owner.call("/issues", "POST", { title: `Probe issue ${unique()}`, teamId: team, ...extra }));
  const comment = async (by: Person, identifier: string) =>
    (await json<{ id: string }>(by.call(`/issues/${identifier}/comments`, "POST", { body: `Probe comment ${unique()}` }))).id;
  /** The actor's own comment on a team's issue; a Guest outside the team wrote
   * it while they were still in it. */
  const authored = async (actor: Person, team: string, identifier: string) => {
    const visiting = team !== w.team.id && actor === w.people.guest;
    if (visiting) expect((await owner.call(`/settings/teams/${team}/members/${actor.id}`, "PUT", { role: "member" })).status).toBe(200);
    const id = await comment(actor, identifier);
    if (visiting) expect((await owner.call(`/settings/teams/${team}/members/${actor.id}`, "DELETE")).status).toBe(200);
    return id;
  };
  const commentVersion = async (id: string) => (await json<{ version: number }>(owner.api(`/comments/${id}`))).version;
  const cycle = (team: string) => {
    const week = unique();
    const day = (offset: number) => new Date(Date.UTC(2032, 0, 5 + 7 * week + offset)).toISOString().slice(0, 10) + "T09:00";
    return { teamId: team, name: `Probe cycle ${week}`, startsLocal: day(0), endsLocal: day(5), capacity: null };
  };
  const openCycle = async (team: string) => {
    const created = cycle(team);
    return (await json<{ cycles: { id: string; name: string }[] }>(owner.call("/settings/cycles", "POST", created))).cycles.find((c) => c.name === created.name)!.id;
  };
  const project = async (lead = owner.id) => (await json<{ id: string }>(owner.api("/projects", "POST", { name: `Probe project ${unique()}`, leadOperatorId: lead }))).id;
  const view = async (by: Person, shared: boolean, team: string) => (await json<{ id: string }>(by.call("/views", "POST", {
    name: `Probe view ${unique()}`, isShared: shared, layout: "list", query: { team } }))).id;
  const label = async () => {
    const name = `Probe label ${unique()}`;
    return (await json<{ labels: { id: string; name: string }[] }>(owner.call("/settings/labels", "POST", { name, color: "#2255aa" }))).labels.find((l) => l.name === name)!.id;
  };
  const backlog = async (team: string) => (await w.state()).teams.find((t) => t.id === team)!.statuses.find((s) => s.category === "backlog")!.id;
  const team = async (name: string, stem: string) => {
    const created = await json<{ teams: { id: string; name: string }[] }>(owner.call("/settings/teams", "POST", { name, identifierPrefix: prefix(stem) }));
    return created.teams.find((t) => t.name === name)!.id;
  };

  const result:Record<RowId,Probe> = {
    "documents.write": {outside:true,session:async(_who,actor,team)=>{const target=await issue(team);return()=>actor.call('/documents','POST',{parentKind:'issue',parentId:target.id,title:'synthetic-vector-document-probe-'+unique(),body:'synthetic-vector-document-body'});}},
    "work.read": {outside:true,session:async(_who,actor,teamId)=>{const made=await issue(teamId);return()=>actor.call('/issues/'+made.identifier+'/references');},api:async(_who,actor,teamId)=>{const made=await issue(teamId);return()=>actor.api('/issues/'+made.identifier);}},
    "viewers.manage": {session:async(_who,actor)=>()=>actor.call('/settings/operators/invite','POST',{email:`synthetic-vector-${1100+unique()}@vector.test`,displayName:'synthetic-vector-1100',role:'viewer'})},
    "reports.read": {session:async(_who,actor)=>()=>actor.call('/insights')},
    "dashboards.write": {session:async(_who,actor)=>()=>actor.call('/dashboards','POST',{name:`synthetic-vector-${1200+unique()}`,widgets:[{name:'Visible count',kind:'count',filters:{},chart:{}}]})},
    "calendar.feeds": {session:async(_who,actor)=>()=>actor.call('/calendar/feeds','POST',{})},
    "initiatives.write": {session:async(_who,actor)=>()=>actor.call('/initiatives','POST',{name:`synthetic-vector-${1300+unique()}`,ownerOperatorId:actor.id}),api:async(_who,actor)=>()=>actor.api('/initiatives','POST',{name:`synthetic-vector-${1400+unique()}`,ownerOperatorId:actor.id})},
    "releases.write": {session:async(_who,actor,teamId)=>()=>actor.call('/releases','POST',{name:`synthetic-vector-${1500+unique()}`,teamId}),api:async(_who,actor,teamId)=>()=>actor.api('/releases','POST',{name:`synthetic-vector-${1600+unique()}`,teamId})},
    "reactions.write": {outside:true,session:async(_who,actor,teamId)=>{const made=await issue(teamId);return()=>actor.call(`/issues/${made.identifier}/reactions`,'PUT',{targetId:'',emoji:'👍'});}},
    "email.reply": { session: async (_who, actor, teamId) => { const intake=await seedIntakeForTeam(teamId,w.cookie); return async () => (await recordedReply(actor.cookie,intake.identifier,"The team is investigating.")).response; } },
    "members.manage": { invites: true, session: async (_who, actor) => () => actor.call("/settings/operators/invite", "POST", { email: `invitee${unique()}@roles.test`, displayName: "Invitee", role: "member" }) },
    "leaders.manage": { invites: true, session: async (_who, actor) => () => actor.call("/settings/operators/invite", "POST", { email: `leader${unique()}@roles.test`, displayName: "Leader", role: "admin" }) },
    "workspace.leave": { session: async (who) => { const leaving = await w.fresh(who); return () => leaving.call(`/settings/operators/${leaving.id}`, "DELETE"); } },
    "workspace.settings": { session: async (_who, actor) => () => actor.call("/settings", "PATCH", { timezone: "UTC" }) },
    "teams.creation-setting": { session: async (_who, actor) => () => actor.call("/settings/teams/creation", "PUT", {membersMayCreate: false}) },
    "teams.create": { creates: true, api: async (_who, actor) => () => actor.api("/teams", "POST", {name:`API team ${unique()}`,identifierPrefix:prefix("API")}), session: async (_who, actor) => { const name = `Probe team ${unique()}`, identifierPrefix = prefix("PRB"); return () => actor.call("/settings/teams", "POST", { name, identifierPrefix }); } },
    "teams.privacy": {session:async (_who,actor)=>{const id=await team(`synthetic-vector-${9600+unique()}`,"PRIV");return async()=>{const r=await actor.call(`/settings/teams/${id}/privacy`,"PUT",{isPrivate:true});if(r.ok){expect((await w.state()).teams.find(t=>t.id===id)?.isPrivate).toBe(true);expect((await owner.call(`/settings/teams/${id}/privacy`,"PUT",{isPrivate:false})).status).toBe(200);}return r;};},api:async (_who,actor)=>{const id=await team(`synthetic-vector-${9700+unique()}`,"PRVA");return async()=>{const r=await actor.api(`/teams/${id}/privacy`,"PUT",{isPrivate:true});if(r.ok){expect((await w.state()).teams.find(t=>t.id===id)?.isPrivate).toBe(true);expect((await owner.call(`/settings/teams/${id}/privacy`,"PUT",{isPrivate:false})).status).toBe(200);}return r;};}},
    "teams.members": { session: async (_who, actor, id) => { const joining = await w.fresh("member", false); return () => actor.call(`/settings/teams/${id}/members/${joining.id}`, "PUT", { role: "member" }); } },
    "teams.permissions": { session: async (_who, actor, id) => {
      const current = (await w.state()).teams.find((t) => t.id === id)!;
      return () => actor.call(`/settings/teams/${id}/permissions`, "PUT", { settings: current.settingsPermission, planning: current.planningPermission }); } },
    "teams.membership": {session: async (_who,actor,id)=>()=>actor.call(`/settings/teams/${id}/membership`,"PUT",{mode:"open",requestsEnabled:false})},
    "teams.request": {session: async (who,actor)=>{
      const creator=who==="owner"?w.people.admin:owner, name=`Request team ${unique()}`;
      const created=await json<AdministrationForRequests>(creator.call("/settings/teams","POST",{name,identifierPrefix:prefix("REQ")}));
      const id=created.teams.find(team=>team.name===name)!.id;
      expect((await owner.call(`/settings/teams/${id}/membership`,"PUT",{mode:"invite_only",requestsEnabled:true})).status).toBe(200);
      return ()=>actor.call(`/teams/${id}/requests`,"POST",{});
    }},
    "teams.join": { session: async (_who, actor) => { const id = await team(`Directory team ${unique()}`, "DIR"); return () => actor.call(`/teams/${id}/join`, "POST", {}); } },
    "teams.settings": { permission: "settings", session: async (_who, actor, id) => { const value = unique() % 2 === 0; return () => actor.call(`/settings/teams/${id}`, "PATCH", { autoCycleStarted: value }); } },
    "teams.workflow": { permission: "settings", session: async (_who, actor, id) => { const status = await backlog(id), name = `Backlog ${unique()}`; return () => actor.call(`/settings/teams/${id}/statuses/${status}`, "PATCH", { name }); } },
    // Checked under both settings values: All team members never lets a member archive.
    "teams.archive": { permission: "settings", session: async (_who, actor, id) => async () => {
      const response = await actor.call(`/settings/teams/${id}`, "PATCH", { archived: true });
      // The probed team stays in use for the rows that follow.
      if (response.ok) expect((await owner.call(`/settings/teams/${id}`, "PATCH", { archived: false })).status).toBe(200);
      return response; } },
    "issues.write": { outside: true,
      session: async (_who, actor, id) => () => actor.call("/issues", "POST", { title: `Written ${unique()}`, teamId: id }),
      api: async (_who, actor, id) => () => actor.api("/issues", "POST", { title: `Written ${unique()}`, teamId: id }) },
    "issues.copy": { outside: true,
      session: async (_who, actor, id) => { const source = await issue(id); return () => actor.call(`/issues/${source.identifier}/copy`, "POST", { expectedVersion: source.version, teamId: id }); },
      api: async (_who, actor, id) => { const source = await issue(id); return () => actor.api(`/issues/${source.identifier}/copy`, "POST", { expectedVersion: source.version, teamId: id }); } },
    "comments.own": { outside: true,
      session: async (_who, actor, id) => { const target = await issue(id), mine = await authored(actor, id, target.identifier);
        return () => actor.call(`/issues/${target.identifier}/comments/${mine}`, "PATCH", { body: "Edited by its author" }); },
      api: async (_who, actor, id) => { const target = await issue(id), mine = await authored(actor, id, target.identifier), expectedVersion = await commentVersion(mine);
        return () => actor.api(`/comments/${mine}`, "PATCH", { expectedVersion, body: "Edited by its author" }); } },
    "comments.edit-others": {
      session: async (who, actor) => { const target = await issue(w.team.id), theirs = await comment(who === "owner" ? w.people.admin : owner, target.identifier);
        return () => actor.call(`/issues/${target.identifier}/comments/${theirs}`, "PATCH", { body: "Rewritten by someone else" }); },
      api: async (who, actor) => { const target = await issue(w.team.id), theirs = await comment(who === "owner" ? w.people.admin : owner, target.identifier), expectedVersion = await commentVersion(theirs);
        return () => actor.api(`/comments/${theirs}`, "PATCH", { expectedVersion, body: "Rewritten by someone else" }); } },
    "media.write": { outside: true, session: async (_who, actor, id) => {
      const target = await issue(id, { description: "- [ ] Check the backup" });
      return () => actor.call(`/issues/${target.identifier}/checklist`, "POST", { expectedVersion: target.version, index: 0, text: "Check the backup", checked: true }); } },
    "comments.delete-own": {
      session: async (_who, actor) => { const target = await issue(w.team.id), mine = await comment(actor, target.identifier); return () => actor.call(`/issues/${target.identifier}/comments/${mine}`, "DELETE"); },
      api: async (_who, actor) => { const target = await issue(w.team.id), mine = await comment(actor, target.identifier), expectedVersion = await commentVersion(mine);
        return () => actor.api(`/comments/${mine}`, "DELETE", { expectedVersion }); } },
    "comments.delete-others": {
      session: async (who, actor) => { const target = await issue(w.team.id), theirs = await comment(who === "owner" ? w.people.admin : owner, target.identifier);
        return () => actor.call(`/issues/${target.identifier}/comments/${theirs}`, "DELETE"); },
      api: async (who, actor) => { const target = await issue(w.team.id), theirs = await comment(who === "owner" ? w.people.admin : owner, target.identifier), expectedVersion = await commentVersion(theirs);
        return () => actor.api(`/comments/${theirs}`, "DELETE", { expectedVersion }); } },
    "issues.delete-permanent": { session: async (_who, actor) => { const target = await issue(w.team.id); return () => actor.call(`/issues/${target.identifier}`, "DELETE", { expectedVersion: target.version, confirmed: true }); } },
    "labels.create": { api: async (_who, actor) => () => actor.api("/labels", "POST", {name: `API label ${unique()}`,color: "#aa5522"}), session: async (_who, actor) => () => actor.call("/settings/labels", "POST", { name: `Created label ${unique()}`, color: "#aa5522" }) },
    "labels.manage": { session: async (_who, actor) => { const id = await label(), name = `Renamed label ${unique()}`; return () => actor.call(`/settings/labels/${id}`, "PATCH", { name }); } },
    "intake.create": { outside: true, session: async (_who, actor, id) => () => actor.call("/intake", "POST", { title: `Intake ${unique()}`, teamId: id }) },
    "intake.decide": { session: async (_who, actor) => {
      const intake = await json<Issue>(owner.call("/intake", "POST", { title: `Decision ${unique()}`, teamId: w.team.id }));
      return () => actor.call(`/issues/${intake.identifier}/decline`, "POST", { expectedVersion: intake.version, reason: "Not ours" }); } },
    "sources.manage": { session: async (_who, actor) => () => actor.call("/settings/integrations/sources", "POST", { sourceId: `probe-source-${unique()}`, name: "Probe source", teamId: w.team.id }) },
    "issue-templates.workspace": {
      session:async(_who,actor)=>()=>actor.call('/issue-templates','POST',{name:'synthetic-vector-'+(1650+unique()),teamId:null,defaults:{title:'synthetic-vector-1650'},subissues:[{title:'synthetic-vector-1651'},{title:'synthetic-vector-1652'}]}),
      api:async(_who,actor)=>()=>actor.api('/issue-templates','POST',{name:'synthetic-vector-'+(1750+unique()),teamId:null,defaults:{title:'synthetic-vector-1750'},subissues:[{title:'synthetic-vector-1751'},{title:'synthetic-vector-1752'}]}),
    },
    "issue-templates.team": {permission:'planning',
      session:async(_who,actor,teamId)=>()=>actor.call('/issue-templates','POST',{name:'synthetic-vector-'+(1850+unique()),teamId,defaults:{title:'synthetic-vector-1850'},subissues:[{title:'synthetic-vector-1851'},{title:'synthetic-vector-1852'}]}),
      api:async(_who,actor,teamId)=>()=>actor.api('/issue-templates','POST',{name:'synthetic-vector-'+(1950+unique()),teamId,defaults:{title:'synthetic-vector-1950'},subissues:[{title:'synthetic-vector-1951'},{title:'synthetic-vector-1952'}]}),
    },
    "cycles.manage": { permission: "planning",
      session: async (_who, actor, id) => { const input = cycle(id); return () => actor.call("/settings/cycles", "POST", input); },
      api: async (_who, actor, id) => { const input = cycle(id); return () => actor.api("/cycles", "POST", input); } },
    "cycles.schedule": { permission: "planning", session: async (_who, actor, id) => () => actor.call(`/settings/teams/${id}/cycle-schedule`, "PUT", { weeks: 2, startWeekday: 1, cooldownWeeks: 0, upcomingCount: 2 }) },
    "cycles.commit": { outside: true,
      session: async (_who, actor, id) => { const target = await issue(id), cycleId = await openCycle(id); return () => actor.call(`/issues/${target.identifier}`, "PATCH", { expectedVersion: target.version, cycleId }); },
      api: async (_who, actor, id) => { const target = await issue(id), cycleId = await openCycle(id); return () => actor.api(`/issues/${target.identifier}`, "PATCH", { expectedVersion: target.version, cycleId }); } },
    "projects.write": {
      session: async (_who, actor) => () => actor.call("/settings/projects", "POST", { name: `Created project ${unique()}`, leadOperatorId: actor.id }),
      api: async (_who, actor) => () => actor.api("/projects", "POST", { name: `Created project ${unique()}`, leadOperatorId: actor.id }) },
    "projects.status": {
      session: async (_who, actor) => { const id = await project(); return () => actor.call(`/settings/projects/${id}`, "PATCH", { lifecycle: "active" }); },
      api: async (_who, actor) => { const id = await project(); return () => actor.api(`/projects/${id}`, "PATCH", { lifecycle: "active" }); } },
    // Leading the project grants no deletion privilege until recoverable deletion ships.
    "projects.delete": {
      session: async (_who, actor) => { const id = await project(w.people.lead.id); return () => actor.call(`/settings/projects/${id}`, "DELETE"); },
      api: async (_who, actor) => { const id = await project(w.people.lead.id); return () => actor.api(`/projects/${id}`, "DELETE"); } },
    "milestones.write": {
      session: async (_who, actor) => { const id = await project(); return () => actor.call(`/settings/projects/${id}/milestones`, "POST", { name: `Milestone ${unique()}` }); },
      api: async (_who, actor) => { const id = await project(); return () => actor.api(`/projects/${id}/milestones`, "POST", { name: `Milestone ${unique()}` }); } },
    "views.private": { session: async (_who, actor) => () => actor.call("/views", "POST", { name: `Private view ${unique()}`, isShared: false, layout: "list", query: {} }) },
    "views.share": { session: async (_who, actor) => () => actor.call("/views", "POST", { name: `Shared view ${unique()}`, isShared: true, layout: "list", query: { team: w.team.id } }) },
    "views.open-shared": { outside: true, session: async (_who, actor, id) => { const shared = await view(owner, true, id); return () => actor.call(`/views/${shared}/duplicate`, "POST", { name: `Copied view ${unique()}` }); } },
    "views.edit-shared": { session: async (who, actor) => { const shared = await view(who === "guest" ? owner : actor, true, w.team.id); return () => actor.call(`/views/${shared}`, "PATCH", { name: `Renamed view ${unique()}` }); } },
    "integrations.manage": { session: async (_who, actor) => () => actor.call("/settings/integrations") },
    // Slack is faked at the network edge; a refused request never reaches it.
    "channels.bind-project": { session: async (_who, actor) => {
      const edge=channelEdge(),id=await project();
      try {
        expect((await owner.call("/settings/integrations/slack","POST",{botToken:edge.token})).status).toBe(200);
        expect((await owner.call("/settings/integrations/channels/allowed","POST",{channelId:"CAPPROVED",channelName:"delivery"})).status).toBe(201);
      } catch(error){edge.restore();throw error;}
      return async()=>{try{
        const before=edge.calls.length;
        const denied=await actor.call(`/projects/${id}/slack-channel`,"POST",{channelId:"CUNAPPROVED"});
        expect(denied.status).toBe(403);expect(edge.calls.length).toBe(before);
        return await actor.call(`/projects/${id}/slack-channel`,"POST",{channelId:"CAPPROVED"});
      }finally{edge.restore();}};
    } },
    // An Owner approves one Slack channel for the initiative; an unapproved one is refused before Slack is asked.
    "channels.bind-initiative": { session: async (_who, actor) => {
      const edge=channelEdge();let initiative:string;
      try {
        expect((await owner.call("/settings/integrations/slack","POST",{botToken:edge.token})).status).toBe(200);
        initiative=(await json<{id:string}>(owner.call("/initiatives","POST",{name:`synthetic-vector-${1500+unique()}`,ownerOperatorId:owner.id}))).id;
        expect((await owner.call("/settings/integrations/channels/initiative-approvals","POST",{provider:"slack",initiativeId:initiative,channelId:"CAPPROVED",audience:"workspace"})).status).toBe(201);
      } catch(error){edge.restore();throw error;}
      return async()=>{try{
        const before=edge.calls.length,path=`/initiatives/${initiative}/channel-binding`;
        const denied=await actor.call(path,"PUT",{provider:"slack",channelId:"CUNAPPROVED",events:["initiative.updated"],expectedVersion:null});
        expect(denied.status).toBe(403);expect(edge.calls.length).toBe(before);
        return await actor.call(path,"PUT",{provider:"slack",channelId:"CAPPROVED",events:["initiative.updated"],expectedVersion:null});
      }finally{edge.restore();}};
    } },
    "channels.create": { session: async (_who, actor) => {
      const edge = channelEdge(), name = `Channel project ${unique()}`;
      try { expect((await owner.call("/settings/integrations/slack", "POST", { botToken: edge.token })).status).toBe(200); }
      catch (error) { edge.restore(); throw error; }
      return async () => {
        try {
          const response = await actor.call("/settings/projects", "POST", { name, leadOperatorId: actor.id, createSlackChannel: true });
          expect(edge.calls.filter((call) => call.method === "conversations.create")).toHaveLength(response.ok ? 1 : 0);
          return response;
        } finally { edge.restore(); }
      }; } },
    "tokens.personal": { session: async (_who, actor) => () => actor.call("/settings/integrations/tokens", "POST", { name: `Token ${unique()}`, scopes: ["issues:read"] }) },
    "identity.personal": { session: async (_who, actor) => {
      const edge=channelEdge(),slackUserId='USYNTHETIC'+unique();
      try {
        expect((await owner.call('/settings/integrations/slack','POST',{botToken:edge.token})).status).toBe(200);
        const own=await json<{slack:{email:string}}>(actor.call('/settings/notifications'));
        edge.users(own.slack.email,slackUserId,'synthetic-vector-role-identity');
      }catch(error){edge.restore();throw error;}
      return async()=>{try{return await actor.call('/settings/notifications/slack/link','POST',{slackUserId});}finally{edge.restore();}};
    } },
    "audit.read": { session: async (_who, actor) => () => actor.call("/settings/audit") },
    "data.export": { session: async (_who, actor) => async () => {
      const created = await actor.call("/portability/exports", "POST", {});
      if (created.ok) await owner.call(`/portability/exports/${((await created.clone().json()) as { id: string }).id}/abort`, "POST", {});
      return created; } },
    "data.import": { session: async (_who, actor) => () => actor.call("/data/import/runs") },
    "data.restore": { session: async (_who, actor) => () => actor.call("/data/restore") },
    "data.aliases": { session: async (_who, actor) => () => actor.call("/data/aliases/prefixes") },
    "data.erase-imported": { session: async (_who, actor) => () => actor.call("/data/erasure/journal") },
  };
  // Keep the existing row probe and assert each new OAuth door under its cells.
  let oauthFixture:Promise<{app:{id:string;secret:string};request:Record<string,string>;grantId:string}>|undefined;
  const prepareOAuth=()=>oauthFixture??=(async()=>{
    const app=await json<{id:string;secret:string}>(owner.call('/settings/oauth-apps','POST',{name:'synthetic-vector-4521',redirectUris:['https://synthetic-vector-4521.example.test/callback'],scopes:['issues:read']}));
    const request={response_type:'code',client_id:app.id,redirect_uri:'https://synthetic-vector-4521.example.test/callback',scope:'issues:read',state:'synthetic-vector-4522'};
    const approved=await json<{redirect:string}>(owner.call('/oauth/consent','POST',{request,decision:'approve'}));
    const granted=await json<{grant_id:string}>(createServerApp().request(origin+'/api/oauth/token',{method:'POST',headers:{'Content-Type':jsonMediaType},body:JSON.stringify({grant_type:'authorization_code',client_id:app.id,client_secret:app.secret,code:new URL(approved.redirect).searchParams.get('code'),redirect_uri:request.redirect_uri})},bindings));
    return {app,request,grantId:granted.grant_id};
  })();
  for(const row of ['integrations.manage','identity.personal'] as const){
    const previous=result[row].session;
    result[row].session=async(who,actor,team)=>{
      const send=await previous(who,actor,team);
      const {request,grantId}=await prepareOAuth();
      return async()=>{
        const response=await send(),allowed=row==='integrations.manage'?who==='owner'||who==='admin':who!=='guest';
        const targets=row==='integrations.manage'?
          [await actor.call('/settings/oauth-apps'),await actor.call('/settings/oauth-apps','POST',{name:'synthetic-vector-4523',redirectUris:[request.redirect_uri],scopes:['issues:read']}),await actor.call('/settings/oauth-apps/grants/'+grantId,'DELETE')]:
          [await actor.call('/oauth/consent?'+new URLSearchParams(request)),await actor.call('/oauth/consent','POST',{request,decision:'approve'})];
        for(const [index,target] of targets.entries())expect(target.status,'OAuth '+row+' '+who).toBe(allowed?(row==='integrations.manage'&&index===1?201:200):403);
        return response;
      };
    };
  }
  return result;
}

/** Additional doors carried by existing matrix rows. Kept separate so another
 * campaign's team-settings probes remain intact. */
export function githubRuleProbes(w:Workspace):{row:RowId;probe:Probe}[]{
 return [{row:'teams.settings',probe:{permission:'settings',session:async(who,actor,team)=>{
  const settings=(await w.state()).teams.find(t=>t.id===team)!.settingsPermission;
  const admitted=who==='owner'||who==='admin'||who==='lead'||(who==='member'&&settings==='all_members');
  const listed=await actor.call('/github/automation');
  expect(listed.status,who+' Git rules read').toBe(who==='guest'?403:200);
  if(listed.ok){
   const visible=await listed.json() as {teams:{id:string}[]};
   expect(visible.teams.some(t=>t.id===team),who+' '+settings+' Git rules visibility').toBe(admitted);
  }
  const state=await json<{teams:{id:string;rules:{trigger:string;version:number}[]}[]}>(w.people.owner.call('/github/automation'));
  const version=state.teams.find(t=>t.id===team)!.rules.find(r=>r.trigger==='draft')!.version;
  if(who==='guest'){
   const viewer=await w.fresh('member');
   expect((await w.people.owner.call('/settings/operators/'+viewer.id+'/role','PATCH',{role:'viewer',teamIds:[]})).status).toBe(200);
   expect((await viewer.call('/github/automation')).status,'Viewer cannot read Git rules').toBe(403);
   expect((await viewer.call('/settings/teams/'+team,'PATCH',{githubAutomation:{trigger:'draft',statusId:null,allowReopen:false,expectedVersion:version}})).status).toBe(403);
  }
  return ()=>actor.call('/settings/teams/'+team,'PATCH',{githubAutomation:{trigger:'draft',statusId:null,allowReopen:false,expectedVersion:version}});
 }}}];
}


/** RELEASE-001 carries the existing contract row without changing the
 * core role table owned by the concurrent administration campaign. */
export function releaseMatrixProbes(w:Workspace){
 const app=createServerApp();
 const prepare=async(who:Kind,actor:Person,team:string,send:(path:string,method?:string,body?:unknown)=>Promise<Response>)=>{
  const target=who==='guest'?await json<{id:string;version:number}>(w.people.owner.call('/releases','POST',{name:'synthetic-vector-1759',teamId:team})):null;
  return async()=>{
   const created=await send('/releases','POST',{name:'synthetic-vector-1751 '+actor.id,teamId:team});
   expect(created.status).toBe(who==='guest'?403:201);
   const release=target??await created.clone().json() as {id:string;version:number};let version=release.version;
   for(const [path,method,body] of [
    ['/releases/'+release.id,'GET',undefined],
    ['/releases/'+release.id,'PATCH',{expectedVersion:version,description:'synthetic-vector-1759'}],
    ['/releases/'+release.id+'/scope','PUT',{expectedVersion:version+1,issueIdentifiers:[],projectIds:[]}],
    ['/releases/'+release.id,'PATCH',{expectedVersion:version+2,status:'released'}],
   ] as const){const response=await send(path,method,body);expect(response.status).toBe(who==='guest'?403:200);}
   return created;
  };
 };
 return {action:'Create, edit or release a release (RELEASE-001)',
  session:async(who:Kind,actor:Person,team:string)=>prepare(who,actor,team,actor.call),
  api:async(who:Kind,actor:Person,team:string)=>{
   if(who==='guest')expect((await w.people.owner.call('/settings/operators/'+actor.id+'/role','PATCH',{role:'member'})).status).toBe(200);
   const minted=await json<{token:string}>(actor.call('/settings/integrations/tokens','POST',{name:'synthetic-vector-1759',scopes:['releases:read','releases:write']}));
   if(who==='guest')expect((await w.people.owner.call('/settings/operators/'+actor.id+'/role','PATCH',{role:'guest',teamIds:[team]})).status).toBe(200);
   const send=(path:string,method='GET',body?:unknown)=>app.request(origin+'/api/v1'+path,{method,headers:{Authorization:'Bearer '+minted.token,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},bindings);
   return prepare(who,actor,team,send);
  }
 };
}


/** Personal-preference doors inherit the existing Account access row. */
export function subscriptionPersonalProbe(w:Workspace){
 return {parent:'Open Settings pages (ROLE-008)',attempt:async(who:Kind,actor:Person,team:string)=>{
  // Personal preferences still require current team membership, including Admins.
  if(who==='admin')expect((await actor.call('/teams/'+team+'/join','POST',{})).status).toBe(200);
  return ()=>actor.call('/subscriptions','POST',{subjectType:'team',subjectId:team});
 }};
}

export function initiativeMatrixProbes(w:Workspace){
 const app=createServerApp();
 const prepare=async(who:Kind,actor:Person,team:string,send:(path:string,method?:string,body?:unknown)=>Promise<Response>)=>{
  const target=who==='guest'?await json<{id:string;version:number}>(w.people.owner.call('/initiatives','POST',{name:'synthetic-vector-1759',ownerOperatorId:actor.id})):null;
  return async()=>{
   const created=await send('/initiatives','POST',{name:'synthetic-vector-1751 '+actor.id,ownerOperatorId:actor.id});
   expect(created.status).toBe(who==='guest'?403:201);
   const initiative=target??await created.clone().json() as {id:string;version:number};let version=initiative.version;
   for(const [path,method,body] of [
    ['/initiatives/'+initiative.id,'GET',undefined],
    ['/initiatives/'+initiative.id,'PATCH',{expectedVersion:version,description:'synthetic-vector-1759'}],
    ['/initiatives/'+initiative.id+'/projects','PUT',{expectedVersion:version+1,projectIds:[]}],
    ['/initiatives/'+initiative.id,'PATCH',{expectedVersion:version+2,status:'completed'}],
   ] as const){const response=await send(path,method,body);expect(response.status).toBe(who==='guest'?403:200);}
   return created;
  };
 };
 return {action:'Create and edit initiatives; add projects to them (INIT-001)',
  session:async(who:Kind,actor:Person,team:string)=>prepare(who,actor,team,actor.call),
  api:async(who:Kind,actor:Person,team:string)=>{
   if(who==='guest')expect((await w.people.owner.call('/settings/operators/'+actor.id+'/role','PATCH',{role:'member'})).status).toBe(200);
   const minted=await json<{token:string}>(actor.call('/settings/integrations/tokens','POST',{name:'synthetic-vector-1759',scopes:['initiatives:read','initiatives:write']}));
   if(who==='guest')expect((await w.people.owner.call('/settings/operators/'+actor.id+'/role','PATCH',{role:'guest',teamIds:[team]})).status).toBe(200);
   const send=(path:string,method='GET',body?:unknown)=>app.request(origin+'/api/v1'+path,{method,headers:{Authorization:'Bearer '+minted.token,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},bindings);
   return prepare(who,actor,team,send);
  }
 };
}
