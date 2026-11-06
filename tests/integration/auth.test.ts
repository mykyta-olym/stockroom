import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAdminUser,
  createSession,
  deleteSession,
  findSessionUser,
  MAX_LOGIN_ATTEMPTS,
  SESSION_LIFETIME_MS,
  signIn,
} from '@/server/auth/sessions';
import { adminUsers, sessions } from '@/server/db/schema';
import { emptyDatabase, openDb } from './helpers';

const handle = openDb(10);
const db = handle.db;

const email = 'admin@example.test';
const password = 'correct horse battery';

beforeAll(async () => {
  await emptyDatabase(db);
});

beforeEach(async () => {
  await emptyDatabase(db);
  await createAdminUser(db, email, password);
});

afterAll(async () => {
  await handle.pool.end();
});

describe('signIn', () => {
  it('accepts the right password and opens a session', async () => {
    const result = await signIn(db, email, password);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await findSessionUser(db, result.token)).toMatchObject({ email });
  });

  it('ignores case and spaces in the email', async () => {
    const result = await signIn(db, '  ADMIN@Example.test ', password);
    expect(result.ok).toBe(true);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const wrongPassword = await signIn(db, email, 'wrong password here');
    const unknownAccount = await signIn(db, 'nobody@example.test', password);

    expect(wrongPassword).toEqual({ ok: false, reason: 'invalid' });
    expect(unknownAccount).toEqual(wrongPassword);
  });

  it('stores a hash, never the password', async () => {
    const [user] = await db.select().from(adminUsers);
    expect(user?.passwordHash).not.toContain(password);
    expect(user?.passwordHash).toMatch(/^scrypt\$/);
  });

  it('stores a hash of the session token, never the token', async () => {
    const result = await signIn(db, email, password);
    if (!result.ok) throw new Error('Expected a session.');

    const [row] = await db.select().from(sessions);

    expect(row?.tokenHash).not.toBe(result.token);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('locks an account after too many attempts, even with the right password', async () => {
    for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
      expect(await signIn(db, email, 'wrong password here')).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
    expect(await signIn(db, email, password)).toEqual({ ok: false, reason: 'throttled' });
  });

  it('opens again once the window has passed', async () => {
    for (let attempt = 0; attempt <= MAX_LOGIN_ATTEMPTS; attempt += 1) {
      await signIn(db, email, 'wrong password here');
    }
    const later = new Date(Date.now() + 16 * 60_000);
    const result = await signIn(db, email, password, later);
    expect(result.ok).toBe(true);
  });

  it('forgets earlier failures after a successful sign-in', async () => {
    for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS - 1; attempt += 1) {
      await signIn(db, email, 'wrong password here');
    }
    expect((await signIn(db, email, password)).ok).toBe(true);
    expect(await signIn(db, email, 'wrong password here')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('cannot be beaten by guessing in parallel', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => signIn(db, email, 'wrong password here')),
    );
    const checked = results.filter((result) => !result.ok && result.reason === 'invalid');
    const refused = results.filter((result) => !result.ok && result.reason === 'throttled');

    // How many get through depends on timing. The limit does not.
    expect(checked.length).toBeLessThanOrEqual(MAX_LOGIN_ATTEMPTS);
    expect(checked.length + refused.length).toBe(20);
  });

  it('keeps one account locked without affecting another', async () => {
    await createAdminUser(db, 'second@example.test', password);
    for (let attempt = 0; attempt <= MAX_LOGIN_ATTEMPTS; attempt += 1) {
      await signIn(db, email, 'wrong password here');
    }
    expect((await signIn(db, 'second@example.test', password)).ok).toBe(true);
  });
});

describe('sessions', () => {
  it('rejects an unknown token', async () => {
    expect(await findSessionUser(db, 'made-up-token')).toBeNull();
  });

  it('expires', async () => {
    const result = await signIn(db, email, password);
    if (!result.ok) throw new Error('Expected a session.');
    const justBefore = new Date(result.expiresAt.getTime() - 1000);
    const justAfter = new Date(result.expiresAt.getTime() + 1000);

    expect(await findSessionUser(db, result.token, justBefore)).not.toBeNull();
    expect(await findSessionUser(db, result.token, justAfter)).toBeNull();
  });

  it('lasts for the configured time', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const [user] = await db.select().from(adminUsers);
    if (!user) throw new Error('Expected the admin user.');

    const session = await createSession(db, user.id, now);

    expect(session.expiresAt.getTime() - now.getTime()).toBe(SESSION_LIFETIME_MS);
  });

  it('ends on sign-out', async () => {
    const result = await signIn(db, email, password);
    if (!result.ok) throw new Error('Expected a session.');

    await deleteSession(db, result.token);

    expect(await findSessionUser(db, result.token)).toBeNull();
  });

  it('removes expired sessions on the next sign-in', async () => {
    const first = await signIn(db, email, password);
    if (!first.ok) throw new Error('Expected a session.');

    const later = new Date(first.expiresAt.getTime() + 1000);
    await signIn(db, email, password, later);

    expect(await db.select().from(sessions)).toHaveLength(1);
  });
});
