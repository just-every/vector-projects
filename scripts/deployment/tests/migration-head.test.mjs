import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { validateMigrations, migrate } from '@runeditrun/rer/internal/modules/deploy-kit/migrations.mjs';
import { hash } from '@runeditrun/rer/internal/modules/deploy-kit/validation.mjs';
import { cloudflare } from '@runeditrun/rer/internal/modules/deploy-kit/provider.mjs';
import { providerFixture } from './cloudflare-edge/index.mjs';

const dir = new URL('../../../migrations/core/', import.meta.url);
const sqlNames = async () => (await readdir(dir)).filter(name => name.endsWith('.sql')).sort();
const readMigrations = names => Promise.all(names.map(async name => {
  const sql = await readFile(new URL(name, dir), 'utf8');
  return { name, sql, sha256: hash(sql) };
}));

test('Vector deployment preserves owner and invitation guards, revokes removed operators and repeats without writes', async t => {
  const names = await sqlNames();
  const migrations = await readMigrations(names);
  const expectedHistory = migrations.map(({name,sha256})=>({name,sha256}));
  validateMigrations(migrations);

  const fixture = providerFixture(); t.after(() => fixture.close());
  const api = cloudflare({...fixture, budgetMigrations: true});
  const database = await api.request('/d1/database', {method: 'POST', body: {name: 'vector-complete-head'}});
  assert.deepEqual(await migrate(api, database.uuid, migrations), { applied: names, retried: [], history: expectedHistory });
  const db = fixture.state.databases[0].db;
  const ledger = () => db.prepare('SELECT name, sha256, state FROM d1_migrations ORDER BY id').all().map(row => ({ ...row }));
  const expectedLedger = expectedHistory.map(row => ({ ...row, state: 'applied' }));
  assert.deepEqual(ledger(), expectedLedger);
  db.exec("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES ('owner','owner@example.test','Owner','owner','active',1,0),('pending','pending@example.test','Pending','member','invited',1,0)");
  assert.throws(() => db.exec("DELETE FROM oa_operators WHERE id='owner'"), /last_owner/);
  assert.throws(() => db.exec("UPDATE oa_operators SET status='inactive' WHERE id='owner'"), /last_owner/);
  assert.throws(() => db.exec("UPDATE oa_operators SET role='member' WHERE id='owner'"), /last_owner/);
  db.exec("UPDATE oa_operators SET status='inactive' WHERE id='pending'");
  assert.deepEqual({ ...db.prepare("SELECT status,version FROM oa_operators WHERE id='pending'").get() }, { status: 'inactive', version: 2 });
  assert.deepEqual({ ...db.prepare("SELECT * FROM oa_invitation_cancellations WHERE operator_id='pending'").get() }, { operator_id: 'pending', operator_version: 2 });
  assert.throws(() => db.exec("UPDATE oa_operators SET status='active' WHERE id='pending'"), /invitation_required/);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.throws(() => db.exec("INSERT INTO oa_invitation_cancellations VALUES ('missing',1)"), /FOREIGN KEY/);
  assert.throws(() => db.exec("DELETE FROM oa_operators WHERE id='pending'"), /FOREIGN KEY/);

  db.exec(`INSERT INTO workspace_settings(id,name,timezone,created_at,updated_at) VALUES ('workspace','Workspace','UTC','2026-08-31','2026-08-31');
    INSERT INTO operators(id,workspace_id,name,email,created_at,updated_at) VALUES ('product','workspace','Product','product@example.test','2026-08-31','2026-08-31');`);
  assert.deepEqual({ ...db.prepare("SELECT * FROM vector_auth_operators WHERE operator_id='product'").get() }, { auth_id: 'product', operator_id: 'product' });
  // The workspace's last Owner is never removed (0075); a second Owner lets this one leave.
  assert.throws(() => db.exec("UPDATE operators SET removed_at='2026-09-01' WHERE id='product'"), /last_owner/);
  db.exec("INSERT INTO operators(id,workspace_id,name,email,created_at,updated_at) VALUES ('keeper','workspace','Keeper','keeper@example.test','2026-08-31','2026-08-31')");
  db.exec(`INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,return_to,created_at,expires_at) VALUES ('token','token-hash','magic','product',1,'/',0,9999999999999);
    INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,source_token_id,created_at,expires_at) VALUES ('session','session-hash','product',1,'native','token',0,9999999999999);
    UPDATE operators SET removed_at='2026-09-01' WHERE id='product';`);
  assert.deepEqual({ ...db.prepare("SELECT status,version FROM oa_operators WHERE id='product'").get() }, { status: 'inactive', version: 2 });
  assert.ok(db.prepare("SELECT revoked_at FROM oa_tokens WHERE id='token'").get().revoked_at > 0);
  assert.ok(db.prepare("SELECT revoked_at FROM oa_sessions WHERE id='session'").get().revoked_at > 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  const writes = fixture.state.writes.length;
  const changes = db.prepare('SELECT total_changes() n').get().n;
  assert.deepEqual(await migrate(api, database.uuid, migrations), { applied: [], retried: [], history: expectedHistory });
  assert.equal(fixture.state.writes.length, writes);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
  assert.deepEqual(ledger(), expectedLedger);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
