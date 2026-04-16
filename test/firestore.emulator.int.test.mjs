import test from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';

const host = process.env.FIRESTORE_EMULATOR_HOST;

if (!host) {
  test('firestore emulator integration (skipped)', { skip: true }, () => {});
} else {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'fidelity-test-project' });
  }
  const db = admin.firestore();

  test('firestore emulator wallet invariant sample', async () => {
    const uid = `u-${Date.now()}`;
    await db.collection('users').doc(uid).set({ wallet_balance: 1000 });
    await db.collection('transactions').add({ user_uid: uid, type: 'Deposit', amount: 250, status: 'Completed' });
    await db.collection('transactions').add({ user_uid: uid, type: 'Withdraw', amount: 100, status: 'Completed' });

    const tx = await db.collection('transactions').where('user_uid', '==', uid).get();
    let computed = 0;
    tx.docs.forEach((d) => {
      const t = d.data();
      const amt = Number(t.amount || 0);
      computed += t.type === 'Withdraw' ? -amt : amt;
    });
    assert.equal(computed, 150);
  });
}
