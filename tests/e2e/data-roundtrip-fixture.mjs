import assert from 'node:assert/strict';
import {populateDeliveryHistory} from './data-roundtrip-history.mjs';
export async function populateRoundtrip(installation,cookie){
 const api=async(path,method='GET',body,status=200)=>{const response=await installation.req(path,method,body,cookie);assert.equal(response.status,status,path);return response.json();};
 const admin=await api('/api/settings/administration'),team=admin.teams.find(row=>!row.archivedAt),status=team.statuses.find(row=>row.category==='unstarted');
 const owner=installation.sql("SELECT id FROM operators WHERE email='sarah@vector.test'")[0].id,peer=installation.sql("SELECT id FROM operators WHERE email='maya@vector.test'")[0].id;
 await installation.signIn('maya@vector.test');
 const root=await api('/api/issues','POST',{teamId:team.id,statusId:status.id,title:'Complete archive root',description:'Original native records',assigneeOperatorId:peer},201),child=await api('/api/issues','POST',{teamId:team.id,statusId:status.id,title:'Complete archive child'},201);
 await api('/api/issues/'+child.identifier+'/parent','PATCH',{expectedVersion:child.version,parentIdentifier:root.identifier});
 await api('/api/issues/'+root.identifier+'/dependencies','POST',{expectedVersion:root.version,relatedIdentifier:child.identifier,relatedVersion:child.version+1,direction:'blocks'});
 const reacted=await api('/api/issues/'+root.identifier+'/comments','POST',{body:'Restored searchable comment'},201);
 for(const targetId of ['',reacted.id])await api('/api/issues/'+root.identifier+'/reactions','PUT',{targetId,emoji:'👍'});
 const referenceVersion=(await api('/api/issues/'+child.identifier)).version;await api('/api/issues/'+child.identifier,'PATCH',{expectedVersion:referenceVersion,description:'See '+root.identifier});
 const tombstone=await api('/api/issues/'+root.identifier+'/comments','POST',{body:'Removed comment history'},201);await api('/api/issues/'+root.identifier+'/comments/'+tombstone.id,'DELETE');
 const link=await api('/api/issues/'+root.identifier+'/links','POST',{name:'Historical reference',url:'https://example.com/history'},201);await api('/api/issues/'+root.identifier+'/links/'+link.id,'DELETE');await api('/api/issues/'+root.identifier+'/links','POST',{name:'Retained reference',url:'https://example.com/retained'},201);
 for(const [name,type,bytes] of [['original.txt','text/plain',Buffer.from('Original text bytes')],['original.json','application/json',Buffer.from('{"retained":true,"unicode":"Δ"}')]]){
  const response=await fetch(installation.origin+'/api/issues/'+root.identifier+'/files',{method:'POST',headers:{Origin:installation.origin,Cookie:cookie,'Content-Type':type,'X-File-Name':name},body:bytes});assert.equal(response.status,201,name+' uses the supported public upload contract');
 }
 const privateView=await api('/api/views','POST',{name:'Owner private view',isShared:false,query:{}},201),sharedView=await api('/api/views','POST',{name:'Shared restored view',isShared:true,query:{}},201);
 const archived=await api('/api/settings/teams','POST',{name:'Archived history',identifierPrefix:'HST'});const historyTeam=archived.teams.find(row=>row.identifierPrefix==='HST');await api('/api/settings/teams/'+historyTeam.id,'PATCH',{archived:true});
 const project=admin.projects.find(row=>row.lifecycle==='completed')??admin.projects[0];await api('/api/settings/projects/'+project.id,'PATCH',{archived:true});
 await api('/api/favorites','PUT',{expectedVersion:0,folders:[{id:'archive',name:'Restored work'}],entries:[{kind:'issue',subjectId:root.id,folderId:null},{kind:'project',subjectId:project.id,folderId:null},{kind:'view',subjectId:privateView.id,folderId:'archive'}]});
 const input={format:'json',source:'archive-import',name:'retained.json',base64:Buffer.from(JSON.stringify([{id:'archive-record',title:'Imported source history',team:team.name}])).toString('base64'),mapping:{sourceId:'id',title:'title',team:'team'},defaults:{status:status.id}};
 const publish=async(value,key)=>{const review=await api('/api/data/import/preview','POST',value);assert.equal(review.ready,true);let run=await api('/api/data/import/apply','POST',{input:{...value,effectiveAt:review.effectiveAt},reviewedFingerprint:review.fingerprint,operationKey:key,acknowledgeOmissions:true});while(run.progress.unfinished)run=await api('/api/data/import/runs/'+run.id+'/resume','POST',{});return run;};
 const retained=await publish(input,'archive-completed');assert.equal(retained.state,'completed');
 const rollback=await publish({...input,source:'archive-rollback'},'archive-rollback');assert.equal((await api('/api/data/import/runs/'+rollback.id+'/rollback','POST',{confirmed:true})).state,'rolled_back');
 const failedInput={...input,source:'archive-failed'},review=await api('/api/data/import/preview','POST',failedInput);assert.equal(review.ready,true);
 installation.fixture("CREATE TRIGGER fail_archive_import BEFORE INSERT ON issues WHEN NEW.title='Imported source history' BEGIN SELECT RAISE(ABORT,'fixture late SQL failure'); END;");
 const created=await api('/api/data/import/apply','POST',{input:{...failedInput,effectiveAt:review.effectiveAt},reviewedFingerprint:review.fingerprint,operationKey:'archive-failed',acknowledgeOmissions:true});
 const failed=await installation.req('/api/data/import/runs/'+created.id+'/resume','POST',{},cookie);assert.equal(failed.status,503);installation.fixture('DROP TRIGGER fail_archive_import;');
 const failedRun=(await api('/api/data/import/runs')).runs.find(row=>row.namespace==='vector-import:archive-failed');assert(failedRun);assert.equal(failedRun.state,'queued');assert.equal(failedRun.checkpoint,0);
 assert.equal(installation.sql("SELECT count(*) AS n FROM ik_sources WHERE job_id=(SELECT id FROM ik_jobs WHERE operation_key='archive-failed')")[0].n,0);
 // The real failed batch above remains retryable without any publication.
 // Explicit historical failure is synthetic fixture data in the native store;
 // archive equality must preserve that supported state and its safe diagnostic too.
 installation.fixture("UPDATE ik_jobs SET state='failed',error='Historical publication failed' WHERE operation_key='archive-failed' AND state='queued' AND checkpoint=0;");
 const historical=await api('/api/data/import/runs/'+failedRun.id);assert.equal(historical.state,'failed');assert.equal(historical.error,'Historical publication failed');
 populateDeliveryHistory(installation,{issue:root,owner,peer});
 const removed=installation.sql("SELECT id FROM operators WHERE email='alex@vector.test'")[0].id;await api('/api/settings/operators/'+removed,'DELETE');
 assert.equal(installation.sql('SELECT count(*) AS n FROM operators WHERE removed_at IS NOT NULL')[0].n,1);
 return {referenceSource:child.identifier,referenceTarget:root.identifier,identifier:root.identifier,favoriteIds:[root.id,project.id,privateView.id],peer,privateView:privateView.id,sharedView:sharedView.id};
}
export function verifyRoundtripCategories(records){
 const manifest=records[0],required=['operators','teams','workflow_statuses','issues','issue_comments','issue_reactions','issue_reference_subjects','issue_files','issue_links','issue_dependencies','issue_parents','evidence_revisions','intake_decisions','issue_activity','projects','cycles','labels','saved_views','member_favorites','list_preferences','notifications','notification_deliveries','notification_delivery_attempts','workspace_settings','audit_records','operator_removals','ik_jobs','ik_sources','ik_originals'];
 for(const name of required)assert(manifest.tables.find(row=>row.name===name)?.count>0,'Complete archive category: '+name);
 const items=records.filter(row=>row.kind==='part').flatMap(row=>row.items),text=canonicalRecords(items);
 assert(text.includes('Removed comment history')===false,'Tombstoned comment content is absent');assert(text.includes('"rolled_back"'));assert(text.includes('"failed"'));
 return required;
}
function canonicalRecords(items){return JSON.stringify(items);}
