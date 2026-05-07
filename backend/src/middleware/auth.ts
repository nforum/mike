/**
 * JWT-based auth middleware for MikeOSS.
 *
 * Validates JWTs issued by eulex.ai WordPress OAuth 2.1 server
 * (eulex-mcp-oauth.php). On first login, auto-creates the user
 * in Cloud SQL using data from the JWT payload.
 *
 * @module auth
 */

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { getPool } from '../lib/db';

/**
 * JWT payload structure from eulex-mcp-oauth.php L553-564.
 * The `sub` field contains the WordPress user_id (not UUID).
 */
interface EulexJwtPayload {
  iss: string;          // "https://eulex.ai/"
  sub: string;          // WP user_id as string
  email: string;
  name: string;
  tier: 'free' | 'plus';
  tier_level_id: number;
  tier_expires: string | null;
  scope: string;        // "mike:projects mike:documents mike:chat"
  aud: string;          // "mike" (audience-separated from eulex-mcp)
  iat: number;
  exp: number;
}

/**
 * Express middleware: validates Bearer JWT and populates res.locals.
 *
 * Sets:
 *   - res.locals.userId    (uuid — Cloud SQL users.id)
 *   - res.locals.userEmail (string)
 *   - res.locals.wpUserId  (number — WordPress user_id)
 *   - res.locals.tier      ('free' | 'plus')
 *   - res.locals.scope     (string — space-separated scopes)
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ detail: 'Missing or invalid Authorization header' });
    return;
  }

  const secret = process.env.EULEX_MCP_JWT_SECRET;
  if (!secret) {
    console.error('[auth] EULEX_MCP_JWT_SECRET not configured');
    res.status(500).json({ detail: 'Server auth is not configured' });
    return;
  }

  try {
    const token = auth.slice(7).trim();
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'https://eulex.ai/',
      audience: ['mike', 'eulex-mcp'],
    }) as EulexJwtPayload;

    const wpUserId = parseInt(decoded.sub, 10);
    if (isNaN(wpUserId)) {
      res.status(401).json({ detail: 'Invalid token subject' });
      return;
    }

    // Lookup or auto-create user in Cloud SQL
    const pool = await getPool();
    let { rows } = await pool.query(
      'SELECT id, email FROM users WHERE wp_user_id = $1',
      [wpUserId],
    );

    if (rows.length === 0) {
      // First login: try email match (migration from Supabase)
      const emailMatch = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND wp_user_id IS NULL',
        [decoded.email],
      );

      if (emailMatch.rows.length > 0) {
        // Link existing Supabase-migrated user to WP ID
        const updateResult = await pool.query(
          'UPDATE users SET wp_user_id = $1, display_name = COALESCE(display_name, $2) WHERE id = $3 RETURNING id, email',
          [wpUserId, decoded.name, emailMatch.rows[0].id],
        );
        rows = updateResult.rows;
      } else {
        // Brand new user — create from JWT data
        const insertResult = await pool.query(
          `INSERT INTO users (wp_user_id, email, display_name)
           VALUES ($1, $2, $3) RETURNING id, email`,
          [wpUserId, decoded.email, decoded.name],
        );
        rows = insertResult.rows;
      }
    }

    res.locals.userId = rows[0].id;
    res.locals.userEmail = rows[0].email;
    res.locals.wpUserId = wpUserId;
    res.locals.tier = decoded.tier;
    res.locals.scope = decoded.scope;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ detail: 'Token expired', code: 'TOKEN_EXPIRED' });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ detail: 'Invalid token', code: 'TOKEN_INVALID' });
    } else {
      console.error('[auth] Authentication error:', err);
      res.status(401).json({ detail: 'Authentication failed' });
    }
  }
}
