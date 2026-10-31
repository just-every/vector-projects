import {VectorClient} from '../client.js';
import {issueIdentity} from './reads.js';

/** Creates once and confirms the persisted result through the public read door. */
export async function intake(client: VectorClient, input: {teamId: string; title: string}) {
  const created = issueIdentity((await client.request('issues_create_3', {body:input})).data);
  const read = issueIdentity((await client.request('issues_get_4', {path:{identifier:created.identifier}})).data);
  if (created.title !== input.title || read.title !== input.title || read.id !== created.id || read.identifier !== created.identifier) {
    throw new Error('Intake readback did not match the created issue');
  }
  return read;
}
