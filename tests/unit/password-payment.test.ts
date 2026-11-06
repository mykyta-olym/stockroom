import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { FakePaymentAdapter } from '@/server/payments/fake';
import { PaymentUnavailableError } from '@/server/payments/types';

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts, so equal passwords get different hashes', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(first).not.toBe(second);
  });

  it('records its parameters and leaks nothing of the password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt\$17\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(hash).not.toContain('horse');
  });

  it('treats Unicode forms of one password as equal', async () => {
    const hash = await hashPassword('café');
    expect(await verifyPassword('café', hash)).toBe(true);
  });

  it.each(['', 'plaintext', 'scrypt$17$8$1$', 'bcrypt$a$b$c$d$e'])(
    'rejects a stored value of %j',
    async (stored) => {
      expect(await verifyPassword('anything', stored)).toBe(false);
    },
  );
});

describe('FakePaymentAdapter', () => {
  const adapter = new FakePaymentAdapter();
  const request = {
    orderId: 'order',
    amountCents: 1000,
    currency: 'EUR',
    idempotencyKey: 'key-1',
    paymentToken: 'fake_approve',
  };

  it('calls itself fake, so orders record the truth', () => {
    expect(adapter.name).toBe('fake');
  });

  it('approves with a reference that says it is fake', async () => {
    const result = await adapter.charge(request);
    expect(result.status).toBe('approved');
    if (result.status === 'approved') expect(result.reference).toMatch(/^FAKE-/);
  });

  it('returns the same reference for a retried charge', async () => {
    expect(await adapter.charge(request)).toEqual(await adapter.charge(request));
    expect(await adapter.charge({ ...request, idempotencyKey: 'key-2' })).not.toEqual(
      await adapter.charge(request),
    );
  });

  it('declines on request', async () => {
    const result = await adapter.charge({ ...request, paymentToken: 'fake_decline' });
    expect(result.status).toBe('declined');
  });

  it('declines a token it does not know', async () => {
    const result = await adapter.charge({ ...request, paymentToken: 'tok_visa' });
    expect(result.status).toBe('declined');
  });

  it('can simulate an outage', async () => {
    await expect(adapter.charge({ ...request, paymentToken: 'fake_error' })).rejects.toThrow(
      PaymentUnavailableError,
    );
  });
});
