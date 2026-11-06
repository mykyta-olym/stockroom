import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { adminUsers, loginAttempts, sessions } from '../db/schema';
import { hashPassword, verifyAgainstDecoy, verifyPassword } from './password';

export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export type AdminUser = { id: string; email: string };

export type SignInResult =
  { ok: true; token: string; expiresAt: Date } | { ok: false; reason: 'invalid' | 'throttled' };

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createAdminUser(db: Db, email: string, password: string): Promise<AdminUser> {
  const [user] = await db
    .insert(adminUsers)
    .values({ email: email.toLowerCase(), passwordHash: await hashPassword(password) })
    .returning({ id: adminUsers.id, email: adminUsers.email });
  if (!user) throw new Error('Inserting the admin user returned no row.');
  return user;
}

export async function createSession(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function findSessionUser(
  db: Db,
  token: string,
  now = new Date(),
): Promise<AdminUser | null> {
  const [row] = await db
    .select({ id: adminUsers.id, email: adminUsers.email })
    .from(sessions)
    .innerJoin(adminUsers, eq(adminUsers.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)));
  return row ?? null;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

// The attempt is recorded before the password is checked. Parallel guesses
// therefore count each other, and a burst cannot slip past the limit.
export async function signIn(
  db: Db,
  rawEmail: string,
  password: string,
  now = new Date(),
): Promise<SignInResult> {
  const email = rawEmail.trim().toLowerCase();
  await db.insert(loginAttempts).values({ email, createdAt: now });

  const windowStart = new Date(now.getTime() - LOGIN_ATTEMPT_WINDOW_MS);
  const [attempts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.createdAt, windowStart)));
  if ((attempts?.count ?? 0) > MAX_LOGIN_ATTEMPTS) {
    return { ok: false, reason: 'throttled' };
  }

  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  if (!user) {
    await verifyAgainstDecoy(password);
    return { ok: false, reason: 'invalid' };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, reason: 'invalid' };
  }

  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  const session = await createSession(db, user.id, now);
  return { ok: true, ...session };
}
