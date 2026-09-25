import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../database/client.js';
import { currentUser } from '../middleware/auth.js';
import {
  authenticateWithPassword,
  changePassword as changeAccountPassword,
  registerWithPassword,
  resolveUserFromGoogle,
} from '../services/auth/accounts.js';
import { buildAuthUrl, exchangeCodeForProfile } from '../services/auth/google.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../services/auth/password.js';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createSession,
  destroyAllSessions,
  destroySession,
  safeEqual,
  toSessionUser,
} from '../services/auth/session.js';
import { appError, isAppError } from '../utils/errors.js';

/**
 * Connexion, déconnexion, profil.
 *
 * Particularité de ce contrôleur : les deux routes du flux OAuth répondent
 * par des redirections, pas du JSON. C'est le navigateur qui les suit, pas
 * le code client — donc une erreur ne peut pas être affichée par le client
 * HTTP habituel. Elle est passée en paramètre de l'URL de retour, et l'appli
 * la présente à l'arrivée (voir client/src/pages/LoginPage.tsx).
 */

/** Cookie d'état OAuth : le temps d'un aller-retour chez Google, pas plus. */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Renvoie le navigateur vers l'appli avec un message d'erreur lisible.
 *
 * Le message part en clair dans l'URL : il est écrit pour l'utilisateur et ne
 * contient aucun détail technique (ceux-là sont journalisés côté serveur).
 */
function redirectWithError(res: Response, message: string): void {
  const url = new URL(`${config.auth.appUrl}/login`);
  url.searchParams.set('error', message);
  res.redirect(url.toString());
}

/** Démarre la connexion : pose l'état anti-CSRF et part chez Google. */
export function googleStart(req: Request, res: Response): void {
  if (!config.auth.googleConfigured) {
    redirectWithError(
      res,
      "La connexion Google n'est pas configurée sur ce serveur.",
    );
    return;
  }

  const state = randomBytes(24).toString('base64url');

  /*
   * La page d'arrivée voulue voyage avec l'état, dans le même cookie signé.
   * Elle ne peut donc pas être manipulée depuis l'URL — sans quoi un lien
   * forgé pourrait rediriger vers un site tiers après connexion.
   */
  const next = typeof req.query['next'] === 'string' ? req.query['next'] : '';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  res.cookie(OAUTH_STATE_COOKIE, `${state}:${safeNext}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    signed: true,
    maxAge: STATE_TTL_MS,
    path: '/',
  });

  res.redirect(buildAuthUrl(state));
}

/** Retour de Google : vérifie l'état, échange le code, ouvre la session. */
export async function googleCallback(req: Request, res: Response): Promise<void> {
  const clearState = (): void => {
    res.clearCookie(OAUTH_STATE_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.cookieSecure,
      signed: true,
      path: '/',
    });
  };

  // L'utilisateur a refusé l'autorisation : ce n'est pas une erreur, on le
  // ramène simplement à la page de connexion.
  if (typeof req.query['error'] === 'string') {
    clearState();
    redirectWithError(res, 'Connexion annulée.');
    return;
  }

  const code = typeof req.query['code'] === 'string' ? req.query['code'] : '';
  const state = typeof req.query['state'] === 'string' ? req.query['state'] : '';
  const stored = req.signedCookies?.[OAUTH_STATE_COOKIE];

  clearState();

  if (!code || !state || typeof stored !== 'string') {
    redirectWithError(res, 'Connexion expirée. Réessaie.');
    return;
  }

  const separator = stored.indexOf(':');
  const expectedState = separator === -1 ? stored : stored.slice(0, separator);
  const next = separator === -1 ? '/' : stored.slice(separator + 1) || '/';

  if (!safeEqual(state, expectedState)) {
    redirectWithError(res, 'Connexion invalide. Réessaie depuis la page de connexion.');
    return;
  }

  try {
    const profile = await exchangeCodeForProfile(code);
    const userId = await resolveUserFromGoogle(profile);

    await createSession(res, userId, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    const destination = new URL(`${config.auth.appUrl}${next}`);
    res.redirect(destination.toString());
  } catch (error) {
    // Le message métier (adresse non vérifiée, refus de Google…) est déjà
    // écrit pour l'utilisateur ; le reste reste vague et part dans les logs.
    if (isAppError(error)) {
      console.warn(`[auth] ${error.code} — ${error.detail ?? error.message}`);
      redirectWithError(res, error.message);
      return;
    }

    console.error('[auth] échec de la connexion Google', error);
    redirectWithError(res, 'La connexion a échoué. Réessaie dans un instant.');
  }
}

/**
 * Profil courant.
 *
 * Répond 200 avec `user: null` quand personne n'est connecté, plutôt qu'un
 * 401 : c'est la requête que fait l'appli au démarrage pour savoir dans quel
 * état s'afficher, et un 401 y serait un état normal déguisé en erreur.
 */
export function me(req: Request, res: Response): void {
  res.json({
    user: req.user ?? null,
    googleConfigured: config.auth.googleConfigured,
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.signedCookies?.[SESSION_COOKIE];
  await destroySession(res, typeof token === 'string' ? token : undefined);
  res.status(204).end();
}

/** Déconnecte tous les appareils — utile si un téléphone est perdu. */
export async function logoutEverywhere(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const count = await destroyAllSessions(user.id);
  const token = req.signedCookies?.[SESSION_COOKIE];
  await destroySession(res, typeof token === 'string' ? token : undefined);
  res.json({ sessions: count });
}

const profileSchema = z.object({
  /**
   * Nom d'auteur affiché sur les recettes publiques. Chaîne vide = revenir au
   * nom du compte.
   */
  displayName: z.string().trim().max(60).nullable(),
});

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const parsed = profileSchema.safeParse(req.body);

  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: 'Ce nom d’auteur est trop long (60 caractères maximum).',
      status: 422,
    });
  }

  const displayName = parsed.data.displayName?.trim() || null;

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { displayName },
  });

  res.json({ user: toSessionUser(updated) });
}

/**
 * Suppression du compte.
 *
 * Les recettes, imports, listes et sessions partent en cascade (voir
 * schema.prisma). Les recettes publiques copiées par d'autres restent chez
 * eux : ce sont désormais leurs fiches, `copiedFromId` passe simplement à
 * null.
 */
export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);

  const token = req.signedCookies?.[SESSION_COOKIE];
  await prisma.user.delete({ where: { id: user.id } });
  await destroySession(res, typeof token === 'string' ? token : undefined);

  res.status(204).end();
}

// ---------------------------------------------------------------------------
// E-mail + mot de passe
// ---------------------------------------------------------------------------

/*
 * Pas de règle de complexité (majuscule, chiffre, symbole…) : elles poussent
 * vers « Motdepasse1! » sans rendre les mots de passe plus sûrs. La longueur
 * est ce qui compte, d'où un minimum de 8 et une phrase de passe encouragée.
 */
const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`)
  .max(PASSWORD_MAX_LENGTH, `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`);

const signupSchema = z.object({
  email: z.string().trim().email('Cette adresse e-mail n\u2019est pas valide.').max(254),
  password: passwordField,
  name: z.string().trim().max(60).nullable().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().max(254),
  // Pas de minimum ici : un mot de passe trop court n'a qu'à échouer comme
  // les autres, sans message qui renseignerait sur la politique appliquée.
  password: z.string().max(PASSWORD_MAX_LENGTH),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH).nullable().optional(),
  newPassword: passwordField,
});

