import assert from 'node:assert/strict';

/** Matrix controls exercised by the existing Slack settings journey at both viewport widths. */
export async function exerciseNotificationChannelControls({page,region,send,answered,shot,axe}) {
 const panel=region.locator('.notification-channels');
 const matrix=()=>panel.getByRole('table',{name:'Your notification channels',exact:true});
 const email=()=>matrix().getByRole('combobox',{name:'Email for Followed comments',exact:true});
 const reset=()=>matrix().getByRole('button',{name:'Use workspace default for Followed comments',exact:true});
 const original=await send('/settings/notifications/channels','GET');
 const originalChoice=original.channels.find(row=>row.kind==='comment');
 const originalDefault=original.defaults.find(row=>row.kind==='comment');
 assert.ok(originalChoice&&originalDefault);
 const saved=()=>panel.getByRole('status').filter({hasText:'Notification channels saved.'}).waitFor();
 const defaultsSaved=()=>panel.getByRole('status').filter({hasText:'Workspace defaults saved.'}).waitFor();
 const select=async(control,value,defaults=false)=>{
  if(await control.inputValue()===value)return;
  await answered(defaults?'/settings/notifications/channel-defaults':'/settings/notifications/channels','PUT',()=>control.selectOption(value));
  await(defaults?defaultsSaved():saved());
 };
 await email().waitFor();
 // Email off never removes Inbox, and a personal choice survives a page reload.
 await select(email(),'off');
 const commentRow=matrix().getByRole('row').filter({has:page.getByRole('rowheader',{name:'Followed comments',exact:true})});
 assert.equal(await commentRow.getByText('Always',{exact:true}).isVisible(),true);
 await select(email(),'hourly');
 await reset().waitFor();
 assert.equal((await send('/settings/notifications/channels','GET')).channels.find(row=>row.kind==='comment').inherited,false);
 await page.reload();await email().waitFor();assert.equal(await email().inputValue(),'hourly');
 await shot('channel-custom-hourly',email());await axe('.notifications-panel');
 // Only inherited rows follow a workspace default change; Reset rejoins that default.
 await panel.getByRole('button',{name:'Manage workspace defaults',exact:true}).click();
 const defaultMatrix=panel.getByRole('table',{name:'Workspace default notification channels',exact:true});
 const defaultEmail=defaultMatrix.getByRole('combobox',{name:'Default email for Followed comments',exact:true});
 const firstDefault=originalDefault.emailMode==='daily'?'off':'daily';
 await select(defaultEmail,firstDefault,true);
 assert.equal(await email().inputValue(),'hourly','custom choice survives changed defaults');
 await shot('workspace-channel-defaults',defaultEmail);await axe('.notifications-panel');
 await answered('/settings/notifications/channels','PUT',()=>reset().click());await saved();
 assert.equal(await email().inputValue(),firstDefault);
 assert.equal(await reset().count(),0);
 const inherited=(await send('/settings/notifications/channels','GET')).channels.find(row=>row.kind==='comment');
 assert.equal(inherited.inherited,true);assert.equal(inherited.emailMode,firstDefault);
 const secondDefault=firstDefault==='off'?'immediate':'off';
 await select(defaultEmail,secondDefault,true);
 assert.equal(await email().inputValue(),secondDefault,'inherited row follows updated defaults');
 await shot('channel-inherited-reset',email());
 await select(defaultEmail,originalDefault.emailMode,true);
 await panel.getByRole('button',{name:'Hide workspace defaults',exact:true}).click();
 await send('/settings/notifications/channels','PUT',{channels:[originalChoice.inherited?{kind:'comment',inherit:true}:{kind:'comment',emailMode:originalChoice.emailMode,slack:originalChoice.slack}]});
 // The existing opt-out remains usable alongside the per-event choices.
 const settings=await send('/settings/notifications','GET');
 const allowEmail=region.getByRole('checkbox',{name:'Allow email notifications',exact:true});
 assert.equal(await allowEmail.isDisabled(),!settings.emailAvailable);
 if(settings.emailAvailable){
  assert.equal(await allowEmail.isChecked(),settings.emailEnabled);
  await allowEmail.evaluate(element=>element.scrollIntoView({block:'center'}));
  await answered('/settings/notifications','PATCH',()=>allowEmail.click());
  await region.getByRole('status').filter({hasText:'Notification preferences saved.'}).waitFor();
  assert.equal(await allowEmail.isChecked(),!settings.emailEnabled);
  assert.equal((await send('/settings/notifications','GET')).emailEnabled,!settings.emailEnabled);
  await allowEmail.evaluate(element=>element.scrollIntoView({block:'center'}));
  await answered('/settings/notifications','PATCH',()=>allowEmail.click());
  await region.getByRole('status').filter({hasText:'Notification preferences saved.'}).waitFor();
  assert.equal(await allowEmail.isChecked(),settings.emailEnabled);
  assert.equal((await send('/settings/notifications','GET')).emailEnabled,settings.emailEnabled);
 }
 await page.reload();await email().waitFor();
 console.log('notification-channel-controls.mjs exerciseNotificationChannelControls passed at '+page.viewportSize().width);
}

export async function inspectMemberNotificationChannels({page,runtime,teammateCookie,width,shot,axe}) {
 const context=await page.context().browser().newContext({storageState:await page.context().storageState(),viewport:{width,height:900}});
 try {
  const separator=teammateCookie.indexOf('=');
  await context.addCookies([{name:teammateCookie.slice(0,separator),value:teammateCookie.slice(separator+1),url:runtime.base}]);
  const member=await context.newPage();await member.goto(runtime.base+'/app/settings/notifications');
  const panel=member.locator('.notification-channels');
  await panel.getByRole('table',{name:'Your notification channels',exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'Manage workspace defaults',exact:true}).count(),0,'Member cannot manage workspace defaults');
  const response=await member.request.get(runtime.base+'/api/settings/notifications/channels');
  assert.equal(response.status(),200);assert.equal((await response.json()).canManageDefaults,false);
  const denied=await member.request.put(runtime.base+'/api/settings/notifications/channel-defaults',{headers:{Origin:runtime.base},data:{channels:[{kind:'comment',emailMode:'daily',slack:false}]}});
  assert.equal(denied.status(),403);
  await shot('member-channel-preferences',panel.getByRole('combobox',{name:'Email for Followed comments',exact:true}));
  await axe('.notifications-panel',member);
  console.log('notification-channel-controls.mjs inspectMemberNotificationChannels passed at '+width);
 } finally {await context.close();}
}
