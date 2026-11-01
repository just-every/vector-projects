import {confirmInviter} from './core-operator-journey.mjs';
import assert from 'node:assert/strict';
import {navigate} from './collaboration-navigation.mjs';

// Use the browser's own connection pool and same-origin credentials, as the UI does.
export function readerResponse(page,base,path,method='GET',data){
 return page.evaluate(async({url,method,data})=>{const response=await fetch(url,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});return {status:response.status,text:await response.text()};},{url:base+'/api'+path,method,data});
}
export function readerApi(page,base){return async(path,method='GET',data,status=200)=>{
 const response=await readerResponse(page,base,path,method,data);
 assert.equal(response.status,status,method+' '+path+' '+response.text);return response.text?JSON.parse(response.text):undefined;
};}
/** Native invitation, with no credentials retained in browser proof. */
export async function inviteReader({owner,browser,runtime,email,name,role='viewer',teams=[],form=false,beforeSend,width=1440,beforeConfirm}){
 const {base,sql}=runtime;
 await confirmInviter(owner,owner.context(),base,runtime.state);
 if(form){
  await navigate(owner,base+'/app/settings/people');await owner.getByRole('button',{name:'Invite',exact:true}).click();
  const invite=owner.getByRole('form',{name:'Invite someone',exact:true});
  await invite.getByLabel('Name',{exact:true}).fill(name);await invite.getByLabel('Email',{exact:true}).fill(email);await invite.getByLabel('Role',{exact:true}).selectOption(role);
  if(teams.length){const group=invite.getByRole('group',{name:`Teams this ${role==='viewer'?'Viewer':'Guest'} can access`,exact:true});for(const id of teams)await group.locator(`input[value="${id}"]`).check();}
  await beforeSend?.(invite);
  const sent=owner.waitForResponse(r=>new URL(r.url()).pathname==='/api/settings/operators/invite'&&r.request().method()==='POST');
  await invite.getByRole('button',{name:'Send invitation',exact:true}).click();
  await owner.getByRole('button',{name:'Confirm and send',exact:true}).click();assert.equal((await sent).status(),202);
 }else await readerApi(owner,base)('/settings/operators/invite','POST',{email,displayName:name,role,teamIds:teams},202);
 const link=sql("SELECT json_extract(message,'$.text') text FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='"+email+"' ORDER BY created_at DESC,sequence DESC LIMIT 1")[0].text.match(/https?:\/\/[^\s]+/)[0];
 const context=await browser.newContext({viewport:{width,height:width===390?844:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{await page.goto(link);await beforeConfirm?.(page);await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.waitForURL(base+'/app');}
 catch(error){await context.close();throw error;}
 const id=sql("SELECT id FROM operators WHERE email='"+email+"'")[0].id;
 return {context,page,id,errors,api:readerApi(page,base)};
}
