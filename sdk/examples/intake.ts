import {VectorClient} from '../client.js';

function issueIdentity(value: unknown): {id: string; identifier: string; title: string} {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' ||
      !('identifier' in value) || typeof value.identifier !== 'string' ||
      !('title' in value) || typeof value.title !== 'string') {
    throw new Error('Intake response is missing its issue identity or title');
  }
  return {id:value.id, identifier:value.identifier, title:value.title};
}

/** Creates once and confirms the persisted result through the public read door. */
export async function intake(client: VectorClient, input: {teamId: string; title: string}) {
  const created = issueIdentity((await client.request('issues_create_3', {body:input})).data);
  const read = issueIdentity((await client.request('issues_get_4', {path:{identifier:created.identifier}})).data);
  if (created.title !== input.title || read.title !== input.title || read.id !== created.id || read.identifier !== created.identifier) {
    throw new Error('Intake readback did not match the created issue');
  }
  return read;
}
