import { expect } from 'vitest';
import { bindings, origin, request } from './base-auth-fixture';
import type { setupIntegrations } from './integration-fixture';
import { jsonMediaType } from '../../src/core/features/oauth-apps/media-types';

type Fixture = Awaited<ReturnType<typeof setupIntegrations>>;
const json = async (response: Response, status = 200): Promise<any> => {
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json();
};

/** Issue actual, separately consented grants through the mounted OAuth doors.
 * A warehouse consumer must not inherit the application's broader permissions. */
export async function warehouseGrants(f: Fixture, cookie: string) {
  const redirect = 'https://synthetic-vector-51523.example.test/callback';
  const application = await json(await f.call('/settings/oauth-apps', 'POST', {
    name: 'synthetic-vector-51524', redirectUris: [redirect],
    scopes: ['reports:read', 'issues:read', 'issues:write'],
  }), 201);
  const issue = async (scope: string) => {
    const consent = await json(await request('/api/oauth/consent', 'POST', {
      request: {
        response_type: 'code', client_id: application.id, redirect_uri: redirect,
        scope, state: 'synthetic-vector-51525',
      }, decision: 'approve',
    }, cookie));
    const code = new URL(consent.redirect).searchParams.get('code');
    const grant = await json(await f.app.request(origin + '/api/oauth/token', {
      method: 'POST', headers: { 'Content-Type': jsonMediaType },
      body: JSON.stringify({
        grant_type: 'authorization_code', client_id: application.id,
        client_secret: application.secret, redirect_uri: redirect, code,
      }),
    }, bindings));
    expect(grant.scope).toBe(scope);
    return grant as { access_token: string; grant_id: string; scope: string };
  };
  return { read: await issue('reports:read'), insufficient: await issue('issues:read') };
}
