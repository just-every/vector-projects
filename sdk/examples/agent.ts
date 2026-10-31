import {VectorClient} from '../client.js';
import {issueSnapshot, pages, record} from './reads.js';

/** Prepare context locally. This example makes no model call or work mutation. */
export async function agentContext(client: VectorClient, identifier: string) {
  const raw = record((await client.request('issues_get_4', {path:{identifier}})).data);
  const issue = issueSnapshot(raw);
  if (typeof raw.description !== 'string') throw new Error('Invalid issue description');
  const comments = await pages(async cursor => (await client.request('comments_list_12', {
    query:{issue:identifier, limit:1, cursor},
  })).data, 'comments', value => {
    const row = record(value);
    if (typeof row.id !== 'string' || typeof row.body !== 'string' || row.issueIdentifier !== identifier) {
      throw new Error('Invalid issue comment');
    }
    return {id:row.id, body:row.body};
  });
  // Detect an issue edit while its comments were being collected.
  const current = issueSnapshot((await client.request('issues_get_4', {path:{identifier}})).data);
  if (current.id !== issue.id || current.version !== issue.version) throw new Error('Issue changed; restart the context read');
  return {issue:{...issue, description:raw.description}, comments};
}
