import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {rmSync} from 'node:fs';

/** Shared by the local example and the existing integration Verify entry point. */
export function buildSdk() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  execFileSync(process.execPath, [fileURLToPath(new URL('./generate.mjs', import.meta.url)), '--check'], {cwd:root, stdio:'pipe'});
  rmSync(resolve(root, 'sdk/dist'), {recursive:true, force:true});
  execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'sdk/tsconfig.json'], {cwd:root, stdio:'pipe'});
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSdk();
  console.log('SDK schema generation checked and TypeScript compiled.');
}
