import { z } from 'zod';
import { PLATFORMS } from './recipe.js';

/**
 * Étapes affichées dans l'UI pendant un import.
 *
 * L'ordre du tableau est l'ordre d'affichage. Une étape n'est marquée `done`
 * que lorsque le backend l'a réellement franchie : c'est la contrainte du §2
 * du cahier des charges (« ne jamais afficher un faux succès »). Une étape
 * non applicable à la source est marquée `skipped`, pas `done`.
 */
export const IMPORT_STEP_KEYS = [
  'source-detected',
  'content-fetched',
  'media-analyzed',
  'transcript-ready',
  'ingredients-found',
  'steps-generated',
  'recipe-ready',
] as const;
export type ImportStepKey = (typeof IMPORT_STEP_KEYS)[number];

export const IMPORT_STEP_LABELS: Record<ImportStepKey, string> = {
  'source-detected': 'Source détectée',
  'content-fetched': 'Contenu récupéré',
  'media-analyzed': 'Vidéo analysée',
  'transcript-ready': 'Transcription terminée',
  'ingredients-found': 'Ingrédients identifiés',
  'steps-generated': 'Étapes générées',
  'recipe-ready': 'Recette prête',
};

export const importStepSchema = z.object({
  key: z.enum(IMPORT_STEP_KEYS),
  status: z.enum(['pending', 'running', 'done', 'skipped', 'failed']),
  /** Précision affichée sous l'étape : "Sous-titres indisponibles" */
  detail: z.string().max(200).nullable().default(null),
  at: z.string().datetime().nullable().default(null),
});
export type ImportStep = z.infer<typeof importStepSchema>;

export const IMPORT_STATUSES = [
  'pending',
  'fetching',
  'transcribing',
  'generating',
  'ready',
  'failed',
  'saved',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Codes d'erreur applicatifs — mappés vers un message FR côté client. */
export const IMPORT_ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_URL',
  'BLOCKED_URL',
  'UNSUPPORTED_PLATFORM',
  'NOT_FOUND',
  'PRIVATE_CONTENT',
  'LOGIN_REQUIRED',
  'RATE_LIMITED',
  'TIMEOUT',
  'TOO_LARGE',
  'NO_TRANSCRIPT',
  'NO_CONTENT',
  'NOT_A_RECIPE',
  'AI_UNAVAILABLE',
  'AI_INVALID_JSON',
  'AI_ERROR',
  'INTERNAL',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export const createImportSchema = z.object({
  url: z.string().trim().min(1).max(2048),
});

/**
 * Reprise manuelle : l'utilisateur colle lui-même le texte quand la source
 * est inaccessible (vidéo privée, page protégée…). On repart alors
 * directement à l'étape de génération IA.
 */
export const manualImportSchema = z.object({
  /** URL d'origine, conservée pour l'attribution. Facultative. */
  url: z.string().trim().max(2048).optional(),
  platform: z.enum(PLATFORMS).optional(),
  title: z.string().trim().max(400).optional(),
  author: z.string().trim().max(200).optional(),
  /** Le texte collé : description, transcription, recette brute… */
  text: z.string().trim().min(20, 'Colle au moins quelques lignes de texte.').max(100_000),
});
export type ManualImportInput = z.infer<typeof manualImportSchema>;

/**
 * Format commun rendu par tous les importers (§3 du cahier des charges).
 * Un importer ne fait que collecter : il ne juge pas, n'interprète pas,
 * et laisse à `null` tout ce qu'il n'a pas pu obtenir.
 */
export const extractedContentSchema = z.object({
  sourceUrl: z.string(),
  platform: z.enum(PLATFORMS),
  title: z.string().nullable(),
  author: z.string().nullable(),
  description: z.string().nullable(),
  /** Corps de texte principal, nettoyé du HTML. */
  text: z.string().nullable(),
  /** Sous-titres ou transcription, si réellement accessibles. */
  transcript: z.string().nullable(),
  images: z.array(z.string()),
  /** Métadonnées brutes utiles au débogage et à l'attribution. */
  metadata: z.record(z.unknown()),
  /**
   * Recette déjà structurée trouvée dans la page (Schema.org / JSON-LD).
   * Si présente, on évite un appel IA — cf. §4.
   */
  structuredRecipe: z.unknown().nullable().default(null),
  /** Journal de ce que l'importer a réellement réussi à faire. */
  notes: z.array(z.string()).default([]),
});
export type ExtractedContent = z.infer<typeof extractedContentSchema>;
