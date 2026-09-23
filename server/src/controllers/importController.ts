import type { Request, Response } from 'express';
import { getCurrentUserId } from '../database/client.js';
import { createImportSchema, manualImportSchema } from '../schemas/import.js';
import { PLATFORM_LABELS } from '../schemas/recipe.js';
import { cleanUrl, detectPlatform } from '../services/importers/index.js';
import { getImport, runImport, runManualImport } from '../services/importPipeline.js';
import { isAiConfigured } from '../services/recipeAI/index.js';
import { appError } from '../utils/errors.js';

/**
 * Controllers d'import.
 *
 * Note sur les codes HTTP : un import qui échoue renvoie 200 avec
 * `status: "failed"` et le détail de l'erreur, PAS un code 4xx. La requête
 * a bien abouti — c'est l'import qui n'a pas pu se faire, et le client a
 * besoin du journal d'étapes pour afficher où ça a bloqué.
 */

/** Détection côté client, dès le collage de l'URL. */
export function detect(req: Request, res: Response): void {
  const raw = typeof req.query['url'] === 'string' ? req.query['url'] : '';

  if (!raw.trim()) {
    res.json({ platform: null, label: null, valid: false });
    return;
  }

  const url = cleanUrl(raw);
  let valid = false;
  try {
    const parsed = new URL(url);
    valid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    valid = false;
  }

  const platform = valid ? detectPlatform(url) : null;

  res.json({
    platform,
    label: platform ? PLATFORM_LABELS[platform] : null,
    valid,
    aiConfigured: isAiConfigured(),
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const parsed = createImportSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_URL', { message: 'Aucune URL fournie.' });
  }

  const userId = await getCurrentUserId();
  const result = await runImport(userId, parsed.data.url);

  res.status(200).json(result);
}

export async function manual(req: Request, res: Response): Promise<void> {
  const parsed = manualImportSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('NO_CONTENT', {
      message:
        parsed.error.issues[0]?.message ?? 'Le texte fourni est trop court pour en tirer une recette.',
      status: 422,
    });
  }

  const userId = await getCurrentUserId();
  const existingId = typeof req.body?.importId === 'string' ? req.body.importId : undefined;
  const result = await runManualImport(userId, parsed.data, existingId);

  res.status(200).json(result);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const userId = await getCurrentUserId();
  const record = await getImport(userId, req.params['id'] ?? '');

  if (!record) {
    throw appError('NOT_FOUND', { message: "Cet import n'existe pas.", status: 404 });
  }

  res.json(record);
}
