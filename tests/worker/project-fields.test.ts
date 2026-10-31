import { issueGroupingJourney } from "./issue-grouping-journey";
import {exerciseProjectTemplates} from './project-template-proof';
import { expect,it,vi } from 'vitest';
import { exerciseMilestones } from './project-milestone-flow';
import { env } from 'cloudflare:workers';
import { setupIntegrations } from './integration-fixture';

it('[PROJ-012 PROJ-011 ISSUE-007 PROJ-001 PROJ-007] project planning and ordered milestones persist with activity, progress, slip and project-move clearing',async()=>{
  const f=await setupIntegrations();
  for(const name of ['Delivery','Customer'])await f.mutate('/settings/labels','POST',{name,color:'#405080',projectsEnabled:true});
  await f.mutate('/settings/labels','POST',{name:'Issues only',color:'#405080'});
  const state=await f.state(),labelIds=state.labels.filter(label=>label.projectsEnabled).map(label=>label.id);
  const initial=await f.mutate('/settings/projects','POST',{name:'Ship checkout',leadOperatorId:f.owner});
  const project=initial.projects.find(p=>p.name==='Ship checkout')!;
  const update={startDate:'2027-02-01',targetDate:'2027-02-20',priority:'high',labelIds};
  await f.mutate('/settings/projects/'+project.id,'PATCH',update);
  f.restart();
  const detail=await (await f.call('/projects/'+project.id)).json() as any;
  expect(detail).toMatchObject({startDate:update.startDate,targetDate:update.targetDate,priority:'high'});
  expect(detail.labels.map((l:any)=>l.id).sort()).toEqual([...labelIds].sort());
  const changes=detail.activity.filter((a:any)=>a.kind.endsWith('_changed'));
  expect(changes).toHaveLength(4);
  expect(changes.map((a:any)=>a.kind).sort()).toEqual(['project.startDate_changed','project.targetDate_changed','project.priority_changed','project.labelIds_changed'].sort());
  await f.mutate('/settings/projects/'+project.id,'PATCH',update);
  expect(((await (await f.call('/projects/'+project.id)).json()) as any).activity).toHaveLength(detail.activity.length);
  for(const invalid of [{targetDate:'2027-01-31'},{startDate:'2027-03-01'},{targetDate:'2027-02-30'}])expect((await f.call('/settings/projects/'+project.id,'PATCH',invalid)).status).toBe(400);
  expect(((await (await f.call('/projects/'+project.id)).json()) as any).activity).toHaveLength(detail.activity.length);
  const low=await f.mutate('/settings/projects','POST',{name:'A low priority project',leadOperatorId:f.owner,priority:'low',labelIds:[labelIds[0]]});
  await f.mutate('/settings/projects','POST',{name:'Unlabelled urgent',leadOperatorId:f.owner,priority:'urgent'});
  const portfolio=await (await f.call('/projects?label='+labelIds[0]+'&sort=priority&lifecycle=planned')).json() as any;
  expect(portfolio.projects.map((p:any)=>p.id)).toEqual([project.id,low.projects.find(p=>p.name==='A low priority project')!.id]);
  expect(portfolio.counts).toEqual({planned:2});
  await f.create({projectId:project.id});
  await f.mutate('/settings/projects/'+project.id,'PATCH',{lifecycle:'active'});
  for(const query of ['lifecycle=active','health=on-track','team='+f.initial.teams[0].id,'targetFrom=2027-02-01&targetTo=2027-02-20','label='+labelIds[1], 'lifecycle=active&health=on-track&lead='+f.owner+'&team='+f.initial.teams[0].id+'&targetFrom=2027-02-01&targetTo=2027-02-20&label='+labelIds[0]]) {
    const response=await f.call('/projects?at=2027-02-01T12%3A00%3A00Z&'+query);
    expect(response.status).toBe(200);
    const filtered=await response.json() as any;
    expect(filtered.projects.map((p:any)=>p.id)).toEqual([project.id]);
    expect(filtered.counts).toEqual({active:1,'on-track':1});
  }
  const byLead=await (await f.call('/projects?at=2027-02-01T12%3A00%3A00Z&lead='+f.owner)).json() as any;
  expect(byLead.projects).toHaveLength(3);
  expect(byLead.counts).toEqual({active:1,'on-track':1,planned:2});
  const noMatches=await (await f.call('/projects?label='+labelIds[0]+'&targetTo=2027-01-01')).json() as any;
  expect(noMatches.projects).toEqual([]); expect(noMatches.counts).toEqual({});
  expect((await f.call('/projects?targetFrom=2027-02-20&targetTo=2027-02-01')).status).toBe(400);

  const stored=await f.call('/preferences/projects','PUT',{filters:{label:labelIds[0]},sort:'priority'});
  expect(stored.status).toBe(200);
  expect(await (await f.call('/preferences/projects')).json()).toMatchObject({filters:{label:labelIds[0]},sort:'priority'});
  const unmarked=state.labels.find(label=>!label.projectsEnabled)!;
  expect((await f.call('/settings/projects/'+project.id,'PATCH',{labelIds:[unmarked.id]})).status).toBe(409);
  expect((await f.call('/settings/labels/'+labelIds[0],'PATCH',{projectsEnabled:false})).status).toBe(409);
  await f.mutate('/settings/labels/'+labelIds[0],'DELETE');
  const after=await (await f.call('/projects/'+project.id)).json() as any;
  expect(after.labels.map((label:any)=>label.id)).toEqual([labelIds[1]]);
  expect(after.activity.filter((a:any)=>a.kind==='project.labelIds_changed')).toHaveLength(2);
  expect(await (await f.call('/preferences/projects')).json()).toMatchObject({filters:{label:'all'}});
  await exerciseMilestones(f,project.id);
  await exerciseProjectTemplates(f);
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});

