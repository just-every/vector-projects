import {VectorClient} from '../dist/client.js';

export function exampleClient() {
  const {VECTOR_URL, VECTOR_API_TOKEN, VECTOR_DEV_KEY} = process.env;
  if (!VECTOR_URL || !VECTOR_API_TOKEN) throw new Error('Missing example configuration');
  return new VectorClient({baseUrl:VECTOR_URL, token:VECTOR_API_TOKEN,
    headers:VECTOR_DEV_KEY ? {'x-rer-dev-key':VECTOR_DEV_KEY} : undefined});
}

export function required(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing example configuration');
  return value;
}

export function fail(example) {
  console.error(`${example} failed. Check the installation, input, scopes and credential; no automatic retry was made.`);
  process.exitCode = 1;
}
