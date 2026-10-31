import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {buildSdk} from './build.mjs';

/** Package only reviewed public inputs; never copy checkout settings or state. */
export async function packageSdk() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const {version} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version');
  buildSdk();
  const temporary = await mkdtemp(join(tmpdir(), 'vector-sdk-'));
  const output = join(root, 'dist/client/assets');
  await mkdir(output, {recursive:true});
  try {
    await cp(join(root, 'sdk/dist'), join(temporary, 'dist'), {recursive:true});
    await cp(join(root, 'sdk/README.md'), join(temporary, 'README.md'));
    await cp(join(root, 'LICENSE'), join(temporary, 'LICENSE'));
    await mkdir(join(temporary, 'schema'));
    await cp(join(root, 'schema/api-v1.json'), join(temporary, 'schema/api-v1.json'));
    await mkdir(join(temporary, 'docs'));
    await cp(join(root, 'docs/API.md'), join(temporary, 'docs/API.md'));
    await mkdir(join(temporary, 'docs/guide'));
    await cp(join(root, 'docs/guide/api.md'), join(temporary, 'docs/guide/api.md'));
    await mkdir(join(temporary, 'examples'));
    for (const name of ['environment.mjs', 'run-intake.mjs', 'run-sync.mjs', 'run-agent.mjs']) {
      await cp(join(root, 'sdk/examples', name), join(temporary, 'examples', name));
    }
    await writeFile(join(temporary, 'package.json'), JSON.stringify({
      name:'@runeditrun/vector-sdk', version, type:'module', license:'MIT',
      description:'Generated TypeScript client for the published Vector API',
      engines:{node:'>=22.20.0'}, main:'./dist/client.js', types:'./dist/client.d.ts',
      exports:{'.':'./dist/client.js', './examples/*':'./dist/examples/*.js'},
      files:['dist', 'examples', 'schema', 'docs', 'README.md', 'LICENSE'],
    }, null, 2) + '\n');
    // npm pack is offline and this generated package declares no lifecycle hooks.
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json'], {
      cwd:temporary, encoding:'utf8', stdio:['ignore','pipe','pipe'],
    }));
    const filename = `vector-sdk-${version}.tgz`;
    await cp(join(temporary, packed[0].filename), join(output, filename));
    return {path:join(output, filename), url:'/assets/' + filename, version};
  } finally {
    await rm(temporary, {recursive:true, force:true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await packageSdk();
  console.log('Public SDK release asset: ' + result.url);
}