it('[PROJ-001 API-001] scoped project API creates and changes native planning fields and rejects invalid date changes atomically',async()=>{
  const f=await setupIntegrations();
  const state=await f.mutate('/settings/labels','POST',{name:'API delivery',color:'#405080',projectsEnabled:true});
  const label=state.labels.find(l=>l.name==='API delivery')!;
  const second=await f.mutate('/settings/labels','POST',{name:'API customer',color:'#405080',projectsEnabled:true});
  const other=second.labels.find(l=>l.name==='API customer')!;
  const reader=await f.issueToken(['projects:read']),writer=await f.issueToken(['projects:read','projects:write']);
  const input={name:'API launch',leadOperatorId:f.owner,startDate:'2027-04-01',targetDate:'2027-04-20',priority:'high',labelIds:[label.id,other.id]};
  expect((await f.api(reader.token,'/projects','POST',input)).status).toBe(401);
  const created=await f.api(writer.token,'/projects','POST',input);
  expect(created.status,await created.clone().text()).toBe(201);
  const project=await created.json() as any;
  expect(project).toMatchObject({startDate:input.startDate,targetDate:input.targetDate,priority:'high'});
  expect(project.labels.map((l:any)=>l.id).sort()).toEqual([label.id,other.id].sort());
  const before=project.activity.length;
  expect((await f.api(writer.token,'/projects/'+project.id,'PATCH',{targetDate:'2027-03-01',priority:'urgent'})).status).toBe(400);
  expect((await (await f.api(reader.token,'/projects/'+project.id)).json()) as any).toMatchObject({priority:'high',activity:expect.arrayContaining(project.activity)});
  const changed=await f.api(writer.token,'/projects/'+project.id,'PATCH',{startDate:'2027-04-02',targetDate:'2027-04-21',priority:'urgent',labelIds:[]});
  expect(changed.status,await changed.clone().text()).toBe(200);
  const value=await changed.json() as any;
  expect(value.activity).toHaveLength(before+4);
  expect(value.labels).toEqual([]);
  expect((await f.api(reader.token,'/projects?sort=priority')).status).toBe(200);
  expect((await f.api(reader.token,'/projects/'+project.id,'PATCH',{priority:'low'})).status).toBe(401);
  expect((await f.api(writer.token,'/projects','POST',{...input,name:'Bad range',targetDate:'2027-01-01'})).status).toBe(400);
});


