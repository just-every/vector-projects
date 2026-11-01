import {viewerAccessCensus} from './role-access-census.mjs';
import { openAccountMenu } from './ui-controls-checks.mjs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {navigate,settleReads} from './collaboration-navigation.mjs';
import {roleScreens} from './role-ui-support.mjs';
import {inviteReader,readerApi} from './role-reader-support.mjs';

export async function viewerRoleJourney({page,peer,memberId,browser,runtime,clause,evidence}){
 const {base,sql}=runtime,owner=readerApi(page,base),screens=roleScreens(evidence);
 const axeSource=await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');
 const signInScreen=name=>async reader=>{await reader.evaluate(axeSource);await inspect(reader,reader.locator('main').first(),name);};
 const inspect=async(actor,region,name)=>{const viewport=actor.viewportSize();await screens(actor,region,name);await actor.setViewportSize(viewport);};
 const ownerId=sql('SELECT setup_operator_id id FROM workspace_installation')[0].id;
 const team=(await owner('/settings/administration')).teams.find(t=>!t.isPrivate&&!t.archivedAt);
 const project=(await owner('/settings/projects','POST',{name:'synthetic-vector-1800',leadOperatorId:ownerId})).projects.find(p=>p.name==='synthetic-vector-1800');
 const label=(await owner('/settings/labels','POST',{name:'synthetic-vector-1801',color:'#2255aa'})).labels.find(l=>l.name==='synthetic-vector-1801');
 const issue=await owner('/issues','POST',{title:'synthetic-vector-1802',teamId:team.id,projectId:project.id,labelIds:[label.id],estimate:3,dueDate:'2026-11-04',expectedOutcome:'Release evidence is ready',customerImpact:'Stakeholders can inspect the delivery',description:'Read this delivery.\n\n- [ ] Confirm delivery'},201);
 const reactedComment=await owner(`/issues/${issue.identifier}/comments`,'POST',{body:'synthetic-vector-1803'},201);
 for(const targetId of ['',reactedComment.id])await owner(`/issues/${issue.identifier}/reactions`,'PUT',{targetId,emoji:'👍'});
 const view=await owner('/views','POST',{name:'synthetic-vector-1804',isShared:true,query:{project:project.id}},201);
 const initiative=await owner('/initiatives','POST',{name:'synthetic-vector-1805',ownerOperatorId:ownerId},201);
 await owner(`/initiatives/${initiative.id}/projects`,'PUT',{expectedVersion:initiative.version,projectIds:[project.id]});
 const release=await owner('/releases','POST',{name:'synthetic-vector-1806'},201);
 await owner(`/releases/${release.id}/scope`,'PUT',{expectedVersion:release.version,issueIdentifiers:[issue.identifier],projectIds:[]});
 const privateTeam=(await owner('/settings/teams','POST',{name:'synthetic-vector-1807',identifierPrefix:'SYNRO',isPrivate:true})).teams.find(t=>t.name==='synthetic-vector-1807');
 const hidden=await owner('/issues','POST',{teamId:privateTeam.id,title:'synthetic-vector-1808'},201);
 let invited;
 try{
  await clause('ROLE-013','Owner invites a Viewer through named-team Settings; accepted sign-in reads public work without write controls at 1440 and 390',async()=>{
   invited=await inviteReader({owner:page,browser,runtime,email:'synthetic-vector-1809@vector.test',name:'synthetic-vector-1809',form:true,beforeSend:form=>inspect(page,form,'viewer-invitation'),beforeConfirm:signInScreen('viewer-sign-in')});
   const reader=invited.page,api=invited.api;
   assert.equal((await api('/metadata')).viewer.role,'viewer');
   for(const path of [`/issues/${issue.identifier}`,`/projects/${project.id}`,`/views/${view.id}`])await api(path);
   const before=sql(`SELECT title,version FROM issues WHERE id='${issue.id}'`)[0];
   const reactionsBefore=sql(`SELECT * FROM issue_reactions WHERE issue_id='${issue.id}' ORDER BY target_id`);
   for(const targetId of ['',reactedComment.id])for(const method of ['PUT','DELETE'])await api(`/issues/${issue.identifier}/reactions`,method,{targetId,emoji:'👍'},403);
   assert.deepEqual(sql(`SELECT * FROM issue_reactions WHERE issue_id='${issue.id}' ORDER BY target_id`),reactionsBefore);
   for(const [path,method,data] of [
    [`/issues/${issue.identifier}`,'PATCH',{expectedVersion:issue.version,title:'synthetic-vector-1810'}],
    [`/issues/${issue.identifier}/comments`,'POST',{body:'synthetic-vector-1811'}],
    [`/issues/${issue.identifier}`,'PATCH',{expectedVersion:issue.version,labelIds:[]}],
    [`/settings/projects/${project.id}`,'PATCH',{name:'synthetic-vector-1812'}],
    [`/views/${view.id}/duplicate`,'POST',{name:'synthetic-vector-1813'}],
    ['/settings/integrations/tokens','POST',{name:'synthetic-vector-1814',scopes:['issues:read']}],
    [`/teams/${team.id}/join`,'POST',{}],[`/teams/${privateTeam.id}/requests`,'POST',{}],
   ])await api(path,method,data,403);
   assert.deepEqual(sql(`SELECT title,version FROM issues WHERE id='${issue.id}'`)[0],before);
   for(const width of [1440,390]){
    await reader.setViewportSize({width,height:width===390?844:1000});
    await navigate(reader,base+'/app/issues/'+issue.identifier);await reader.getByRole('heading',{name:issue.title,exact:true}).waitFor();
    await reader.getByText(label.name,{exact:true}).waitFor();
    await reader.getByRole('button',{name:'Edit estimate',exact:true}).waitFor();assert.equal(await reader.getByRole('button',{name:'Edit estimate',exact:true}).isDisabled(),true);
    assert.equal(await reader.getByRole('button',{name:'Edit issue',exact:true}).count(),0);assert.equal(await reader.getByRole('button',{name:'Add comment',exact:true}).count(),0);
    assert.equal(await reader.getByRole('combobox',{name:'Issue status',exact:true}).isDisabled(),true);
    for(const label of ['Description reactions','Comment reactions']){const group=reader.getByRole('group',{name:label,exact:true});await group.getByRole('button',{name:'Add 👍 reaction',exact:true}).waitFor();assert.equal(await group.getByRole('button',{name:'Add 👍 reaction',exact:true}).isDisabled(),true);}
    await inspect(reader,reader.locator('main:visible').first(),'viewer-issue-read-'+width);
    await navigate(reader,base+'/app/projects/'+project.id);await reader.getByRole('heading',{name:project.name,exact:true}).waitFor();assert.equal(await reader.getByRole('button',{name:'Add milestone',exact:true}).count(),0);
    if(width===1440)await inspect(reader,reader.locator('main:visible').first(),'viewer-project-read');
    await navigate(reader,base+'/app/views/'+view.id);await reader.getByRole('heading',{name:view.name,exact:true}).waitFor();assert.equal(await reader.getByRole('button',{name:'Duplicate view',exact:true}).count(),0);
    if(width===1440)await inspect(reader,reader.locator('main:visible').first(),'viewer-shared-view');
    await navigate(reader,base+'/app/settings');await reader.getByRole('navigation',{name:'Settings sections'}).locator('.settings-nav-name',{hasText:'Labels'}).waitFor();assert.deepEqual(await reader.getByRole('navigation',{name:'Settings sections'}).locator('.settings-nav-name').allTextContents(),['Profile','Notifications','People','Labels']);
    await navigate(reader,base+'/app/settings/people');await reader.getByText('synthetic-vector-1809 (you)',{exact:true}).waitFor();assert.equal(await reader.getByRole('button',{name:'Change role',exact:true}).count(),0);
    for(const denied of ['teams','developers']){await navigate(reader,base+'/app/settings/'+denied);await reader.getByText('You can’t open this page.').waitFor();assert.equal(await reader.getByRole('region',{name:'Teams',exact:true}).count(),0);assert.equal(await reader.getByRole('heading',{name:'API tokens',exact:true}).count(),0);}
    await navigate(reader,base+'/app/settings/labels');
    const labels=reader.getByRole('list',{name:'Labels',exact:true});await labels.getByText(label.name,{exact:true}).waitFor();
    assert.equal(await labels.getByRole('form',{name:'Create label',exact:true}).count(),0);
    await inspect(reader,labels,'viewer-labels-'+width);
   }
  });
  await clause('ROLE-013 OPS-001','Viewer Inbox, counted exports, attachment bytes and private lookup follow current privacy and membership; admitted Viewers remain read-only',async()=>{
   await viewerAccessCensus({owner,page,reader:invited,runtime,evidence});
   await invited.api('/issues/'+hidden.identifier,'GET',undefined,404);assert.ok(!JSON.stringify(await invited.api('/search?q='+encodeURIComponent(hidden.title))).includes(hidden.identifier));
   await owner(`/settings/operators/${memberId}/role`,'PATCH',{role:'admin'});
   await readerApi(peer,base)(`/settings/teams/${privateTeam.id}/members/${invited.id}`,'PUT',{role:'member'});
   await owner(`/settings/operators/${memberId}/role`,'PATCH',{role:'member'});
   await invited.api('/issues/'+hidden.identifier);assert.ok(JSON.stringify(await invited.api('/search?q='+encodeURIComponent(hidden.title))).includes(hidden.identifier));
   await invited.api('/issues/'+hidden.identifier+'/comments','POST',{body:'synthetic-vector-1815'},403);
  });
  await clause('ROLE-013','the same open Member session loses mutation authority on the next request after an Admin changes it to Viewer',async()=>{
   await navigate(peer,base+'/app/issues/'+issue.identifier);await peer.getByRole('heading',{name:issue.title,exact:true}).waitFor();
   await owner(`/settings/operators/${memberId}/role`,'PATCH',{role:'viewer',teamIds:[]});
   await readerApi(peer,base)('/issues/'+issue.identifier,'PATCH',{expectedVersion:issue.version,title:'synthetic-vector-1816'},403);
   assert.equal(sql(`SELECT title FROM issues WHERE id='${issue.id}'`)[0].title,issue.title);
   await owner(`/settings/operators/${memberId}/role`,'PATCH',{role:'member'});
  });
  for(const [path,name,heading] of [
   ['/app/projects','viewer-project-list','Projects'],['/app/initiatives','viewer-initiative-list','Initiatives'],['/app/initiatives/'+initiative.id,'viewer-initiative',initiative.name],['/app/releases','viewer-release-list','Releases'],['/app/releases/'+release.id,'viewer-release',release.name],['/app/new-issue','viewer-new-issue','New issue'],
  ]){
   await navigate(invited.page,base+path);await invited.page.getByRole('heading',{name:heading,exact:true,level:1}).waitFor();await inspect(invited.page,invited.page.locator('main:visible').first(),name);
  }
  await clause('ROLE-013','Viewer signs in and signs out through native account controls at 1440 and 390 and loses admission',async()=>{
   await invited.page.setViewportSize({width:1440,height:1000});await navigate(invited.page,base+'/app/settings');await inspect(invited.page,invited.page.locator('main:visible').first(),'viewer-sign-out');await settleReads(invited.page);await invited.page.getByRole('button',{name:'Sign out',exact:true}).filter({visible:true}).click();await invited.page.waitForURL(base+'/signin');await invited.api('/session','GET',undefined,401);
   const mobile=await inviteReader({owner:page,browser,runtime,email:'synthetic-vector-1993@vector.test',name:'synthetic-vector-1993',width:390,beforeConfirm:signInScreen('viewer-mobile-sign-in')});
   try{assert.equal((await mobile.api('/metadata')).viewer.role,'viewer');await navigate(mobile.page,base+'/app/settings');await settleReads(mobile.page);await openAccountMenu(mobile.page);
  await mobile.page.getByRole('button',{name:'Sign out',exact:true}).filter({visible:true}).click();await mobile.page.waitForURL(base+'/signin');await mobile.api('/session','GET',undefined,401);assert.deepEqual(mobile.errors,[],'Viewer mobile hydration errors');}
   finally{await mobile.context.close();}
  });
  for(const width of [1440,390])await clause('ROLE-013',`Viewer leaves their own account at ${width}`,async()=>{
   const name='synthetic-vector-'+(width===1440?1964:1965),leaving=await inviteReader({owner:page,browser,runtime,email:name+'@vector.test',name});
   try{
    await leaving.page.setViewportSize({width,height:width===390?844:1000});await navigate(leaving.page,base+'/app/settings/people');
    await leaving.page.getByRole('link',{name:name+' (you)'}).click();await leaving.page.getByRole('button',{name:'Leave workspace',exact:true}).click();await leaving.page.getByRole('button',{name:'Confirm removal',exact:true}).click();await leaving.page.waitForURL(base+'/signin');await leaving.api('/session','GET',undefined,401);
   }finally{await leaving.context.close();}
  });

  assert.deepEqual(invited.errors,[],'Viewer hydration errors');
 }finally{await invited?.context.close();}
}
