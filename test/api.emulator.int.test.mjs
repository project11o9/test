import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) {
  test('api emulator integration (skipped)', { skip: true }, () => {});
} else {
  test('auth+csrf+idempotency flow', { timeout: 30000 }, async () => {
    const server = spawn('npm', ['run', 'dev'], {
      env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'test', JWT_SECRET: process.env.JWT_SECRET || 'test-secret' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server start timeout')), 15000);
        server.stdout.on('data', (d) => {
          if (String(d).includes('Server running on')) {
            clearTimeout(timer);
            resolve();
          }
        });
        server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
      });

      const email = `itest-${Date.now()}@example.com`;
      const registerRes = await fetch('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ITest', email, password: 'Secret123!' })
      });
      assert.equal(registerRes.status, 200);

      const setCookie = registerRes.headers.get('set-cookie') || '';
      const tokenCookie = /token=[^;]+/.exec(setCookie)?.[0];
      const csrfCookie = /csrf_token=[^;]+/.exec(setCookie)?.[0];
      const csrf = csrfCookie?.split('=')[1];
      assert.ok(tokenCookie && csrfCookie && csrf);
      const cookieHeader = `${tokenCookie}; ${csrfCookie}`;

      const failCsrf = await fetch('http://localhost:3000/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({ amount: 100 })
      });
      assert.equal(failCsrf.status, 403);

      const idemKey = `it-${Date.now()}`;
      const deposit1 = await fetch('http://localhost:3000/api/deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
          'x-csrf-token': csrf,
          'x-idempotency-key': idemKey,
          Origin: 'http://localhost:3000'
        },
        body: JSON.stringify({ amount: 100 })
      });
      assert.equal(deposit1.status, 200);
      const d1 = await deposit1.json();

      const deposit2 = await fetch('http://localhost:3000/api/deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
          'x-csrf-token': csrf,
          'x-idempotency-key': idemKey,
          Origin: 'http://localhost:3000'
        },
        body: JSON.stringify({ amount: 100 })
      });
      assert.equal(deposit2.status, 200);
      const d2 = await deposit2.json();
      assert.equal(d2.idempotentReplay, true);
      assert.equal(d1.id, d2.id);
    } finally {
      server.kill('SIGTERM');
    }
  });
}
