import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {register} from 'node:module';
import ts from 'typescript';
import {parseContract} from '../../src/base/seed-contract.mjs';

/** This census begins at the real Hono app and Settings module graph, rather
 * than iterating the declarations it is meant to check. It runs in the existing
 * administration journey, before the same doors are exercised with real people. */
export async function assertRoleDoorCoverage(){
 register('./integrations/typescript-loader.mjs',import.meta.url);
 const [{createServerApp},{doors,apiDoors},{matrix},{settingsFormDoors,serverFunctionDoors,commandDoors}]=await Promise.all([
  import('../../src/core/app/server.ts'),import('../../src/core/features/roles/doors.ts'),
  import('../../src/core/features/roles/matrix.ts'),import('../../src/core/features/roles/settings-doors.ts'),
 ]);
 const routes=createServerApp().routes;
 const allEndpoints=new Set();
 function endpoints(folder){for(const item of readdirSync(folder,{withFileTypes:true})){
  const file=resolve(folder,item.name);if(item.isDirectory()){endpoints(file);continue;}if(!/\.[cm]?[jt]sx?$/.test(file))continue;
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function walk(node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='all'){
   const argument=node.arguments[0];if(argument&&ts.isStringLiteral(argument))allEndpoints.add(argument.text);
  }ts.forEachChild(node,walk);}walk(source);
 }}endpoints(resolve('src'));
 const key=door=>door.method+' '+door.path;
 const contractIds=new Set(parseContract(readFileSync('CONTRACT.md','utf8')).clauses.map(clause=>clause.id));
 for(const [id,row] of Object.entries(matrix)){
  const clauses=row.action.match(/[A-Z]+-[0-9]{3}/g)??[];
  assert.ok(clauses.length,id+' has no contract clause');
  for(const clause of clauses)assert.ok(contractIds.has(clause),id+' names an absent clause '+clause);
 }
 for(const [base,registry] of [['/api',doors],['/api/v1',apiDoors]]){
  const declared=new Map();
  for(const door of registry){assert.ok(!declared.has(key(door)),'Duplicate permission door '+key(door));declared.set(key(door),door);
   assert.ok(door.row!==null||door.page,'Door has no role-matrix row: '+key(door));
   if(typeof door.row==='string')assert.ok(matrix[door.row],'Unknown role row '+door.row);
   assert.ok(routes.some(route=>route.path===base+door.path&&route.method===door.method),'Permission declaration has no actual door: '+base+' '+key(door));
  }
  for(const route of routes){
   if(!route.path.startsWith(base+'/')||base==='/api'&&/^\/api\/(?:v1|integrations|editor)(?:\/|$)/.test(route.path))continue;
   if(route.method==='ALL'&&!allEndpoints.has(route.path.slice(base.length)))continue; // Hono middleware
   if(route.method==='GET'&&!route.path.startsWith(base+'/settings'))continue;
   assert.ok(declared.has(route.method+' '+route.path.slice(base.length)),'Unregistered actual door: '+route.method+' '+route.path);
  }
 }
 const native=new Map(doors.map(door=>[key(door),door]));
 const assertDoor=(reference,label)=>assert.ok(native.has(reference),label+' names an unregistered door '+reference);
 const root=resolve('src/core/features'),seen=new Set(),forms=new Map();
 function settingsModule(file){
  if(seen.has(file))return;seen.add(file);
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function walk(node,component='module'){
   if((ts.isFunctionDeclaration(node)||ts.isVariableDeclaration(node))&&node.name&&ts.isIdentifier(node.name))component=node.name.text;
   if(ts.isJsxOpeningElement(node)&&node.tagName.getText(source)==='form'){
    const id=relative(root,file)+'#'+component,index=forms.get(id)??0;
    assertDoor(settingsFormDoors[id]?.[index],id+' form '+(index+1));forms.set(id,index+1);
   }
   ts.forEachChild(node,child=>walk(child,component));
  }walk(source);
  for(const node of source.statements)if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text.startsWith('.')){
   const target=resolve(dirname(file),node.moduleSpecifier.text);
   for(const suffix of ['.tsx','.ts','.jsx','.js','.mjs','/index.tsx','/index.ts','/index.jsx','/index.js'])if(existsSync(target+suffix)){settingsModule(target+suffix);break;}
  }
 }
 // Every Settings route reaches its section module; the cycles page keeps its forms covered too.
 for(const route of readdirSync(resolve('src/routes')).filter(name=>/^app\.settings(\..+)?\.tsx$/.test(name)).sort())settingsModule(resolve('src/routes',route));
 settingsModule(resolve(root,'cycles/ui/cycles-workspace.tsx'));
 for(const [id,references] of Object.entries(settingsFormDoors))assert.equal(forms.get(id),references.length,'Stale Settings form registration '+id);
 const functions=new Set();
 function sources(folder){for(const item of readdirSync(folder,{withFileTypes:true})){
  const file=resolve(folder,item.name);if(item.isDirectory()){sources(file);continue;}if(!/\.[cm]?[jt]sx?$/.test(file))continue;
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const factoryNames=new Set(['createServerFn']);
  for(const node of source.statements)if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='@tanstack/react-start'){
   for(const item of node.importClause?.namedBindings?.elements??[])if((item.propertyName??item.name).text==='createServerFn')factoryNames.add(item.name.text);
  }
  function walk(node,name='module'){
   if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name))name=node.name.text;
   if(ts.isCallExpression(node)&&(factoryNames.has(node.expression.getText(source))||ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='createServerFn')){
   const method=node.arguments[0]?.properties?.find(property=>property.name?.text==='method')?.initializer?.text;
   assert.ok(method,'Server function must declare its method: '+file);
   if(method!=='GET'){const id=relative(process.cwd(),file)+'#'+name;assertDoor(serverFunctionDoors[id],id);assert.ok(!functions.has(id),'Duplicate server function registration '+id);functions.add(id);}
  }ts.forEachChild(node,child=>walk(child,name));}walk(source);
 }}sources(resolve('src'));
 for(const file of Object.keys(serverFunctionDoors))assert.ok(functions.has(file),'Stale server function registration '+file);
 const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts;
 for(const command of Object.values(scripts)){
  const file=/^node (scripts\/[^ ]+\.mjs)$/.exec(command)?.[1];if(!file)continue;
  const source=readFileSync(file,'utf8');
  // Workspace command transport; build, deployment and checkout-resource commands
  // do not carry a member session and cannot act as one.
  if(!/cookieFile|Authorization/.test(source)||!source.includes('fetch('))continue;
  assert.ok(commandDoors[file],file+' has no command permission registration');
  const syntax=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),admitted=[];
  function commands(node){if(ts.isVariableDeclaration(node)&&node.name.getText(syntax)==='commands'&&ts.isArrayLiteralExpression(node.initializer)){
   for(const item of node.initializer.elements){assert.ok(ts.isStringLiteral(item),file+' command must have an explicit name');admitted.push(item.text);}
  }ts.forEachChild(node,commands);}commands(syntax);
  assert.ok(admitted.length,file+' must enumerate its public commands for permission coverage');
  assert.deepEqual(Object.keys(commandDoors[file]).sort(),admitted.sort(),file+' command census differs from its permission declarations');
 }
 for(const [file,commands] of Object.entries(commandDoors)){
  assert.ok(existsSync(file),'Command registration has no implementation '+file);
  for(const [name,references] of Object.entries(commands))for(const reference of references)assertDoor(reference,file+' '+name);
 }
 return {routes:routes.length,forms:[...forms.values()].reduce((a,b)=>a+b,0)};
}
