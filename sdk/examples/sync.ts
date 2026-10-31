import {VectorClient} from '../client.js';
import type {Input} from '../client.js';
import {issueSnapshot, pages} from './reads.js';

/** One-way full refresh. Replace a mirror only after this entire read succeeds. */
export async function syncIssues(client: VectorClient, query: NonNullable<Input<'issues_list_2'>['query']>) {
  if (query.cursor !== undefined) throw new Error('A full sync starts without a cursor');
  return pages(async cursor => (await client.request('issues_list_2', {
    query:{...query, limit:query.limit ?? 50, cursor},
  })).data, 'issues', issueSnapshot);
}
