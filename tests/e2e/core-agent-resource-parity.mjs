import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {inviteReader} from './role-reader-support.mjs';
import {withOperatorClient,publicRequest} from './operator-request.mjs';
import {navigate,settleReads,trackRequests} from './collaboration-navigation.mjs';
import {roleScreens} from './role-ui-support.mjs';

/** The native issue screen and MCP share a projection, under each caller's own grant. */
export async function agentResourceParityJourney({page,context,base,state,sql,evidence,record}) {
  const marker='synthetic-vector-'+Date.now();
  const owner=async(path,method='GET',data,status=200)=>withOperatorClient(context,async client=>{
    const response=await client.fetch(base+'/api'+path,{method,headers:{Origin:base},...(data===undefined?{}:{data})});
    assert.equal(response.status(),status,method+' '+path+' '+await response.text());
    return response.json();
  });
  const member=await inviteReader({owner:page,browser:context.browser(),runtime:{base,state,sql},
    name:marker+'-member',email:[marker,'vector.test'].join(String.fromCharCode(64)),role:'member'});
  const errors=[],consoleErrors=[],externalRequests=[],expectedDenials=new Set();
  trackRequests(member.page);
  member.page.on('console',message=>{if(message.type()==='error'&&!(expectedDenials.has(message.location().url)&&/^Failed to load resource: the server responded with a status of 404(?: \([^)]*\))?$/.test(message.text())))consoleErrors.push(message.text());});
  member.page.on('requestfailed',request=>errors.push(request.failure()?.errorText));
  await member.context.route('**/*',async route=>{
    if(new URL(route.request().url()).origin===base)await route.continue();
    else {externalRequests.push(new URL(route.request().url()).origin);await route.abort();}
  });
  const inspect=roleScreens(evidence);
  let id=0;
  const raw=async(current,path,method,data)=>withOperatorClient(current,async client=>{
    const response=await client.fetch(base+path,{method,headers:{Origin:base},data});
    assert.equal(response.status(),200,await response.text());return response.json();
  });
  const mint=async(api)=>{
    const {token}=await api('/settings/integrations/tokens','POST',{name:marker,scopes:['evidence:read']},201);
    return async uri=>{
      // The resource caller has only its grant; native session cookies cannot admit it.
      const response=await publicRequest(base+'/mcp',{method:'POST',headers:{Origin:base,Authorization:'Bearer '+token,
        'Content-Type':'application/json',
        Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25','Mcp-Method':'resources/read'},
        data:{jsonrpc:'2.0',id:++id,method:'resources/read',params:{uri}}});
      return {status:response.status,body:await response.json()};
    };
  };
  try {
    const ownerSession=await owner('/session'),memberSession=await member.api('/session');
    assert.equal(ownerSession.role,'owner');assert.equal(memberSession.role,'member');
    assert.notEqual(ownerSession.operatorId,memberSession.operatorId);
    const options=await owner('/options');
    const ownerName=options.operators.find(person=>person.id===ownerSession.operatorId).name;
    const memberName=options.operators.find(person=>person.id===memberSession.operatorId).name;
    const ownerAuth=await raw(context,'/auth/session','GET');
    const memberAuth=await raw(member.context,'/auth/session','GET');
    assert.notEqual(ownerAuth.id,memberAuth.id,'The callers have independent native sessions');
    const prefix='RES'+String(Date.now()).slice(-6).replaceAll(/\d/g,d=>String.fromCharCode(65+Number(d)));
    const team=(await owner('/settings/teams','POST',{name:marker+'-team',identifierPrefix:prefix,isPrivate:true})).teams.find(t=>t.name===marker+'-team');
    await owner(`/settings/teams/${team.id}/members/${member.id}`,'PUT',{role:'member'});
    const issue=await owner('/intake','POST',{title:marker+'-issue',teamId:team.id,
      description:marker+'-description',summary:marker+'-evidence',measurements:{delay:0,confirmed:true},
      customerReports:[{customer:marker+'-customer',summary:marker+'-report',link:null}]},201);
    const path='/issues/'+issue.identifier;
    const root=await owner(path+'/comments','POST',{body:marker+'-owner-comment'},201);
    const reply=await member.api(path+'/comments','POST',{body:marker+'-member-comment',parentId:root.id},201);
    await member.api(path+'/comments/'+reply.id,'PATCH',{body:marker+'-edited-comment'});
    const deleted=await member.api(path+'/comments','POST',{body:marker+'-removed-comment'},201);
    await member.api(path+'/comments/'+deleted.id,'DELETE');
    await owner(path+'/comments/'+root.id+'/resolution','POST',{resolved:true});
    await raw(context,'/agents/api/policy','PUT',{document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'all',class:'*',do:'autonomous'}],spend:{none:true}}});
    const readers=[await mint(owner),await mint(member.api)];
    const receipts=[];
    for(const [index,caller] of [{page,api:owner},{page:member.page,api:member.api}].entries()){
      const current=caller.page;
      await current.setViewportSize({width:1440,height:1000});
      const native=await caller.api(path),discussion=await caller.api(path+'/discussion');
      const issueRead=await readers[index]('vector://issue/'+issue.id);
      assert.equal(issueRead.status,200);
      const content=issueRead.body.result.contents[0];
      assert.equal(content.uri,'vector://issue/'+issue.id);
      assert.equal(content.mimeType,'application/json');
      assert.equal(content._meta['com.runeditrun/untrusted'],true);
      assert.deepEqual(JSON.parse(content.text),native,'Every native issue field, including evidence and activity, is identical');
      assert.equal(native.evidence[0].summary,marker+'-evidence');
      assert.deepEqual(native.evidence[0].measurements,{delay:0,confirmed:true});
      assert.equal(native.evidence[0].customerReports[0].summary,marker+'-report');
      assert.ok(native.activity.some(a=>a.kind==='comment.edited'&&a.actor===memberName));
      assert.equal(discussion.comments.length,3);
      for(const comment of discussion.comments){
        const read=await readers[index]('vector://comment/'+comment.id);
        assert.equal(read.status,200);
        assert.equal(read.body.result.contents[0]._meta['com.runeditrun/untrusted'],true);
        assert.deepEqual(JSON.parse(read.body.result.contents[0].text),comment,'All native comment fields and per-person capabilities match');
      }
      const ownRoot=discussion.comments.find(c=>c.id===root.id),ownReply=discussion.comments.find(c=>c.id===reply.id);
      assert.equal(ownRoot.canEdit,index===0?1:0);assert.equal(ownRoot.canDelete,index===0?1:0);
      assert.equal(ownReply.canEdit,index===1?1:0);assert.equal(ownReply.canDelete,1);
      assert.equal(ownReply.parentId,root.id);assert.equal(ownReply.body,marker+'-edited-comment');
      assert.ok(ownReply.editedAt);assert.ok(ownRoot.resolvedAt);assert.equal(ownRoot.resolvedBy,ownerName);
      const tombstone=discussion.comments.find(c=>c.id===deleted.id);
      assert.equal(tombstone.body,null);assert.ok(tombstone.deletedAt);assert.equal(tombstone.canEdit,0);assert.equal(tombstone.canDelete,0);
      await navigate(current,base+'/app/issues/'+issue.identifier);
      await current.getByRole('heading',{name:native.title,exact:true}).waitFor();
      const timeOrigin=await current.evaluate(()=>performance.timeOrigin);
      assert.equal(await current.getByRole('textbox',{name:'Branch name',exact:true}).inputValue(),native.branchName);
      await current.getByText(native.description,{exact:true}).first().waitFor();
      await current.locator('.evidence-inspector').getByText(native.evidence[0].summary,{exact:true}).waitFor();
      await current.getByText(native.evidence[0].actor+' reported',{exact:true}).waitFor();
      await current.locator('.evidence-context > summary').click();
      const metrics=current.locator('.evidence-metrics > div');
      assert.equal(await metrics.filter({has:current.locator('dt',{hasText:/^Delay$/})}).locator('dd').innerText(),'0');
      assert.equal(await metrics.filter({has:current.locator('dt',{hasText:/^Confirmed$/})}).locator('dd').innerText(),'true');
      await current.getByText(marker+'-report',{exact:true}).waitFor();
      const resolved=current.locator('.comment-thread--resolved');
      assert.equal(await resolved.locator('strong').innerText(),ownRoot.resolvedBy);
      assert.equal(await resolved.locator('time').getAttribute('datetime'),ownRoot.resolvedAt);
      await current.getByRole('button',{name:'Show thread',exact:true}).click();
      for(const comment of discussion.comments){
        const entry=current.locator('.comment-entry').filter({hasText:comment.deletedAt?'Comment deleted':comment.body});
        assert.equal(await entry.count(),1);
        assert.equal(await entry.locator('strong').first().innerText(),comment.actor);
        assert.equal(await entry.getByRole('button',{name:'Edit comment',exact:true}).count(),comment.canEdit);
        assert.equal(await entry.getByRole('button',{name:'Delete comment',exact:true}).count(),comment.canDelete);
        assert.equal(await entry.locator('time').first().getAttribute('datetime'),comment.createdAt);
        if(comment.editedAt)assert.equal(await entry.locator('time').nth(1).getAttribute('datetime'),comment.editedAt);
      }
      await current.locator('.issue-history > summary').click();
      const activity=current.locator('.activity-list > li');
      assert.equal(await activity.count(),native.activity.length);
      for(const [position,event] of native.activity.entries())assert.ok((await activity.nth(position).innerText()).includes(event.actor));
      await settleReads(current);
      assert.equal(await current.evaluate(()=>performance.timeOrigin),timeOrigin,'Native navigation hydrates without a full reload');
      assert.equal(await current.getByRole('button',{name:'Reopen',exact:true}).count(),1);
      await current.getByRole('button',{name:'Reopen',exact:true}).focus();
      assert.ok(await current.getByRole('button',{name:'Reopen',exact:true}).evaluate(e=>e===document.activeElement));
      await inspect(current,current.locator('main:visible').first(),'agent-resource-'+(index===0?'owner':'member'));
      await current.setViewportSize({width:1440,height:1000});
      receipts.push({role:index===0?'owner':'member',issueFields:Object.keys(native),comments:discussion.comments.length});
      // Park readers before withdrawing authority, so no stale polling request races the next door.
      await navigate(current,base+'/');
    }
    await owner(`/settings/teams/${team.id}/members/${member.id}`,'DELETE');
    for(const [kind,existing] of [['issue',issue.id],['comment',reply.id]]){
      const hidden=await readers[1](`vector://${kind}/${existing}`),missing=await readers[1](`vector://${kind}/00000000000000000000000000`);
      assert.equal(hidden.status,200);assert.equal(hidden.body.error.data.code,'resource_unavailable');
      assert.equal(hidden.body.result,undefined);
      assert.deepEqual({...hidden,body:{...hidden.body,id:null}},{...missing,body:{...missing.body,id:null}});
      for(const text of [issue.identifier,issue.title,marker+'-evidence',marker+'-edited-comment'])assert.ok(!JSON.stringify(hidden.body).includes(text));
    }
    expectedDenials.add(base+'/api/issues/'+issue.identifier);
    await navigate(member.page,base+'/app/issues/'+issue.identifier);
    await member.page.locator('.resource-state').waitFor();
    assert.equal(await member.page.locator('.issue-inspector').count(),0);
    for(const text of [issue.title,marker+'-evidence',marker+'-edited-comment'])assert.ok(!(await member.page.locator('main').first().innerText()).includes(text));
    await navigate(member.page,base+'/');
    assert.deepEqual(member.errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(externalRequests,[]);
    await writeFile(evidence+'/agent-resource-parity.json',JSON.stringify({passed:true,receipts,hiddenEqualsMissing:true},null,2));
    record('BASE-AGENT-003','Owner and Member native issue and comment projections equal MCP resources, with rendered evidence, activity, attribution and per-person actions; withdrawn issue and comment reads equal missing records.');
  } finally {await member.context.close();}
}
