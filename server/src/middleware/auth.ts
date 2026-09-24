import type { Request, RequestHandler, Response } from 'express';
import { SESSION_COOKIE, resolveSession, type SessionUser } from '../services/auth/session.js';
import { appError } from '../utils/errors.js';

/**
 * Authentification par cookie de session.
 *
 * Deux middlewares distincts, volontairement :
 *  - `attachUser` résout la session si elle existe et laisse passer. Il est
 *    monté sur toute l'API : les routes publiques ont ainsi accès à
 *    l'identité quand il y en a une (pour savoir si une recette publique
 *    appartient déjà au visiteur, par exemple) ;
 *  - `requireAuth` refuse la requête en l'absence de session. Il protège tout
 *    ce qui touche au fichier personnel.
 *
 * La séparation évite le piège classique du middleware unique qui « laisse
 * passer si public » : ici, une route est protégée parce qu'on l'a
 * explicitement déclarée telle, jamais par défaut ni par oubli.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Renseigné par `attachUser` ; undefined si visiteur anonyme. */
      user?: SessionUser;
    }
  }
}

/** Lit le cookie signé de session. */
function sessionToken(req: Request): string | undefined {
  const value = req.signedCookies?.[SESSION_COOKIE];
  // `false` = cookie présent mais signature invalide : à traiter comme absent.
  return typeof value === 'string' && value ? value : undefined;
}

export const attachUser: RequestHandler = (req, _res, next) => {
  resolveSession(sessionToken(req))
    .then((user) => {
      if (user) req.user = user;
      next();
    })
    .catch(next);
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (req.user) {
    next();
    return;
  }

  next(
    appError('INVALID_INPUT', {
      message: 'Connecte-toi pour accéder à cette page.',
      status: 401,
    }),
  );
};

/**
 * Identité de la requête, pour les handlers protégés.
 *
 * Lève si elle est absente plutôt que de renvoyer `undefined` : un handler
 * monté derrière `requireAuth` ne doit pas avoir à gérer ce cas, et un
 * oubli de `requireAuth` se manifeste alors par un 401 franc au lieu d'une
 * requête silencieusement exécutée sans propriétaire.
 */
export function currentUser(req: Request): SessionUser {
  if (!req.user) {
    throw appError('INVALID_INPUT', {
      message: 'Connecte-toi pour accéder à cette page.',
      status: 401,
    });
  }
  return req.user;
}

export function currentUserId(req: Request): string {
  return currentUser(req).id;
}

/** Identité si elle existe, `null` sinon — pour les routes publiques. */
export function optionalUserId(req: Request): string | null {
  return req.user?.id ?? null;
}

export type { SessionUser, Response };
