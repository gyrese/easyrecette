import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { config } from '../../config.js';
import { prisma } from '../../database/client.js';

/**
 * Sessions serveur.
 *
 * Le cookie porte un secret aléatoire de 32 octets ; la base n'en garde que
 * le SHA-256. Une fuite de la base ne permet donc pas de se connecter, et le
 * serveur n'a jamais besoin de déchiffrer quoi que ce soit — il hache le
 * jeton reçu et cherche la ligne correspondante.
 *
 * Le hachage est un simple SHA-256, pas un bcrypt : le jeton est déjà 256
 * bits d'entropie tirés au sort, il n'y a pas de dictionnaire à ralentir.
 * Ce qui compte ici, c'est que le hachage soit rapide — il est fait à chaque
 * requête authentifiée.
 */

export const SESSION_COOKIE = 'er_session';

/** Nom du cookie qui transporte l'état OAuth entre le départ et le retour. */
export const OAUTH_STATE_COOKIE = 'er_oauth_state';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Crée la session et pose le cookie. Renvoie sa date d'expiration. */
export async function createSession(
  res: Response,
  userId: string,
  context: { userAgent?: string | undefined; ip?: string | undefined } = {},
): Promise<Date> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.auth.sessionTtlMs);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      expiresAt,
      userId,
      userAgent: context.userAgent?.slice(0, 300) ?? null,
      ip: context.ip ?? null,
    },
  });

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    /*
     * `lax` et non `strict` : le retour du callback Google est une navigation
     * cross-site, et un cookie `strict` ne serait pas renvoyé — l'utilisateur
     * arriverait déconnecté juste après s'être connecté.
     */
    sameSite: 'lax',
    secure: config.isProd,
    signed: true,
    expires: expiresAt,
    path: '/',
  });

  return expiresAt;
}

/**
 * Résout la session portée par un jeton de cookie.
 *
 * Une session expirée est supprimée au passage : la base se nettoie d'elle
 * même au fil des visites, sans tâche planifiée.
 */
export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    displayName: session.user.displayName,
    avatarUrl: session.user.avatarUrl,
  };
}

/** Détruit la session courante et efface le cookie. */
export async function destroySession(res: Response, token: string | undefined): Promise<void> {
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    signed: true,
    path: '/',
  });
}

/** Déconnecte toutes les sessions d'un compte (« se déconnecter partout »). */
export async function destroyAllSessions(userId: string): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { userId } });
  return result.count;
}

/**
 * Compare deux valeurs d'état OAuth sans fuite temporelle.
 *
 * L'état protège contre la CSRF sur le callback : un attaquant qui ferait
 * visiter à la victime une URL de callback forgée la connecterait sur SON
 * compte Google. Sans comparaison à temps constant, la vérification elle-même
 * donnerait des indices sur la valeur attendue.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Purge les sessions périmées. Appelée au démarrage. */
export async function cleanExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}
