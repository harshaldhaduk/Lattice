import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TokenPayload {
  userId: string;
  email: string;
  roles: string[];
  iat: number;
  exp: number;
}

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

// ── verifyToken ───────────────────────────────────────────────────────────────
// Validates the Bearer token from the Authorization header.
// Demo conflict target: Agent A and Human B both want to modify this function.

export function verifyToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = decodeToken(token);

    if (Date.now() / 1000 > payload.exp) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── createSession ─────────────────────────────────────────────────────────────
// Creates a signed session token for a verified user.
// Demo conflict target: same file, different function — will produce REVIEW verdict.

export function createSession(userId: string, email: string, roles: string[]): string {
  const payload: TokenPayload = {
    userId,
    email,
    roles,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  };
  return encodeToken(payload);
}

// ── requireRole ───────────────────────────────────────────────────────────────
// Role-based access control middleware.

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    const hasRole = roles.some(r => req.user!.roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: `Requires one of: ${roles.join(', ')}` });
      return;
    }
    next();
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const SECRET = process.env.JWT_SECRET ?? 'demo-secret-change-in-production';

function encodeToken(payload: TokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function decodeToken(token: string): TokenPayload {
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig !== expected) throw new Error('Invalid signature');
  return JSON.parse(Buffer.from(data, 'base64url').toString()) as TokenPayload;
}
