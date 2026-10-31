import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {expect,inject} from 'vitest';
import {createVectorArchive} from '../../src/core/features/data/archive-service.mjs';
import {readArchive} from '@runeditrun/rer/modules/portability';
import {destination,targetBindings,targetCall,targetSignIn} from './http-archive-fixture';
import type {setupIntegrations} from './integration-fixture';
export async function proveGithubReviewArchive(f:Awaited<ReturnType<typeof setupIntegrations>>,config:{id:string;receiver:string},replay:unknown,identifier:string){
 await applyD1Migrations(destination.ARCHIVE_TARGET_DB,inject('migrations'));
 const source=await createVectorArchive({db:env.DB,files:env.FILES}),target=await createVectorArchive({db:destination.ARCHIVE_TARGET_DB,files:destination.ARCHIVE_TARGET_FILES});
 const id=await source.exports.create();while((await source.exports.advance(id,{maxParts:16})).phase==='building'){}
 const records:any[]=[];for await(const record of readArchive(await source.exports.download(id)))records.push(record);await source.exports.abort(id);
 const restored=await target.imports.create(records[0]);for(const part of records.filter(row=>row.kind==='part'))await target.imports.uploadPart(restored,part.index,part);
 await target.imports.finalize(restored,{contentHash:records.at(-1).contentHash,archiveHash:records.at(-1).archiveHash});
 for(const table of ['github_reviews','vector_github_pull_requests','vector_github_deliveries'])expect((await destination.ARCHIVE_TARGET_DB.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()).results).toEqual((await env.DB.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()).results);
 const cookie=await targetSignIn(),response=await targetCall('/api/issues/'+identifier+'/github','GET',undefined,cookie);expect(response.status).toBe(200);
 expect(await response.json()).toEqual(await (await f.call('/issues/'+identifier+'/github')).json());
 expect(await destination.ARCHIVE_TARGET_DB.prepare("SELECT count(*) FROM vector_integration_secret_keys WHERE identity=?").bind('github:'+config.id).first('count(*)')).toBe(0);
 const replayed=await f.app.request(config.receiver,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(replay)},targetBindings);expect(replayed.status).toBe(401);
 console.log('PROBE GITHUB-005 archive: native archive round trip -> identical reviews, PR head generations and receipts; authenticated restored issue read succeeds and historical receiver remains inert');
}
