import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contract = JSON.parse(fs.readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));

test('openapi file exists and has required paths', () => {
  assert.equal(contract.openapi, '3.0.3');
  const paths = contract.paths || {};
  const required = [
    '/api/health',
    '/api/openapi',
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/csrf',
    '/api/user/profile',
    '/api/wallet',
    '/api/deposit',
    '/api/withdraw',
    '/api/reviews/submit',
    '/api/spin/claim',
    '/api/admin/deposits/{id}/decision',
    '/api/admin/withdraws/{id}/decision',
    '/api/admin/reconcile/user/{uid}',
    '/api/admin/audit-logs/export'
  ];
  for (const p of required) {
    assert.ok(paths[p], `Missing contract path: ${p}`);
  }
});
