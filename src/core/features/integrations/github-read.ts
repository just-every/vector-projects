/** The caller admits the issue before this read and fences access before exposing it. */
export async function githubIssueProjection(db:D1Database,issueId:string){
 return githubIssueFromRows((await githubIssueStatement(db,issueId).all()).results);
}
/** A single statement also serves the admitted streaming document projection. */
export function githubIssueStatement(db:D1Database,issueId:string){
 return db.prepare(`SELECT 'pr' AS type,json_object('repository',r.repository,'number',p.number,'title',p.title,'url',p.url,'state',p.state,'updatedAt',p.updated_at,'headSha',p.head_sha,'reviews',json((SELECT json_group_array(json_object('reviewerId',v.reviewer_id,'reviewer',v.reviewer_login,'state',v.state,'commitSha',v.commit_sha)) FROM github_reviews v WHERE v.repository_id=p.repository_id AND v.number=p.number AND v.head_version=p.head_version AND v.commit_sha=p.head_sha AND p.head_conflicted=0 AND v.state<>'commented' AND NOT EXISTS(SELECT 1 FROM github_reviews later WHERE later.repository_id=v.repository_id AND later.number=v.number AND later.head_version=v.head_version AND later.reviewer_id=v.reviewer_id AND later.state<>'commented' AND (later.submitted_at>v.submitted_at OR (later.submitted_at=v.submitted_at AND later.review_id>v.review_id)))))) AS body,p.updated_at AS sort
 FROM vector_github_issue_links l JOIN vector_github_repositories r ON r.id=l.repository_id JOIN vector_github_pull_requests p ON p.repository_id=l.repository_id AND p.number=l.number WHERE l.issue_id=?
 UNION ALL SELECT 'commit',json_object('repository',r.repository,'sha',c.sha,'author',c.author,'subject',c.subject,'url',c.url),c.received_at FROM github_commit_links c JOIN vector_github_repositories r ON r.id=c.repository_id WHERE c.issue_id=?

 UNION ALL SELECT 'deployment',json_object('repository',r.repository,'deploymentId',d.deployment_id,'sha',d.sha,'environment',d.environment,'deployedAt',d.deployed_at),d.deployed_at FROM github_issue_environments e JOIN github_deployments d ON d.repository_id=e.repository_id AND d.deployment_id=e.deployment_id JOIN vector_github_repositories r ON r.id=d.repository_id WHERE e.issue_id=?
 ORDER BY sort DESC,body LIMIT 300`).bind(issueId,issueId,issueId);
}
export function githubIssueFromRows(rows:D1Result['results']){
 const pullRequests:Record<string,unknown>[]=[],commits:Record<string,unknown>[]=[],deployments:Record<string,unknown>[]=[];
 for(const row of rows as {type:string;body:string}[]){const value=JSON.parse(String(row.body)) as Record<string,unknown>;(row.type==='pr'?pullRequests:row.type==='commit'?commits:deployments).push(value);}
 return {pullRequests,commits,deployments};
}
