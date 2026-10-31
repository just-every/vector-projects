export type PrHead={head_sha:string|null;head_version:number;head_changed_at:string|null;head_conflicted:number;head_observed_at:string|null;updated_at:string};
/** Keep head observations separate from PR lifecycle ordering: receiving a review
 * must not suppress an ordinary PR status or its automation at the same timestamp. */
export function reviewHead(db:D1Database,id:string,number:number,at:string,sha:string|null,current:PrHead|null){
 const previousAt=current?.head_observed_at??current?.updated_at??'',newer=at>previousAt;
 const conflicting=Boolean(current)&&at===previousAt&&(sha!==current?.head_sha||Boolean(current?.head_conflicted));
 const changed=newer&&(sha!==current?.head_sha||Boolean(current?.head_conflicted));
 const head=conflicting?null:changed?sha:current?.head_sha??null;
 const version=(current?.head_version??0)+Number(changed||conflicting);
 const conflicted=conflicting?1:newer?0:current?.head_conflicted??0;
 const changedAt=changed||conflicting?at:current?.head_changed_at??at;
 return {head,version,conflicted,changedAt,previousAt,statements:at<previousAt?[]:[db.prepare('UPDATE vector_github_pull_requests SET head_sha=?,head_version=?,head_changed_at=?,head_conflicted=?,head_observed_at=? WHERE repository_id=? AND number=?').bind(head,version,changedAt,conflicted,at,id,number)]};
}
/** A generation prevents an old approval returning when a branch returns to an earlier SHA.
 * Equal-time contradictory heads need a later signed observation to recover certainty. */
export function prHeadStatements(db:D1Database,id:string,number:number,at:string,sha:string|undefined,current:PrHead|null){
 // An event without a head cannot prove a previously approved head is still current.
 return reviewHead(db,id,number,at,sha??null,current).statements;
}
