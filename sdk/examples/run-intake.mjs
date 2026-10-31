import {VectorClient} from '../dist/client.js';
import {intake} from '../dist/examples/intake.js';

// Credentials travel only in the process environment and request headers.
try {
  const {VECTOR_URL, VECTOR_API_TOKEN, VECTOR_TEAM_ID, VECTOR_TITLE, VECTOR_DEV_KEY} = process.env;
  if (!VECTOR_URL || !VECTOR_API_TOKEN || !VECTOR_TEAM_ID || !VECTOR_TITLE) throw new Error();
  const client = new VectorClient({baseUrl:VECTOR_URL, token:VECTOR_API_TOKEN,
    headers:VECTOR_DEV_KEY ? {'x-rer-dev-key':VECTOR_DEV_KEY} : undefined});
  const issue = await intake(client, {teamId:VECTOR_TEAM_ID, title:VECTOR_TITLE});
  console.log(JSON.stringify(issue));
} catch {
  console.error('Intake failed. Check the installation, team, scopes and credential; no automatic retry was made.');
  process.exitCode = 1;
}
