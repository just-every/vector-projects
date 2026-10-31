import { expect } from 'vitest';
import { request } from './base-auth-fixture';
import { sampleBindings } from './sample-auth-fixture';

/** Use the populated installation after its forward migrations, through mounted doors. */
export async function exerciseUpgradedIssueTemplates(cookie:string) {
  const call=(path:string,method='GET',body?:unknown)=>request('/api'+path,method,body,cookie,sampleBindings);
  const options=await (await call('/options')).json() as any;
  const team=options.teams[0];
  const input={name:'synthetic-vector-1650',teamId:team.id,defaults:{title:'synthetic-vector-1651',description:'## Upgraded bug',priority:'high'},subissues:[{title:'synthetic-vector-1652'},{title:'synthetic-vector-1653'}]};
  const created=await call('/issue-templates','POST',input);
  expect(created.status,await created.clone().text()).toBe(201);
  const template=await created.json() as any;
  const updated=await call('/issue-templates/'+template.id,'PUT',{...input,name:'synthetic-vector-1654',expectedVersion:template.version});
  expect(updated.status).toBe(200);
  const current=await updated.json() as any;
  expect(current.version).toBe(template.version+1);
  const applied=await call('/issues','POST',{teamId:team.id,templateId:current.id,templateVersion:current.version});
  expect(applied.status,await applied.clone().text()).toBe(201);
  const parent=await applied.json() as any;
  expect(parent).toMatchObject(input.defaults);
  const linked=await call('/issues/'+parent.identifier+'/subissues');
  expect(linked.status).toBe(200);
  const {children}=await linked.json() as any;
  expect(children.map((child:any)=>child.title)).toEqual(input.subissues.map(child=>child.title));
  expect(new Set([parent.id,...children.map((child:any)=>child.id)]).size).toBe(3);
  for(const child of children) {
    const detail=await call('/issues/'+child.identifier);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({id:child.id,parent:{identifier:parent.identifier}});
  }
  console.info('PROBE ISSUE-016 upgrade: populated installation -> versioned template creates one parent with two distinct linked children');
}
