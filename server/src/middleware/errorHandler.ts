import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { config } from '../config.js';
import { isAppError } from '../utils/errors.js';

/**
 * Traitement centralisé des erreurs.
 *
 * Format de réponse unique, que le client sait afficher :
 *   { error: { code, message, canRetryManually } }
 *
 * `message` est toujours en français et destiné à l'utilisateur. Le détail
 * technique n'est exposé qu'en développement — en production il part dans les
 * logs, jamais dans la réponse (ça peut contenir des chemins ou des bouts de
 * configuration).
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (isAppError(error)) {
    if (error.detail) console.warn(`[${error.code}] ${error.message} — ${error.detail}`);

    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        canRetryManually: error.canRetryManually,
        ...(config.isProd ? {} : { detail: error.detail }),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'INVALID_INPUT',
        message: 'Les données envoyées sont invalides.',
        canRetryManually: false,
        ...(config.isProd
          ? {}
          : { detail: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ; ') }),
      },
    });
    return;
  }

  /*
   * Corps trop volumineux, levé par express.json / express.raw avant même
   * d'atteindre un handler. Sans ce cas, déposer une photo trop lourde
   * répondrait « erreur interne » alors que le problème est parfaitement
   * compréhensible et corrigeable par l'utilisateur.
   */
  if (
    error instanceof Error &&
    (error as { type?: string }).type === 'entity.too.large'
  ) {
    res.status(413).json({
      error: {
        code: 'TOO_LARGE',
        message: 'Ce fichier est trop volumineux.',
        canRetryManually: false,
      },
    });
    return;
  }

  // Erreur non prévue : on journalise la trace complète côté serveur et on
  // reste vague côté client.
  console.error('[erreur non gérée]', error);

  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Une erreur interne est survenue.',
      canRetryManually: false,
      ...(config.isProd ? {} : { detail: error instanceof Error ? error.message : String(error) }),
    },
  });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route inconnue : ${req.method} ${req.path}`,
      canRetryManually: false,
    },
  });
};
