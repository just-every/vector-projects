import {agentContext} from '../dist/examples/agent.js';
import {exampleClient, required, fail} from './environment.mjs';

try {
  console.log(JSON.stringify(await agentContext(exampleClient(), required('VECTOR_ISSUE'))));
} catch {
  fail('Agent context');
}
