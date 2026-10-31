import {z} from 'zod';
import {useApiResource} from '../../../app/api-client';
const schema=z.object({
 deployments:z.array(z.object({repository:z.string(),deploymentId:z.number(),sha:z.string(),environment:z.string(),deployedAt:z.string()})),
 pullRequests:z.array(z.object({repository:z.string(),number:z.number(),title:z.string(),url:z.string().url(),state:z.enum(['open','closed','merged']),updatedAt:z.string(),headSha:z.string().nullable(),reviews:z.array(z.object({reviewerId:z.number(),reviewer:z.string(),state:z.enum(['approved','changes_requested','dismissed','conflicted']),commitSha:z.string()}))})),
 commits:z.array(z.object({repository:z.string(),sha:z.string(),author:z.string(),subject:z.string(),url:z.string().url()})),
});
export function GithubLinks({identifier}:{identifier:string}){
 const resource=useApiResource('/api/issues/'+identifier+'/github',schema,undefined,{abortPendingOnDispose:false});
 if(resource.error)return <section className="detail-section"><h2>GitHub</h2><p role="alert">{resource.error.message}</p><button type="button" onClick={resource.reload}>Retry GitHub links</button></section>;
 if(!resource.data||(!resource.data.pullRequests.length&&!resource.data.commits.length&&!resource.data.deployments.length))return null;
 return <section className="detail-section" aria-label="GitHub links"><h2>GitHub</h2>{resource.data.pullRequests.length>0&&<><h3>Pull requests</h3><ul>{resource.data.pullRequests.map(pr=><li key={pr.repository+':'+pr.number}><a href={pr.url} rel="noopener noreferrer" target="_blank">{pr.title} · {pr.repository} #{pr.number}</a><span> · {pr.state}</span><GithubReviewState reviews={pr.reviews} /></li>)}</ul></>}{resource.data.commits.length>0&&<><h3>Commits</h3><ul>{resource.data.commits.map(commit=><li key={commit.repository+':'+commit.sha}><a href={commit.url} rel="noopener noreferrer" target="_blank">{commit.subject}</a><span> · {commit.author} · {commit.sha.slice(0,7)}</span></li>)}</ul></>}{resource.data.deployments.length>0&&<><h3>Deployments</h3><ul>{resource.data.deployments.map(d=><li key={d.repository+':'+d.deploymentId}>{d.environment} · <time dateTime={d.deployedAt}>{new Date(d.deployedAt).toISOString()}</time> · {d.sha.slice(0,7)}</li>)}</ul></>}</section>;
}

function GithubReviewState({reviews}:{reviews:z.infer<typeof schema>['pullRequests'][number]['reviews']}){
 const state=reviews.some(r=>r.state==='changes_requested')?'Changes requested':reviews.some(r=>r.state==='approved')?'Approved':'Review needed';
 const labels={approved:'Approved',changes_requested:'Changes requested',dismissed:'Review dismissed',conflicted:'Review uncertain'};
 return <div aria-label="Pull request reviews"><strong>{state}</strong>{reviews.length>0&&<ul>{reviews.map(review=><li key={review.reviewerId}>{review.reviewer} · {labels[review.state]} · {review.commitSha.slice(0,7)}</li>)}</ul>}</div>;
}
