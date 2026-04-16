import test from 'node:test';
import assert from 'node:assert/strict';

function calculateCommission(rating) {
  if (rating === 5) return 300;
  if (rating === 4) return 200;
  return 0;
}

function approveDeposit(balance, amount, status = 'pending') {
  if (status !== 'pending') throw new Error('already processed');
  return { balance: balance + amount, status: 'approved' };
}

function approveWithdraw(balance, amount, status = 'pending') {
  if (status !== 'pending') throw new Error('already processed');
  if (balance < amount) throw new Error('insufficient balance');
  return { balance: balance - amount, status: 'approved' };
}

test('commission policy', () => {
  assert.equal(calculateCommission(5), 300);
  assert.equal(calculateCommission(4), 200);
  assert.equal(calculateCommission(3), 0);
});

test('deposit approval updates wallet and status', () => {
  const out = approveDeposit(1000, 250);
  assert.equal(out.balance, 1250);
  assert.equal(out.status, 'approved');
});

test('withdraw approval enforces invariant', () => {
  const out = approveWithdraw(1000, 300);
  assert.equal(out.balance, 700);
  assert.equal(out.status, 'approved');
  assert.throws(() => approveWithdraw(200, 300), /insufficient balance/);
});
