import {inviteReader,readerResponse} from './role-reader-support.mjs';
import {roleScreens} from './role-ui-support.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {beforePrivateNavigation} from './collaboration-navigation.mjs';
const require=createRequire(import.meta.url);

export async function projectDocumentsJourney({page,base,api,output,runtime}){
 await mkdir(output,{recursive:true});
 const errors=[];
 const pageError=error=>errors.push(String(error));
 const consoleError=message=>{if(message.type()==='error'&&/hydrat|server.render|react error/i.test(message.text()))errors.push(message.text());};
 page.on('pageerror',pageError);page.on('console',consoleError);
 const go=async path=>{await beforePrivateNavigation(page,base+path);await page.goto(base+path);};
 async function proof(name,width){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' horizontal overflow');
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  const violations=await page.evaluate(async()=>{const result=await window.axe.run(document);return result.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});
  assert.deepEqual(violations,[],name+' serious/critical axe');
  assert.deepEqual(errors,[],name+' hydration and page errors');
  await page.screenshot({path:output+'/'+name+'-'+width+'.png',fullPage:true});
 }
 try{
  const {operatorId}=await api('/session');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:1000});
   const suffix=String(Date.now()),name='synthetic-vector-documents-'+width+'-'+suffix;
   const prefix='DOC'+suffix.slice(-6).replaceAll(/\d/g,d=>String.fromCharCode(65+Number(d)));
   const team=(await api('/settings/teams','POST',{name:name+' team',identifierPrefix:prefix})).teams.find(t=>t.name===name+' team');
   const project=(await api('/settings/projects','POST',{name:name+' project',leadOperatorId:operatorId})).projects.find(p=>p.name===name+' project');
   const issue=await api('/issues','POST',{teamId:team.id,projectId:project.id,title:name+' issue'});
   const initiative=await api('/initiatives','POST',{name:name+' initiative',ownerOperatorId:operatorId});
   const initiativeDoc=await api('/documents','POST',{parentKind:'initiative',parentId:initiative.id,title:name+' initiative handbook',body:'Initiative document body'});
   const teamDoc=await api('/documents','POST',{parentKind:'team',parentId:team.id,title:name+' team runbook',body:'Team document body'});
   const issueDoc=await api('/documents','POST',{parentKind:'issue',parentId:issue.id,title:name+' issue notes',body:'Issue document body'});
   await go('/app/projects/'+project.id);
   const section=page.getByRole('region',{name:'Documents',exact:true});
   const newDocument=section.locator('summary').filter({hasText:'New document'});
   await newDocument.click();
   const draft=section.getByRole('form',{name:'Document draft'}),title=name+' spec';
   await draft.getByLabel('Document title',{exact:true}).fill(title);
   await draft.getByLabel('Document title',{exact:true}).fill('');
   await page.reload();
   await section.locator('form[aria-label="Document draft"] fieldset:enabled').waitFor({state:'attached'});
   assert.equal(await newDocument.evaluate(summary=>summary.parentElement.open),false);
   assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('vector:document-draft:'))),[]);
   await newDocument.click();
   await draft.getByLabel('Document title',{exact:true}).fill(title);
   await draft.getByLabel('Document body',{exact:true}).fill('# Original plan\n\nOriginal spec body\n\nSee '+issue.identifier+'; unknown SYNTHETIC_VECTOR-999999.');
   await proof('project-document-draft',width);
   await draft.getByRole('button',{name:'Create document',exact:true}).click();
   await page.getByRole('heading',{name:title,exact:true}).waitFor();
   const documentId=new URL(page.url()).pathname.split('/').at(-1);
   assert.match(documentId,/^[0-9A-HJKMNP-TV-Z]{26}$/);
   const documentLink=page.getByRole('region',{name:'Document content'}).getByRole('link',{name:issue.identifier,exact:true});
   if(width===1440){
    await documentLink.waitFor();await documentLink.focus();
    assert.equal(await page.getByRole('tooltip').filter({hasText:issue.title}).isVisible(),true);
    assert.ok((await page.getByRole('tooltip').innerText()).includes(issue.status.name));
    await page.getByRole('heading',{name:title,exact:true}).click();await documentLink.hover();
    await page.getByRole('tooltip').filter({hasText:issue.title}).waitFor();
    assert.equal(await page.getByRole('region',{name:'Document content'}).getByRole('link',{name:'SYNTHETIC_VECTOR-999999',exact:true}).count(),0);
   }
   await proof('document-reference-links',width);
   const bodies=['## First review\n\nFirst edited specification\n\nSee '+issue.identifier,'## Approved plan\n\nSecond edited specification'];
   for(const body of bodies){
    const editor=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Edit document'})});
    if(await editor.getAttribute('open')===null)await editor.locator('summary').click();
    const form=editor.getByRole('form',{name:'Edit document'});
    await form.getByLabel('Document body',{exact:true}).fill(body);
    await page.reload();
    const restored=editor.getByRole('form',{name:'Edit document'});
    await restored.getByLabel('Document body',{exact:true}).waitFor();
    assert.equal(await restored.getByLabel('Document body',{exact:true}).inputValue(),body);
    await restored.getByRole('button',{name:'Publish revision',exact:true}).click();
    await page.getByRole('region',{name:'Document content'}).getByText(body.split('\n').at(-1),{exact:true}).waitFor();
   }
   const comments=page.getByRole('region',{name:'Document comments',exact:true});
   await comments.getByLabel('Comment',{exact:true}).fill('Document review note '+width);
   await comments.getByRole('button',{name:'Post comment',exact:true}).click();
   await comments.getByText('Document review note '+width,{exact:true}).waitFor();
   const history=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Revision history'})});
   await history.locator('summary').click();
   await history.getByRole('heading',{name:'Revision 2',exact:true}).waitFor();
   await history.getByRole('heading',{name:'Revision 3',exact:true}).waitFor();
   assert.equal(await history.getByText('First edited specification',{exact:true}).count(),1);
   assert.equal(await history.getByText('Second edited specification',{exact:true}).count(),1);
   await proof('document-revisions',width);
   if(width===1440){
    const retained=(await api('/issues/'+issue.identifier)).activity.filter(row=>row.kind==='issue.mentioned'&&row.nextValue.sourceDocumentId===documentId);
    assert.equal(retained.length,1);assert.equal(retained[0].nextValue.removed,true);
   }
   await go('/app/projects/'+project.id);
   await page.getByRole('region',{name:'Documents',exact:true}).getByRole('link',{name:title,exact:true}).waitFor();
   await proof('project-documents-list',width);
   await go('/app/issues/'+issue.identifier);
   const spec=page.getByRole('region',{name:'Issue specification',exact:true});
   await spec.locator('summary').click();
   const specificationWrites=[];
   const specificationRequest=request=>{if(new URL(request.url()).pathname==='/api/issues/'+issue.identifier+'/specification'&&request.method()!=='GET')specificationWrites.push(request.method());};
   page.on('request',specificationRequest);
   await spec.getByLabel('Specification document',{exact:true}).selectOption(documentId);
   assert.equal(await spec.getByRole('button',{name:'Save specification',exact:true}).count(),0);
   await spec.getByRole('status').filter({hasText:'Saved'}).waitFor();
   page.off('request',specificationRequest);
   assert.deepEqual(specificationWrites,['PUT']);
   await spec.getByRole('link',{name:title,exact:true}).waitFor();
   const issueDocuments=page.getByRole('region',{name:'Documents',exact:true});
   await issueDocuments.locator('summary').first().click();
   await issueDocuments.getByRole('link',{name:issueDoc.title,exact:true}).waitFor();
   await issueDocuments.getByRole('link',{name:team.name+' documents',exact:true}).click();
   await page.getByRole('heading',{name:team.name,exact:true}).waitFor();
   await go('/app/issues/'+issue.identifier);
   await spec.locator('summary').click();
   assert.equal((await api('/issues/'+issue.identifier)).specification.id,documentId);
   await proof('issue-specification',width);
   await spec.getByRole('link',{name:title,exact:true}).click();
   await page.getByRole('heading',{name:title,exact:true}).waitFor();
   await page.getByRole('region',{name:'Document content'}).getByText('Second edited specification',{exact:true}).waitFor();
   await proof('followed-specification',width);
   await go('/app/initiatives/'+initiative.id);
   await page.getByRole('region',{name:'Documents',exact:true}).getByRole('link',{name:initiativeDoc.title,exact:true}).waitFor();
   await proof('initiative-documents',width);
   await go('/app/settings/teams');
   await page.waitForFunction(label=>[...document.querySelectorAll('form')].find(f=>f.getAttribute('aria-label')===label)?.querySelector('button')?.matches(':enabled'),'Edit '+name+' team');
   const teamSummary=page.locator('summary').filter({hasText:name+' team'});
   await teamSummary.click();
   const teamCard=teamSummary.locator('..');
   await teamCard.getByRole('link',{name:'Team documents',exact:true}).waitFor();
   await proof('settings-team-documents-link',width);
   await teamCard.getByRole('link',{name:'Team documents',exact:true}).click();
   await page.getByRole('heading',{name:team.name,exact:true}).waitFor();
   await page.getByRole('region',{name:'Documents',exact:true}).getByRole('link',{name:teamDoc.title,exact:true}).waitFor();
   await proof('team-documents',width);
   await go('/app/search');
   await page.getByLabel('Search workspace',{exact:true}).fill(title);
   await page.getByRole('link',{name:title,exact:true}).waitFor();
   await proof('document-search',width);
   console.log('[PROJ-013] '+width+': UI project creation, two editor revisions, ordered history, issue specification, initiative/team lists, search, overflow, serious/critical axe and hydration PASS');
  }
  await documentReferenceAccessJourney({page,base,api,output,runtime,proof});
 }finally{page.off('pageerror',pageError);page.off('console',consoleError);}
}


