import {intake} from '../dist/examples/intake.js';
import {exampleClient, required, fail} from './environment.mjs';

// Credentials travel only in the process environment and request headers.
try {
  const issue = await intake(exampleClient(), {teamId:required('VECTOR_TEAM_ID'), title:required('VECTOR_TITLE')});
  console.log(JSON.stringify(issue));
} catch {
  fail('Intake');
}
