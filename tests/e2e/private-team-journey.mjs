import {readerResponse} from './role-reader-support.mjs';
import {privateTeamRequest,privateAdminMetadata} from './admin-team-journey.mjs';
import assert from 'node:assert/strict';
import {navigate} from './collaboration-navigation.mjs';
import {openDisclosures} from './ui-controls-checks.mjs';
import {roleScreens} from './role-ui-support.mjs';

/** ROLE-002 through existing Settings and work pages with the retained Member session. */
export async function privateTeamJourney({page,peer,memberId,runtime,clause,evidence}) {
 const {base,sql}=runtime,screens=roleScreens(evidence);
 const inspect=async(actor,region,name)=>{const viewport=actor.viewportSize();await screens(actor,region,name);await actor.setViewportSize(viewport);};
 const owner=sql('SELECT setup_operator_id id FROM workspace_installation')[0].id;
 const api=async(actor,path,method='GET',data,status=200)=>{
  const response=await readerResponse(actor,base,path,method,data);
  assert.equal(response.status,status,path+' '+response.text);return JSON.parse(response.text);
 };
 for(const width of [1440,390]) {
  const name='synthetic-vector-'+(width===1440?980:981);
  await page.setViewportSize({width,height:width===390?844:1000});await peer.setViewportSize({width,height:width===390?844:1000});
  await navigate(page,base+'/app/settings/teams');await openDisclosures(page);
  const create=page.getByRole('form',{name:'Create team',exact:true});
  await create.getByLabel('Team name',{exact:true}).fill(name);await create.getByLabel('Identifier prefix',{exact:true}).fill(width===1440?'SYNUIA':'SYNUIB');
  if(width===1440)await inspect(page,create,'private-team-create-controls');
  const made=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/teams'&&r.request().method()==='POST');
  await create.getByRole('button',{name:'Create team',exact:true}).click();assert.equal((await made).status(),200);
  const team=(await api(page,'/settings/administration')).teams.find(t=>t.name===name);
  const project=(await api(page,'/settings/projects','POST',{name:name+' project',leadOperatorId:owner})).projects.find(p=>p.name===name+' project');
  const initiative=await api(page,'/initiatives','POST',{name:name+' initiative',ownerOperatorId:owner},201);
  await api(page,`/initiatives/${initiative.id}/projects`,'PUT',{expectedVersion:initiative.version,projectIds:[project.id]});
  const publicTeam=(await api(page,'/settings/administration')).teams.find(t=>t.id!==team.id&&!t.isPrivate);
  await api(page,'/issues','POST',{title:name+' public work',teamId:publicTeam.id,projectId:project.id},201);
  const issue=await api(peer,'/issues','POST',{title:name+' private work',teamId:team.id,projectId:project.id,statusId:team.statuses.find(s=>s.category==='started').id,assigneeOperatorId:memberId,dueDate:'2026-11-04'},201);
  await api(peer,`/issues/${issue.identifier}/comments`,'POST',{body:name+' comment'},201);
  const set=async value=>{
   await navigate(page,base+'/app/settings/teams');await openDisclosures(page);
   const select=page.getByRole('combobox',{name:'Visibility of '+name,exact:true});
   const changed=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/privacy`&&r.request().method()==='PUT');
   await select.selectOption(value);assert.equal((await changed).status(),200);
   await page.waitForFunction(({name,value})=>document.querySelector(`[aria-label="Visibility of ${name}"]`)?.value===value,{name,value});assert.equal(await select.inputValue(),value);
  };
  await clause('ROLE-002',`Owner makes a team private at ${width}; non-member identifier, search, Current, exports and private join are refused`,async()=>{
   await set('private');
   assert.equal((await readerResponse(peer,base,`/issues/${issue.identifier}`)).status,404);
   assert.equal((await readerResponse(peer,base,`/teams/${team.id}/join`,'POST',{})).status,403);
   assert.equal((await readerResponse(peer,base,`/teams/${team.id}/requests`,'POST',{})).status,404);
   for(const path of ['/search?q='+encodeURIComponent(name+' private work'),'/current','/insights.csv?q='+encodeURIComponent(name+' private work')])assert.ok(!JSON.stringify((await readerResponse(peer,base,path)).text).includes(issue.identifier),path);
   await navigate(peer,base+'/app');assert.ok(!(await peer.locator('main:visible').first().innerText()).includes(issue.identifier));
   await navigate(peer,base+'/app/settings/teams');assert.equal(await peer.getByRole('button',{name:'Join '+name,exact:true}).count(),0);
  });
  if(width===1440){await inspect(page,page.getByRole('combobox',{name:'Visibility of '+name,exact:true}).locator('..'),'private-team-owner-controls');}
  await clause('ROLE-002',`non-member Admin sees its name and privacy control, changes visibility, and cannot read its work at ${width}`,async()=>{
   await api(page,`/settings/operators/${memberId}/role`,'PATCH',{role:'admin'});
   await navigate(peer,base+'/app/settings/teams');await openDisclosures(peer);
   assert.equal(await peer.getByRole('form',{name:'Edit '+name,exact:true}).count(),0);
   const control=peer.getByRole('combobox',{name:'Visibility of '+name,exact:true});
   assert.equal(await control.inputValue(),'private');
   await privateAdminMetadata({peer,name,team,api,inspect,width});
   if(width===1440)await inspect(peer,control.locator('..'),'private-team-admin-metadata');
   for(const value of ['public','private']){
    const receipt=peer.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/privacy`&&r.request().method()==='PUT');
    await control.selectOption(value);assert.equal((await receipt).status(),200);
    await peer.waitForFunction(({name,value})=>document.querySelector(`[aria-label="Visibility of ${name}"]`)?.value===value,{name,value});
   }
   assert.equal((await readerResponse(peer,base,`/issues/${issue.identifier}`)).status,404);
   await api(page,`/settings/operators/${memberId}/role`,'PATCH',{role:'member'});
  });

  await clause('ROLE-002 ROLE-007',`team owner adds the Member at ${width}; issue, Current, search and counted export become visible`,async()=>{
   const add=page.getByRole('form',{name:'Add member to '+name,exact:true});
   await add.getByRole('combobox',{name:'Member to add',exact:true}).selectOption(memberId);
   const changed=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/settings/teams/${team.id}/members/${memberId}`&&r.request().method()==='PUT');
   await add.getByRole('button',{name:'Add member',exact:true}).click();assert.equal((await changed).status(),200);
   await navigate(peer,base+'/app/issues/'+issue.identifier);await peer.getByRole('heading',{name:issue.title,exact:true}).waitFor();
   assert.ok(JSON.stringify(await api(peer,'/current')).includes(issue.identifier));assert.ok(JSON.stringify(await api(peer,'/search?q='+encodeURIComponent(issue.title))).includes(issue.identifier));
   const query='?q='+encodeURIComponent(issue.title),report=await api(peer,'/insights'+query);assert.equal(report.total,1);
   const csv=await readerResponse(peer,base,'/insights.csv'+query+'&bucket='+encodeURIComponent(report.rows[0].key));assert.equal(csv.status,200);assert.ok(csv.text.includes(issue.identifier));
  });
  if(width===1440)await inspect(peer,peer.locator('main:visible').first(),'private-team-member-issue');
  await clause('ROLE-002 WORK-004',`after team access is withdrawn Created, Subscribed and Activity omit the issue at ${width}`,async()=>{
   await api(page,`/settings/teams/${team.id}/members/${memberId}`,'DELETE');
   for(const [label,path] of [['Created','/app/my-work?tab=created'],['Subscribed','/app/my-work?tab=subscribed'],['Activity','/app/my-work?tab=activity']]){
    await navigate(peer,base+'/app/my-work');
    await peer.getByRole('link',{name:label,exact:true}).click();
    await peer.getByRole('heading',{name:label,exact:true}).waitFor();
    assert.ok(!(await peer.locator('main:visible').first().innerText()).includes(issue.identifier),path);
   }
   for(const path of ['/issues?scope=created','/issues?scope=subscribed','/my-work/activity'])assert.ok(!JSON.stringify(await api(peer,path)).includes(issue.identifier),path);
   const detail=await api(peer,'/projects/'+project.id);assert.equal(detail.progress.total,1);assert.ok(!JSON.stringify(detail).includes(issue.title));
   await navigate(peer,base+'/app/projects/'+project.id);await peer.getByRole('heading',{name:project.name,exact:true}).waitFor();assert.ok(!(await peer.locator('main:visible').first().innerText()).includes(issue.title));
  });
  if(width===1440)await inspect(peer,peer.locator('main:visible').first(),'private-team-spanning-project');
  await navigate(peer,base+'/app/initiatives/'+initiative.id);await peer.getByRole('heading',{name:initiative.name,exact:true,level:1}).waitFor();assert.ok(!(await peer.locator('main:visible').first().innerText()).includes(issue.title));await peer.getByText(/Visible issues: 1/).waitFor();
  if(width===1440)await inspect(peer,peer.locator('main:visible').first(),'private-team-spanning-initiative');
  await clause('ROLE-002 TEAM-007',`an exposed private request at ${width} grants no content or membership until its owner approves`,()=>privateTeamRequest({page,peer,memberId,runtime,team:{...team,identifier:issue.identifier},clause}));
  await set('public');assert.equal((await readerResponse(peer,base,`/issues/${issue.identifier}`)).status,200);
  assert.equal(sql(`SELECT count(*) n FROM audit_records WHERE action='team.privacy_changed' AND subject_id='${team.id}'`)[0].n,4);
 }
}
