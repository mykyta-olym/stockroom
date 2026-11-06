import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP's first choice of scrypt parameters: N=2^17, r=8, p=1. It needs about
// 128 MiB per hash, which is above the Node default limit of 32 MiB.
const COST_EXPONENT = 17;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 256 * 1024 * 1024;

type ScryptParams = {
  costExponent: number;
  blockSize: number;
  parallelization: number;
};

function derive(
  password: string,
  salt: Buffer,
  length: number,
  params: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      length,
      {
        N: 2 ** params.costExponent,
        r: params.blockSize,
        p: params.parallelization,
        maxmem: MAX_MEMORY,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

// The parameters are stored with the hash, so they can be raised later without
// breaking existing accounts.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, KEY_LENGTH, {
    costExponent: COST_EXPONENT,
    blockSize: BLOCK_SIZE,
    parallelization: PARALLELIZATION,
  });
  return [
    'scrypt',
    COST_EXPONENT,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, costExponent, blockSize, parallelization, saltText, keyText] = stored.split('$');
  if (scheme !== 'scrypt' || !saltText || !keyText) return false;

  const expected = Buffer.from(keyText, 'base64url');
  if (expected.length === 0) return false;

  const actual = await derive(password, Buffer.from(saltText, 'base64url'), expected.length, {
    costExponent: Number(costExponent),
    blockSize: Number(blockSize),
    parallelization: Number(parallelization),
  });
  return timingSafeEqual(actual, expected);
}

let decoyHash: Promise<string> | undefined;

// Spends the same time as a real check, so that a response time does not reveal
// whether an email belongs to an account.
export async function verifyAgainstDecoy(password: string): Promise<void> {
  decoyHash ??= hashPassword(randomBytes(SALT_LENGTH).toString('base64url'));
  await verifyPassword(password, await decoyHash);
}
