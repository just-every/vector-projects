import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** Consume the release asset over its ordinary, unauthenticated HTTP door. */
export async function withSdkPackage(runtime, consume) {
  const {version} = JSON.parse(await readFile('package.json', 'utf8'));
  const response = await runtime.req(`/assets/vector-sdk-${version}.tgz`);
  assert.equal(response.status, 200, 'release delivers its SDK without member credentials');
  const directory = await mkdtemp(join(tmpdir(), 'vector-sdk-consumer-'));
  try {
    const archive = join(directory, 'sdk.tgz');
    await writeFile(archive, Buffer.from(await response.arrayBuffer()), {mode:0o600});
    execFileSync('tar', ['-xzf', archive, '-C', directory], {stdio:'pipe'});
    // Exercise package metadata and Node exports as an ordinary offline consumer.
    execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive], {cwd:directory, stdio:'pipe'});
    execFileSync(process.execPath, ['--input-type=module', '-e', "import {VectorClient, operations} from '@runeditrun/vector-sdk'; import {syncIssues} from '@runeditrun/vector-sdk/examples/sync'; if(typeof VectorClient !== 'function' || typeof syncIssues !== 'function' || !operations.issues_list_2) process.exit(1);"], {cwd:directory, stdio:'pipe'});
    return await consume(join(directory, 'package'));
  } finally {
    await rm(directory, {recursive:true, force:true});
  }
}
