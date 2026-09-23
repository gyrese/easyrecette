import type { ImportErrorCode } from '../schemas/import.js';

/**
 * Erreur applicative porteuse d'un code, d'un message destiné à l'utilisateur
 * et d'un indicateur de reprise manuelle.
 *
 * Principe : tout ce qui remonte à l'utilisateur doit être compréhensible et
 * honnête (§15). On ne masque jamais un échec derrière un succès partiel.
 */
export class AppError extends Error {
  readonly code: ImportErrorCode;
  readonly status: number;
  /** true quand coller le texte à la main peut débloquer la situation. */
  readonly canRetryManually: boolean;
  /** Détail technique, journalisé mais pas affiché tel quel. */
  readonly detail?: string;

  constructor(
    code: ImportErrorCode,
    message: string,
    options: { status?: number; canRetryManually?: boolean; detail?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? 400;
    this.canRetryManually = options.canRetryManually ?? false;
    this.detail = options.detail;
  }
}

/** Messages par défaut, en français, prêts à être affichés. */
export const ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  INVALID_INPUT: 'Les données envoyées sont invalides.',
  INVALID_URL: "Cette adresse n'est pas une URL valide.",
  BLOCKED_URL: "Cette adresse pointe vers une ressource interne et ne peut pas être importée.",
  UNSUPPORTED_PLATFORM: "Cette plateforme n'est pas encore prise en charge.",
  NOT_FOUND: "La publication est introuvable : elle a peut-être été supprimée.",
  PRIVATE_CONTENT: "Cette publication est privée ou protégée, son contenu n'est pas accessible.",
  LOGIN_REQUIRED: "Cette plateforme exige une connexion pour afficher ce contenu.",
  RATE_LIMITED: "Trop de requêtes vers cette source. Réessaie dans quelques minutes.",
  TIMEOUT: "La source a mis trop de temps à répondre.",
  TOO_LARGE: 'Le contenu est trop volumineux pour être analysé.',
  NO_TRANSCRIPT: "Aucun sous-titre ni transcription n'est disponible pour cette vidéo.",
  NO_CONTENT: "Aucun texte exploitable n'a pu être récupéré depuis cette source.",
  NOT_A_RECIPE: "Ce contenu ne semble pas contenir de recette de cuisine.",
  AI_UNAVAILABLE: "Aucun service d'IA n'est configuré sur le serveur.",
  AI_INVALID_JSON: "L'IA a renvoyé une réponse inexploitable.",
  AI_ERROR: "Le service d'IA a rencontré une erreur.",
  INTERNAL: 'Une erreur interne est survenue.',
};

export function appError(
  code: ImportErrorCode,
  options: {
    message?: string;
    status?: number;
    canRetryManually?: boolean;
    detail?: string;
    cause?: unknown;
  } = {},
): AppError {
  return new AppError(code, options.message ?? ERROR_MESSAGES[code], options);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
