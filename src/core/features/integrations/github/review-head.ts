export type PrHead={head_sha:string|null;head_version:number;head_changed_at:string|null;head_conflicted:number;head_observed_at:string|null;updated_at:string};
/** Keep head observations separate from PR lifecycle ordering: receiving a review
 * must not suppress an ordinary PR status or its automation at the same timestamp. */
export function reviewHead(db:D1Database,id:string,number:number,at:string,sha:string|null,current:PrHead|null){
 const previousAt=current?.head_observed_at??current?.updated_at??'',newer=at>previousAt;
 const conflicting=Boolean(current)&&at===previousAt&&(sha!==current?.head_sha||Boolean(current?.head_conflicted));
 const changed=newer&&(sha!==current?.head_sha||Boolean(current?.head_conflicted));
 // An intervening head can arrive after a review already proved the return head.
 // Retire the older generation without moving the latest head observation back.
 const intervening=Boolean(current)&&at<previousAt&&at>(current?.head_changed_at??'')&&sha!==current?.head_sha;
 const head=conflicting?null:changed?sha:current?.head_sha??null;
 const version=(current?.head_version??0)+Number(changed||conflicting||intervening);
 const conflicted=conflicting?1:newer?0:current?.head_conflicted??0;
 const changedAt=changed||conflicting||intervening?at:current?.head_changed_at??at;
 const statements=at<previousAt&&!intervening?[]:[db.prepare('UPDATE vector_github_pull_requests SET head_sha=?,head_version=?,head_changed_at=?,head_conflicted=?,head_observed_at=? WHERE repository_id=? AND number=?').bind(head,version,changedAt,conflicted,intervening?previousAt:at,id,number)];
 // Only decisions signed after the intervening change support the retained head.
 if(intervening)statements.push(db.prepare('UPDATE github_reviews SET head_version=? WHERE repository_id=? AND number=? AND head_version=? AND commit_sha=? AND submitted_at>?').bind(version,id,number,current!.head_version,head,at));
 return {head,version,conflicted,changedAt,previousAt,statements};
}
/** A generation prevents an old approval returning when a branch returns to an earlier SHA.
 * Equal-time contradictory heads need a later signed observation to recover certainty. */
export function prHeadStatements(db:D1Database,id:string,number:number,at:string,sha:string|undefined,current:PrHead|null){
 // An event without a head cannot prove a previously approved head is still current.
 return reviewHead(db,id,number,at,sha??null,current).statements;
}
