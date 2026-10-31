import assert from 'node:assert/strict';

/** A real client exchanges separately consented grants at the local install.
 * Neither issued credentials nor authorization codes enter the proof output. */
export async function warehouseGrants({runtime,native}) {
  const redirect='https://synthetic-vector-51610.example.test/callback';
  const application=await native('/settings/oauth-apps','POST',{
    name:'synthetic-vector-51611',redirectUris:[redirect],
    scopes:['reports:read','issues:read','issues:write'],
  },201);
  const issue=async(scope)=>{
    const consent=await native('/oauth/consent','POST',{
      request:{response_type:'code',client_id:application.id,redirect_uri:redirect,scope,state:'synthetic-vector-51612'},
      decision:'approve',
    });
    const response=await runtime.req('/api/oauth/token',{
      method:'POST',headers:{'Content-Type':['application','json'].join('/')},
      body:JSON.stringify({grant_type:'authorization_code',client_id:application.id,
        client_secret:application.secret,redirect_uri:redirect,code:new URL(consent.redirect).searchParams.get('code')}),
    });
    assert.equal(response.status,200);
    const grant=await response.json();assert.equal(grant.scope,scope);
    return grant;
  };
  return {read:await issue('reports:read'),insufficient:await issue('issues:read')};
}
