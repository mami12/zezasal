/**
 * Authentication: bcrypt password hashes + JWT bearer tokens.
 *
 * Tokens carry only the user id; the user is loaded from the database on every request
 * so a role change, freeze or ban takes effect immediately.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.mjs';
import { createUser, findUserByUsername, getUserById, publicUser } from './store.mjs';
import {pool} from '../db.mjs';
import {withDatabaseRequest} from '../database-request-context.mjs';

export const hashPassword = (plain) => bcrypt.hashSync(String(plain), 10);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(String(plain), String(hash ?? ''));

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role,epoch:Number(user.financialEpoch??0) }, config.jwtSecret, {
    expiresIn: config.jwtTtl,
  });
}

/** returns { token, user } or null when the credentials are wrong / the account is blocked */
export async function authenticate(username, password) {
  const row = await findUserByUsername(String(username ?? '').trim());
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;

  const user = publicUser(row);
  return { token: signToken(user), user };
}

function readToken(req) {
  const header = req.get('authorization') ?? '';
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  try {
    return jwt.verify(value, config.jwtSecret);
  } catch {
    return null;
  }
}

export async function requireAuth(req, res, next) {
  const payload = readToken(req);
  if (!payload?.sub) return res.status(401).json({ message: 'not authenticated' });

  const generation=pool.generation;
  const user = await getUserById(payload.sub);
  if (!user) return res.status(401).json({ message: 'account no longer exists' });
  if (user.status === 'BANNED') return res.status(403).json({ message: 'account is banned' });
  if(Number(payload.epoch??0)!==Number(user.financialEpoch??0))return res.status(401).json({message:'Sesioni përfundoi pas zerimit financiar. Identifikohu përsëri.'});

  req.user = user;
  return withDatabaseRequest(pool,generation,next);
}

export const requireAdmin = (req, res, next) =>
  req.user?.role === 'ADMIN' ? next() : res.status(403).json({ message: 'admin only' });

export const requireManager = (req, res, next) =>
  req.user?.role === 'MANAGER' ? next() : res.status(403).json({ message: 'manager only' });

/**
 * Creates the default accounts on boot when they are missing, so a fresh database is
 * immediately usable. Disable with SEED_DEFAULT_ACCOUNTS=false and change the passwords.
 */
export async function ensureDefaultAccounts() {
  if (!config.seedDefaultAccounts) return;

  const wanted = [
    { username: config.adminUser, password: config.adminPassword, role: 'ADMIN', balance: 0 },
    { username: config.demoUser, password: config.demoPassword, role: 'PLAYER', balance: 1000 },
  ];

  for (const account of wanted) {
    const existing = await findUserByUsername(account.username);
    if (existing) continue;
    await createUser({
      username: account.username,
      passwordHash: hashPassword(account.password),
      role: account.role,
      balance: account.balance,
    });
    console.warn(
      `[auth] created default ${account.role.toLowerCase()} account "${account.username}" - change this password before going live`,
    );
  }
}
