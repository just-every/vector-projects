import {env} from 'cloudflare:workers';
/** Populate the pre-feature schema with a genuine linked PR and content-bound receipt.
 * The existing historical upgrade journey snapshots these columns before applying later files. */
export async function populateGithubReviewUpgrade(){
 const workspace=await env.DB.prepare('SELECT id FROM workspace_settings LIMIT 1').first<string>('id');
 const issue=await env.DB.prepare('SELECT id FROM issues LIMIT 1').first<string>('id');
 await env.DB.batch([
  env.DB.prepare("INSERT INTO vector_github_repositories(id,workspace_id,repository,name,created_at,updated_at) VALUES('synthetic-vector-5504',?,'octocat/test-repo1','synthetic-vector-5504','2026-10-01','2026-10-01')").bind(workspace),
  env.DB.prepare("INSERT INTO vector_github_pull_requests(repository_id,number,title,url,state,updated_at,received_at) VALUES('synthetic-vector-5504',73,'synthetic-vector-5501','https://github.com/octocat/test-repo1/pull/73','open','2026-10-01','2026-10-01')"),
  env.DB.prepare("INSERT INTO vector_github_issue_links(repository_id,number,issue_id,created_at) VALUES('synthetic-vector-5504',73,?,'2026-10-01')").bind(issue),
  env.DB.prepare("INSERT INTO vector_github_deliveries(repository_id,delivery_id,payload_hash,received_at,diagnostic) VALUES('synthetic-vector-5504','synthetic-vector-5502','synthetic-vector-5503','2026-10-01','linked')"),
 ]);
}
