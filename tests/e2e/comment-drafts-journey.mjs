import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { beforePrivateNavigation } from './collaboration-navigation.mjs';
const until = async (read,accept,message) => {
  for (let attempt=0;attempt<100;attempt++) {
    const result=await read(); if (accept(result)) return result;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(message);
};

// Reached by the account draft journey in the normal planning runtime.
export async function commentDraftJourney(page,context,second,other,base,issue,evidence,record,expectedConflicts) {
  const get = async client => {
    const response=await client.get(base+'/api/comment-drafts');assert.equal(response.status(),200);
    return (await response.json()).drafts;
  };
  const visit = async (client,target) => {await beforePrivateNavigation(client,target);await client.goto(target);};
  const target=base+'/app/issues/'+issue.identifier, text='synthetic-vector-2870-'+Date.now();
  await visit(page,target);
  await page.getByRole('textbox',{name:'Add a comment',exact:true,disabled:false}).fill(text);
  const draft=(await until(()=>get(context.request),rows=>rows.some(row=>row.body===text),'Typed comment reaches account')).find(row=>row.body===text);
  await visit(second,base+'/app/new-issue#drafts');
  const list=second.getByRole('region',{name:'Comment drafts',exact:true});
  await list.getByRole('button',{name:'Open comment draft '+issue.identifier,exact:true}).waitFor();
  assert.ok((await list.innerText()).includes(draft.team));
  assert.ok(await list.locator('time').getAttribute('datetime'));
  for(const width of [1440,390]) {
    await second.setViewportSize({width,height:1000});
    await second.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await second.screenshot({path:evidence+'/comment-draft-list-'+width+'.png',fullPage:true});
  }
  await second.setViewportSize({width:1440,height:1000});
  await list.getByRole('button',{name:'Open comment draft '+issue.identifier,exact:true}).focus();
  await second.keyboard.press('Enter'); await second.waitForURL(target+'#comment-draft');
  await until(()=>second.getByRole('textbox',{name:'Add a comment',exact:true}).inputValue(),value=>value===text,'Independent browser recovers comment body');
  await visit(second,second.url());
  await until(()=>second.getByRole('textbox',{name:'Add a comment',exact:true}).inputValue(),value=>value===text,'Reload retains comment body');
  const newer=text+'-newer';
  await second.getByRole('textbox',{name:'Add a comment',exact:true,disabled:false}).fill(newer);
  await until(()=>get(other.request),rows=>rows.some(row=>row.body===newer),'Newer comment save commits');
  await until(()=>page.getByRole('textbox',{name:'Add a comment',exact:true}).inputValue(),value=>value===newer,'Other browser shows newer comment before saving');
  const navigating=newer+'-navigation';
  await page.getByRole('textbox',{name:'Add a comment',exact:true}).fill(navigating);
  await page.getByRole('link',{name:'Drafts',exact:true}).click();
  await page.waitForURL(base+'/app/new-issue#drafts');
  await until(()=>get(context.request),rows=>rows.some(row=>row.body===navigating),'Leaving the composer flushes its typed text');
  await until(()=>second.getByRole('textbox',{name:'Add a comment',exact:true}).inputValue(),value=>value===navigating,'Other browser receives text saved during navigation');
  await page.getByRole('region',{name:'Comment drafts',exact:true}).getByRole('button',{name:'Open comment draft '+issue.identifier,exact:true}).click();
  await until(()=>page.getByRole('textbox',{name:'Add a comment',exact:true}).inputValue(),value=>value===navigating,'Reopening after navigation retains the unsent comment');
  // Keep the subsequent competing-save proof on this exact latest body.
  await second.getByRole('textbox',{name:'Add a comment',exact:true}).fill(newer);
  await until(()=>get(other.request),rows=>rows.some(row=>row.body===newer),'The next intentional edit reaches the account');
  await until(()=>page.getByRole('textbox',{name:'Add a comment',exact:true}).inputValue(),value=>value===newer,'The reopened browser shows the latest text');
  for (const width of [1440,390]) {
    await second.setViewportSize({width,height:1000});
    await second.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await second.screenshot({path:evidence+'/comment-drafts-'+width+'.png',fullPage:true});
  }
  await second.setViewportSize({width:1440,height:1000});
  const axeSource=await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');
  await second.evaluate(source=>{const script=document.createElement('script');script.nonce=document.querySelector('script[nonce]')?.nonce??'';script.textContent=source;document.head.append(script);},axeSource);
  const violations=await second.evaluate(async()=> (await window.axe.run()).violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id));
  assert.deepEqual(violations,[]);
  // A native save arriving after submission must not recreate the comment draft.
  let release,entered;
  const arrived=new Promise(resolve=>{entered=resolve;}),pause=new Promise(resolve=>{release=resolve;});
  const url=base+'/api/comment-drafts/'+draft.id;
  const intercept=async route=>{
    if(route.request().method()!=='PATCH')return route.fallback();
    entered();await pause;await route.continue();
  };
  expectedConflicts.add(url);await page.route(url,intercept);
  try {
    await page.getByRole('textbox',{name:'Add a comment',exact:true}).fill(text+'-delayed');
    await Promise.race([arrived,new Promise((_,reject)=>setTimeout(()=>reject(Error('Comment autosave did not reach native door')),10000))]);
    const posted=second.waitForResponse(response=>response.url()===base+'/api/issues/'+issue.identifier+'/comments'&&response.request().method()==='POST');
    await second.getByRole('button',{name:'Add comment',exact:true}).click();
    const response=await posted;assert.equal(response.status(),201);const root=(await response.json()).id;
    await second.locator('.comment-body').filter({hasText:newer}).waitFor();
    const refusal=page.waitForResponse(response=>response.url()===url&&response.status()===409);
    release();await refusal;
    await until(()=>page.getByRole('textbox',{name:'Add a comment',exact:true}).inputValue(),value=>value==='','Delayed save clears consumed composer');
    assert.deepEqual(await get(other.request),[]);
    await visit(page,base+'/app/new-issue#drafts');
    await page.getByText('No open comment drafts.',{exact:true}).waitFor();
    // Replies use the same private custody but retain their exact thread target.
    const thread=second.getByRole('region',{name:/^Thread started by/}).filter({has:second.locator('.comment-body').filter({hasText:newer})});
    await thread.getByRole('button',{name:'Reply',exact:true}).click();
    const reply=text+'-reply';await thread.getByRole('textbox',{name:'Reply to thread',exact:true,disabled:false}).fill(reply);
    await until(()=>get(other.request),rows=>rows.some(row=>row.body===reply&&row.parentId===root),'Reply draft retains thread identity');
    await page.getByRole('region',{name:'Comment drafts',exact:true}).getByRole('button',{name:'Open comment draft '+issue.identifier,exact:true}).click();
    await page.getByRole('textbox',{name:'Reply to thread',exact:true,disabled:false}).waitFor();
    await until(()=>page.getByRole('textbox',{name:'Reply to thread',exact:true}).inputValue(),value=>value===reply,'Drafts opens the reply composer');
    await page.getByRole('button',{name:'Discard comment draft',exact:true}).click();
    await until(()=>get(context.request),rows=>rows.length===0,'Discard removes the reply draft');
    await until(()=>second.getByRole('textbox',{name:'Reply to thread',exact:true}).inputValue(),value=>value==='','Discard clears the second reply composer');
    // Posting a recovered reply consumes its account draft and retains the thread.
    await page.getByRole('textbox',{name:'Reply to thread',exact:true}).fill(reply+'-posted');
    await until(()=>get(context.request),rows=>rows.some(row=>row.body===reply+'-posted'),'Next reply autosaves');
    await until(()=>second.getByRole('textbox',{name:'Reply to thread',exact:true}).inputValue(),value=>value===reply+'-posted','Other reply composer receives newest text');
    const replyPosted=page.waitForResponse(response=>response.url()===base+'/api/issues/'+issue.identifier+'/comments'&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Post reply',exact:true}).click();assert.equal((await replyPosted).status(),201);
    const discussion=await (await context.request.get(base+'/api/issues/'+issue.identifier+'/discussion')).json();
    assert.ok(discussion.comments.some(row=>row.body===reply+'-posted'&&row.parentId===root));
    await until(()=>get(context.request),rows=>rows.length===0,'Posted reply disappears from Drafts');
    // A quoted description comment keeps its exact selection in the author's account.
    const quoteSource='synthetic-vector-2879 quoted account words', current=await (await context.request.get(base+'/api/issues/'+issue.identifier)).json();
    assert.equal((await context.request.patch(base+'/api/issues/'+issue.identifier,{headers:{Origin:base},data:{expectedVersion:current.version,description:quoteSource}})).status(),200);
    await visit(page,target);
    await page.locator('.issue-description [data-description-start]').filter({hasText:quoteSource}).first().evaluate(element=>{
      const range=document.createRange();range.selectNodeContents(element);
      const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);
    });
    await page.getByRole('button',{name:'Comment on selection',exact:true}).click();
    const quoted=text+'-quoted';
    await page.getByRole('textbox',{name:'Comment on quoted text',exact:true,disabled:false}).fill(quoted);
    await until(()=>get(context.request),rows=>rows.some(row=>row.body===quoted&&row.anchor?.quote===quoteSource),'Quoted comment draft keeps its selection');
    await visit(second,target);
    await second.getByRole('textbox',{name:'Comment on quoted text',exact:true,disabled:false}).waitFor();
    await until(()=>second.getByRole('textbox',{name:'Comment on quoted text',exact:true}).inputValue(),value=>value===quoted,'Independent browser reopens the quoted composer');
    assert.equal(await second.locator('#quote-draft blockquote').innerText(),quoteSource);
    const threadPosted=second.waitForResponse(response=>response.url()===base+'/api/issues/'+issue.identifier+'/comments'&&response.request().method()==='POST');
    await second.getByRole('button',{name:'Start thread',exact:true}).click();assert.equal((await threadPosted).status(),201);
    await page.locator('#quote-draft').waitFor({state:'detached'});
    assert.deepEqual(await get(context.request),[]);
    const anchored=(await (await context.request.get(base+'/api/issues/'+issue.identifier+'/discussion')).json()).comments.find(row=>row.body===quoted);
    assert.equal(anchored.anchor.quote,quoteSource);
    record('ISSUE-028','Comment, reply and quoted description comment account autosave, independent-browser recovery, Drafts navigation and team and edit time, newer text, delayed-save refusal after atomic posting, and cross-browser discard; existing composers remain keyboard accessible without overflow at both widths.');
  } finally {
    release();await page.unroute(url,intercept);expectedConflicts.delete(url);
  }
}
