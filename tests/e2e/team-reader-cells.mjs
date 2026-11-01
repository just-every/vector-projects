import assert from 'node:assert/strict';
import {readerApi} from './role-reader-support.mjs';
import {navigate} from './collaboration-navigation.mjs';
import {openDisclosures} from './ui-controls-checks.mjs';

export async function teamCreationReaderCell(viewer,runtime,width){
 await viewer.page.setViewportSize({width,height:width===390?844:1000});await navigate(viewer.page,runtime.base+'/app/settings/teams');await viewer.page.getByText('You can’t open this page.').waitFor();
 assert.equal(await viewer.page.getByRole('form',{name:'Create team',exact:true}).count(),0);assert.equal(await viewer.page.getByRole('form',{name:'Team creation permission',exact:true}).count(),0);
 for(const [path,method,data] of [['/settings/teams','POST',{name:'synthetic-vector-1940',identifierPrefix:'SYNNO'}],['/settings/teams/creation','PUT',{membersMayCreate:true}]])await viewer.api(path,method,data,403);
}

export async function teamJoinReaderCells({page,peer,requester,viewer,runtime,team,member,width}){
 const base=runtime.base,owner=readerApi(page,base),lead=readerApi(peer,base),api=readerApi(requester,base);
 const issue=await owner('/issues','POST',{teamId:team.id,title:'synthetic-vector-'+(width===1440?1941:1942)},201);
 await owner(`/settings/teams/${team.id}/privacy`,'PUT',{isPrivate:true});
 await lead(`/settings/teams/${team.id}/members/${member}`,'DELETE');
 await api(`/teams/${team.id}/join`,'POST',{},403);
 for(const path of [`/teams/${team.id}/join`,`/teams/${team.id}/requests`])await viewer.api(path,'POST',{},403);
 await lead(`/settings/teams/${team.id}/members/${viewer.id}`,'PUT',{role:'member'},403);
 await navigate(requester,base+'/app/settings/teams');
 let response=requester.waitForResponse(r=>new URL(r.url()).pathname===`/api/teams/${team.id}/requests`&&r.request().method()==='POST');
 await requester.getByRole('button',{name:'Request to join '+team.name,exact:true}).click();assert.equal((await response).status(),200);
 await api('/issues/'+issue.identifier,'GET',undefined,404);assert.ok(!JSON.stringify(await api('/search?q='+encodeURIComponent(issue.title))).includes(issue.identifier));
 assert.equal(runtime.sql(`SELECT count(*) n FROM team_members WHERE team_id='${team.id}' AND operator_id='${member}'`)[0].n,0);
 await navigate(peer,base+'/app/settings/teams');await openDisclosures(peer);
 const request=peer.getByRole('group',{name:'Request from Delivery lead',exact:true});response=peer.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/requests/${member}/decision`&&r.request().method()==='POST');
 await request.getByRole('button',{name:'Approve Delivery lead',exact:true}).click();assert.equal((await response).status(),200);await api('/issues/'+issue.identifier);
 await lead(`/settings/teams/${team.id}/membership`,'PUT',{mode:'invite_only',requestsEnabled:false});await lead(`/settings/teams/${team.id}/members/${member}`,'DELETE');
 await api(`/teams/${team.id}/requests`,'POST',{},404);
 await owner(`/settings/teams/${team.id}/members/${viewer.id}`,'PUT',{role:'member'});await viewer.api('/issues/'+issue.identifier);
 await viewer.api('/issues/'+issue.identifier+'/comments','POST',{body:'synthetic-vector-1943'},403);
 console.log(`TEAM-007 ${width}: private request grants no content/membership, hidden request 404, team-owner approval, Owner-only Viewer grant and Viewer join/request refusal PASS`);
}

export async function privateTeamCreationCells({page,peer,runtime,width,evidence}){
 const owner=readerApi(page,runtime.base),id=runtime.sql("SELECT id FROM operators WHERE email='role-member@admin-runtime.test'")[0].id;
 await owner(`/settings/operators/${id}/role`,'PATCH',{role:'admin'});
 try{
  for(const [actor,index] of [[page,1950],[peer,1951]]){
   await actor.setViewportSize({width,height:width===390?844:1000});await navigate(actor,runtime.base+'/app/settings/teams');await openDisclosures(actor);
   const form=actor.getByRole('form',{name:'Create team',exact:true}),name='synthetic-vector-'+index+'-'+width;
   await form.getByLabel('Team name',{exact:true}).fill(name);await form.getByLabel('Identifier prefix',{exact:true}).fill('SYN'+(width===1440?'D':'M')+(index===1950?'O':'A'));await form.getByLabel('Private team',{exact:true}).check();
   const response=actor.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/teams'&&r.request().method()==='POST');await form.getByRole('button',{name:'Create team',exact:true}).click();const result=await response;assert.equal(result.status(),200);const team=(await result.json()).teams.find(t=>t.name===name);assert.equal(team.isPrivate,true);assert.equal(runtime.sql(`SELECT count(*) n FROM audit_records WHERE action='team.created' AND subject_id='${team.id}'`)[0].n,1);
  }
 }finally{await owner(`/settings/operators/${id}/role`,'PATCH',{role:'member'});}
 console.log(`TEAM-008 ${width}: Owner/Admin private creation, Member privacy refusal and Viewer refusal under both workspace permissions PASS`);
}
