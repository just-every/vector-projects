import {syncIssues} from '../dist/examples/sync.js';
import {exampleClient, required, fail} from './environment.mjs';

try {
  const issues = await syncIssues(exampleClient(), {
    team:required('VECTOR_TEAM_ID'), q:process.env.VECTOR_QUERY ?? '', limit:1,
  });
  console.log(JSON.stringify({issues}));
} catch {
  fail('Sync');
}