/** Premier message de validation Zod, déjà rédigé pour l'utilisateur. */
function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

/** Ouvre la session et renvoie le compte, comme /auth/me le ferait. */
async function openSession(req: Request, res: Response, userId: string): Promise<void> {
  await createSession(res, userId, { userAgent: req.get('user-agent'), ip: req.ip });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  res.json({ user: toSessionUser(user), googleConfigured: config.auth.googleConfigured });
}

export async function signup(req: Request, res: Response): Promise<void> {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: firstIssue(parsed.error, 'Inscription invalide.'),
      status: 422,
    });
  }

  const userId = await registerWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    name: parsed.data.name ?? null,
  });

  res.status(201);
  await openSession(req, res, userId);
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: 'Adresse ou mot de passe incorrect.',
      status: 401,
    });
  }

  const userId = await authenticateWithPassword(parsed.data.email, parsed.data.password);
  await openSession(req, res, userId);
}

/**
 * Change le mot de passe, puis ferme toutes les AUTRES sessions.
 *
 * C'est la raison la plus fréquente de changer de mot de passe : on craint
 * qu'il ait fuité. Laisser ouvertes les sessions d'un éventuel intrus rendrait
 * le changement inutile. La session courante est remplacée par une neuve pour
 * que l'utilisateur, lui, reste connecté.
 */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: firstIssue(parsed.error, 'Mot de passe invalide.'),
      status: 422,
    });
  }

  await changeAccountPassword(
    user.id,
    parsed.data.currentPassword ?? null,
    parsed.data.newPassword,
  );

  await destroyAllSessions(user.id);
  await createSession(res, user.id, { userAgent: req.get('user-agent'), ip: req.ip });

  const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  res.json({ user: toSessionUser(refreshed) });
}