async function documentReferenceAccessJourney({page,base,api,output,runtime}){
 const suffix=String(Date.now()),publicTeam=(await api('/settings/administration')).teams.find(t=>!t.isPrivate&&!t.archivedAt);
 const privateTeam=(await api('/settings/teams','POST',{name:'synthetic-vector-document-reference-'+suffix,identifierPrefix:'DR'+suffix.slice(-5).replaceAll(/\d/g,d=>String.fromCharCode(65+Number(d))),isPrivate:true})).teams.find(t=>t.name==='synthetic-vector-document-reference-'+suffix);
 const target=await api('/issues','POST',{teamId:publicTeam.id,title:'synthetic-vector-visible-reference-'+suffix});
 // A second private team keeps the target invisible after source access is granted.
 const hiddenTeam=(await api('/settings/teams','POST',{name:'synthetic-vector-hidden-target-'+suffix,identifierPrefix:'DH'+suffix.slice(-5).replaceAll(/\d/g,d=>String.fromCharCode(65+Number(d))),isPrivate:true})).teams.find(t=>t.name==='synthetic-vector-hidden-target-'+suffix);
 const privateTarget=await api('/issues','POST',{teamId:hiddenTeam.id,title:'synthetic-vector-unavailable-title-'+suffix});
 let doc=await api('/documents','POST',{parentKind:'team',parentId:privateTeam.id,title:'synthetic-vector-reference-document-'+suffix,body:'See '+target.identifier+' and '+privateTarget.identifier+'; unknown SYNTHETIC_VECTOR-999999.'});
 const reader=await inviteReader({owner:page,browser:page.context().browser(),runtime,email:['synthetic-vector-document-reader-'+suffix,'vector.test'].join('@'),name:'synthetic-vector-document-reader',role:'member'});
 const go=async path=>{await beforePrivateNavigation(reader.page,base+path);await reader.page.goto(base+path);};
 const targetHistory=async()=>{await go('/app/issues/'+target.identifier);await reader.page.getByRole('heading',{name:target.title,exact:true}).waitFor();await reader.page.getByText('History',{exact:true}).click();};
 const backlink=()=>reader.page.getByRole('link',{name:'Mentioned in '+doc.title,exact:true});
 const inspect=roleScreens(output);
 try{
  for(const role of ['member','viewer']){
   await reader.page.setViewportSize({width:1440,height:1000});
   if(role==='viewer')await api('/settings/operators/'+reader.id+'/role','PATCH',{role:'viewer',teamIds:[]});
   await targetHistory();assert.equal(await backlink().count(),0);
   assert.ok(!JSON.stringify(await reader.api('/issues/'+target.identifier)).includes(doc.id));
   await reader.api('/documents/'+doc.id,'GET',undefined,404);
   await api('/settings/teams/'+privateTeam.id+'/members/'+reader.id,'PUT',{role:'member'});
   await go('/app/documents/'+doc.id);await reader.page.getByRole('heading',{name:doc.title,exact:true}).waitFor();
   const content=reader.page.getByRole('region',{name:'Document content',exact:true}),link=content.getByRole('link',{name:target.identifier,exact:true});
   await link.waitFor();await link.focus();assert.equal(await reader.page.getByRole('tooltip').filter({hasText:target.title}).isVisible(),true);
   assert.ok((await reader.page.getByRole('tooltip').innerText()).includes(target.status.name));
   assert.equal(await content.getByRole('link',{name:privateTarget.identifier,exact:true}).count(),0);
   assert.equal(await content.getByRole('link',{name:'SYNTHETIC_VECTOR-999999',exact:true}).count(),0);
   const projection=await reader.api('/documents/'+doc.id);assert.deepEqual(projection.references.map(r=>r.identifier),[target.identifier]);
   assert.ok(!JSON.stringify(projection.references).includes(privateTarget.title));
   await inspect(reader.page,content,'document-reference-'+role);
   await reader.page.setViewportSize({width:1440,height:1000});
   await targetHistory();await backlink().waitFor();assert.equal(await backlink().count(),1);
   await backlink().click();await reader.page.getByRole('heading',{name:doc.title,exact:true}).waitFor();
   if(role==='viewer'){
    const before=await api('/documents/'+doc.id);
    const refused=await readerResponse(reader.page,base,'/documents/'+doc.id,'PATCH',{expectedVersion:before.version,body:'synthetic-vector-refused'});assert.equal(refused.status,403);
    assert.deepEqual(await api('/documents/'+doc.id),before);
   }
   doc=await api('/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body:'Still see '+target.identifier+' and '+privateTarget.identifier});
   doc=await api('/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body:'Reference removed.'});
   await targetHistory();await backlink().waitFor();assert.equal(await backlink().count(),1);
   await reader.page.getByText('· reference removed',{exact:false}).waitFor();
   const retained=(await reader.api('/issues/'+target.identifier)).activity.filter(row=>row.nextValue?.sourceDocumentId===doc.id);assert.equal(retained.length,1);assert.equal(retained[0].nextValue.removed,true);
   await inspect(reader.page,reader.page.locator('.issue-history'),'document-backlink-removed-'+role);
   await reader.page.setViewportSize({width:1440,height:1000});
   doc=await api('/documents/'+doc.id,'PATCH',{expectedVersion:doc.version,body:'Again '+target.identifier+' and '+privateTarget.identifier});
   await api('/settings/teams/'+privateTeam.id+'/members/'+reader.id,'DELETE');
   await backlink().waitFor({state:'hidden'});
   assert.ok(!JSON.stringify(await reader.api('/issues/'+target.identifier)).includes(doc.id));
   await reader.api('/documents/'+doc.id,'GET',undefined,404);
   await reader.api('/documents/'+doc.id+'/revisions','GET',undefined,404);
   await inspect(reader.page,reader.page.locator('.issue-history'),'document-backlink-withdrawn-'+role);
  }
  assert.deepEqual(reader.errors,[]);
  console.log('ISSUE-027 document links, visible metadata, one retained backlink, removal and current Member and Viewer withdrawal PASS');
 }finally{await reader.context.close();}
}