it("[PROJ-001] a project's color and icon save, appear on list and page and are one activity entry each",async()=>{
  const f=await setupIntegrations();
  const state=await f.mutate('/settings/projects','POST',{name:'Visual identity',leadOperatorId:f.owner});
  const id=state.projects.find(project=>project.name==='Visual identity')!.id;
  const read=async()=>await (await f.call('/projects/'+id)).json() as any;
  const initial=await read();
  expect(initial).toMatchObject({color:null,icon:null});
  const identity={color:'#A34F80',icon:'🚀'};
  await f.mutate('/settings/projects/'+id,'PATCH',identity);
  f.restart();
  const detail=await read();
  expect(detail).toMatchObject({color:identity.color.toLowerCase(),icon:identity.icon});
  const changes=detail.activity.filter((entry:any)=>entry.kind.endsWith('_changed'));
  expect(changes).toHaveLength(2);
  expect(changes).toEqual(expect.arrayContaining([
    expect.objectContaining({kind:'project.color_changed',previousValue:null,nextValue:identity.color.toLowerCase()}),
    expect.objectContaining({kind:'project.icon_changed',previousValue:null,nextValue:identity.icon}),
  ]));
  const portfolio=await (await f.call('/projects')).json() as any;
  expect(portfolio.projects.find((project:any)=>project.id===id)).toMatchObject({color:identity.color.toLowerCase(),icon:identity.icon});
  expect((await f.state()).projects.find(project=>project.id===id)).toMatchObject({color:identity.color.toLowerCase(),icon:identity.icon});
  await f.mutate('/settings/projects/'+id,'PATCH',identity);
  expect((await read()).activity).toHaveLength(detail.activity.length);

  const reader=await f.issueToken(['projects:read']),writer=await f.issueToken(['projects:read','projects:write']);
  const apiRead=async()=>await (await f.api(reader.token,'/projects/'+id)).json() as any;
  expect(await apiRead()).toMatchObject({color:identity.color.toLowerCase(),icon:identity.icon});
  const apiList=await (await f.api(reader.token,'/projects')).json() as any;
  expect(apiList.projects.find((project:any)=>project.id===id)).toMatchObject({color:identity.color.toLowerCase(),icon:identity.icon});
  for(const invalid of [{color:'#abc'},{color:'red'},{color:''},{color:'#a34f80\n'},{icon:'🚀\n'},{icon:'text'},{icon:'🚀🌙'},{icon:''}]) {
    expect((await f.call('/settings/projects/'+id,'PATCH',invalid)).status).toBe(400);
    expect((await f.api(writer.token,'/projects/'+id,'PATCH',{...invalid,name:'Must not save'})).status).toBe(400);
  }
  expect(await apiRead()).toMatchObject({name:initial.name,color:identity.color.toLowerCase(),icon:identity.icon,activity:detail.activity});
  // Multi-code-point emoji remain one icon and one change, including flags and keycaps.
  let previous=identity.icon;
  let expectedEntries=detail.activity.length;
  for(const icon of ['👩🏽‍💻','🇦🇺','1️⃣']) {
    const response=await f.api(writer.token,'/projects/'+id,'PATCH',{icon});
    expect(response.status,await response.clone().text()).toBe(200);
    const changed=await response.json() as any;
    expect(changed).toMatchObject({color:identity.color.toLowerCase(),icon});
    expect(changed.activity).toHaveLength(++expectedEntries);
    expect(changed.activity).toContainEqual(expect.objectContaining({kind:'project.icon_changed',previousValue:previous,nextValue:icon}));
    previous=icon;
  }
  const cleared=await f.api(writer.token,'/projects/'+id,'PATCH',{color:null,icon:null});
  expect(cleared.status,await cleared.clone().text()).toBe(200);
  expect(await cleared.json()).toMatchObject({color:null,icon:null,activity:expect.arrayContaining([
    expect.objectContaining({kind:'project.color_changed',previousValue:identity.color.toLowerCase(),nextValue:null}),
    expect.objectContaining({kind:'project.icon_changed',previousValue:previous,nextValue:null}),
  ])});
  expect((await apiRead()).activity).toHaveLength(expectedEntries+2);
  await f.mutate('/settings/projects/'+id,'PATCH',{color:null,icon:null});
  expect((await read()).activity).toHaveLength(expectedEntries+2);
  const created=await f.api(writer.token,'/projects','POST',{name:'API visual identity',leadOperatorId:f.owner,...identity});
  expect(created.status,await created.clone().text()).toBe(201);
  expect(await created.json()).toMatchObject({color:identity.color.toLowerCase(),icon:identity.icon});
});


it("milestone and parent grouping count complete filtered results and saved views obey current reader authority", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date());
  try { await issueGroupingJourney(); } finally { vi.useRealTimers(); }
}, 120_000);
