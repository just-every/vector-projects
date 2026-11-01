import { withOperatorClient } from './operator-request.mjs';
import assert from 'node:assert/strict';
import {readDevelopmentLink} from './outbox-session.mjs';
import {beforePrivateNavigation,navigate,settleReads} from './collaboration-navigation.mjs';
import {invitePerson} from './settings-pane-support.mjs';

// A long journey can outlive the inviter's app-local email proof. Renew it
// through the same public confirmation door before the next privileged action.
const confirmedProofs = new Map();
export async function confirmInviter(page,context,base,state) {
 const session=await withOperatorClient(context,async client=>{const response=await client.get(base+'/auth/session');assert.equal(response.status(),200);return await response.json()});
 const confirmedAt=confirmedProofs.get(session.id)??session.createdAt;
 if(Date.now()-confirmedAt<5*60_000)return;
 await withOperatorClient(context,async client=>{const requested=await client.post(base+'/api/settings/operators/confirm-identity',{headers:{Origin:base},data:{}});assert.equal(requested.status(),202);await requested.json()});
 const link=await readDevelopmentLink(base,context.request,session.operator.email,state);
 await navigate(page,link);await page.getByRole('button',{name:'Confirm',exact:true}).click();
 await page.waitForURL(base+'/app/settings/people');
 const renewed=await withOperatorClient(context,async client=>{const response=await client.get(base+'/auth/session');assert.equal(response.status(),200);return await response.json()});
 assert.equal(renewed.id,session.id,'confirmation preserves the inviter session');
 confirmedProofs.set(session.id,Date.now());
}

/** Independent jobs use genuine invited operators and their own rate budgets.
 * They predate roles and act as their inviter could, so each is invited as an Owner. */
export async function withInvitedOperator(page,context,base,state,journey,displayName='Stream planning teammate'){
 await confirmInviter(page,context,base,state);
 const original=await context.cookies(),email=`stream-planning-${Date.now()}@vector.test`;
 await navigate(page,base+'/app/settings/people');
 const response=await invitePerson(page,{name:displayName,email,role:'owner'});
 assert.equal(response.status(),202);assert.equal(await response.finished(),null);
 const link=await readDevelopmentLink(base,context.request,email,state);
 await beforePrivateNavigation(page,link);await page.goto(link);await page.waitForLoadState('networkidle');
 const confirmed=page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/confirm'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Confirm',exact:true}).click();assert.equal((await confirmed).status(),303,'invitation confirmation succeeds within the native proof budget');
 await page.waitForURL(base+'/app');await settleReads(page);
 let journeyError;
 try{await journey()}catch(error){journeyError=error;throw error}finally{
  try{
   try{
    await beforePrivateNavigation(page,base+'/');await page.goto(base+'/');await page.waitForLoadState('networkidle');
   }finally{
    await context.clearCookies();await context.addCookies(original);
   }
  }catch(error){
   if(!journeyError)throw error;
   console.error('[Invited operator cleanup failed after journey error]',error);
  }
 }
}
