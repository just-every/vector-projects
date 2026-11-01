import assert from 'node:assert/strict';
import {inviteReader} from './role-reader-support.mjs';
import {roleScreens} from './role-ui-support.mjs';
import {beforePrivateNavigation} from './collaboration-navigation.mjs';

/** The existing editor creates native mentions and Inbox opens their exact
 * document. Assertions run at desktop width; captures inspect both layouts. */
export async function documentMentionsJourney({page,base,api,output,runtime}) {
 const suffix=String(Date.now()),inspect=roleScreens(output),browser=page.context().browser();
 const first=await inviteReader({owner:page,browser,runtime,email:['synthetic-vector-mention-'+suffix,'vector.test'].join('@'),name:'synthetic-vector-mentioned-member',role:'member'});
 let second;
 const go=async(target,path)=>{await beforePrivateNavigation(target,base+path);await target.goto(base+path);};
 const capture=async(target,region,name)=>{await inspect(target,region,name);await target.setViewportSize({width:1440,height:1000});};
 try {
  second=await inviteReader({owner:page,browser,runtime,email:['synthetic-vector-revision-'+suffix,'vector.test'].join('@'),name:'synthetic-vector-revision-member',role:'member'});
  await page.setViewportSize({width:1440,height:1000});
  const {operatorId}=await api('/session'),team=(await api('/settings/administration')).teams.find(t=>!t.isPrivate&&!t.archivedAt);
  const project=(await api('/settings/projects','POST',{name:'synthetic-vector-mention-project-'+suffix,leadOperatorId:operatorId})).projects.find(p=>p.name==='synthetic-vector-mention-project-'+suffix);
  await api('/issues','POST',{title:'synthetic-vector-mention-parent-'+suffix,teamId:team.id,projectId:project.id});
  await go(page,'/app/projects/'+project.id);
  const section=page.getByRole('region',{name:'Documents',exact:true});
  await section.locator('summary').filter({hasText:'New document'}).click();
  const draft=section.getByRole('form',{name:'Document draft'}),title='synthetic-vector-mentioned-spec-'+suffix;
  await draft.getByLabel('Document title',{exact:true}).fill(title);
  const body=draft.getByLabel('Document body',{exact:true});
  await body.fill('Review with @synthetic-vector-mentioned');
  await draft.getByRole('option',{name:'synthetic-vector-mentioned-member',exact:true}).waitFor();
  await body.press('ArrowDown');await body.press('Enter');
  assert.ok((await body.getAttribute('data-canonical-body')).includes(first.id));
  await body.press('End');await body.pressSequentially(' and @unknown-person');await body.press('Escape');
  const bold=draft.getByRole('button',{name:'Bold text',exact:true});await bold.focus();
  await page.getByRole('tooltip',{name:'Bold text',exact:true}).waitFor();
  await body.focus();await bold.hover();await page.getByRole('tooltip',{name:'Bold text',exact:true}).waitFor();
  await body.hover();
  await capture(page,draft,'document-mention-editor');
  await draft.getByRole('button',{name:'Create document',exact:true}).click();
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
  const documentId=new URL(page.url()).pathname.split('/').at(-1),path='/documents/'+documentId;
  const content=page.getByRole('region',{name:'Document content',exact:true});
  await content.locator('.mention-chip').filter({hasText:'@synthetic-vector-mentioned-member'}).waitFor();
  assert.ok((await content.innerText()).includes('@unknown-person'));
  let doc=await api(path);assert.ok(doc.body.includes(first.id));
  const inbox=async(reader)=>(await reader.api('/notifications?limit=50')).items.filter(item=>item.documentId===documentId);
  assert.equal((await inbox(first)).length,1);
  assert.equal((await api('/notifications?limit=50')).items.filter(item=>item.documentId===documentId).length,0);
  await go(first.page,'/app/inbox');
  const row=first.page.getByRole('button').filter({has:first.page.locator('.inbox-title').filter({hasText:title})});
  await row.waitFor();assert.equal(await row.count(),1);
  await capture(first.page,first.page.locator('main.inbox-page'),'document-mention-inbox');
  await row.focus();await row.press('Enter');
  await first.page.waitForURL(base+'/app/documents/'+documentId);
  await first.page.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.notEqual((await inbox(first))[0].readAt,null);
  await capture(first.page,first.page.locator('main.document-page'),'document-mention-destination');
  // The revision editor keeps the first token while choosing a new member.
  await page.getByText('Edit document',{exact:true}).click();
  let editor=page.getByRole('form',{name:'Edit document',exact:true}),field=editor.getByLabel('Document body',{exact:true});
  await field.focus();await field.press('ControlOrMeta+End');await field.pressSequentially(' @synthetic-vector-revision');
  await editor.getByRole('option',{name:'synthetic-vector-revision-member',exact:true}).waitFor();
  await field.press('Enter');
  assert.ok((await field.getAttribute('data-canonical-body')).includes(second.id));
  let published=page.waitForResponse(r=>new URL(r.url()).pathname==='/api'+path&&r.request().method()==='PATCH');
  await editor.getByRole('button',{name:'Publish revision',exact:true}).click();assert.equal((await published).status(),200);
  await content.locator('.mention-chip').filter({hasText:'@synthetic-vector-revision-member'}).waitFor();
  doc=await api(path);assert.equal((await inbox(first)).length,1);assert.equal((await inbox(second)).length,1);
  await api(path,'PATCH',{expectedVersion:doc.version,body:doc.body});
  assert.equal((await inbox(first)).length,1);assert.equal((await inbox(second)).length,1);
  await page.reload();await page.getByRole('heading',{name:title,exact:true}).waitFor();
  const edit=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Edit document'})});
  if(await edit.getAttribute('open')===null)await edit.locator('summary').click();
  editor=edit.getByRole('form',{name:'Edit document',exact:true});
  await editor.getByLabel('Document body',{exact:true}).fill('Mentions removed; @unknown-person stays literal.');
  published=page.waitForResponse(r=>new URL(r.url()).pathname==='/api'+path&&r.request().method()==='PATCH');
  await editor.getByRole('button',{name:'Publish revision',exact:true}).click();assert.equal((await published).status(),200);
  await content.getByText('Mentions removed; @unknown-person stays literal.',{exact:true}).waitFor();
  assert.equal((await inbox(first)).length,1);assert.equal((await inbox(second)).length,1);
  await go(second.page,'/app/inbox');
  const nextRow=second.page.getByRole('button').filter({has:second.page.locator('.inbox-title').filter({hasText:title})});
  await nextRow.focus();await nextRow.press('Enter');await second.page.waitForURL(base+'/app/documents/'+documentId);
  await second.page.getByRole('region',{name:'Document content',exact:true}).getByText('Mentions removed; @unknown-person stays literal.',{exact:true}).waitFor();
  await capture(second.page,second.page.locator('main.document-page'),'document-mention-retained-history');
  assert.deepEqual(first.errors,[]);assert.deepEqual(second.errors,[]);
  console.log('PROBE PROJ-013 document editor: keyboard member selection, create, revise and remove -> retained tokens, new-recipient-only Inbox, exact document navigation and retained history; 1440 and 390 overflow and accessibility PASS');
 } finally {await first.context.close();await second?.context.close();}
}
