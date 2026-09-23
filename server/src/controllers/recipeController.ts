import type { Request, Response } from 'express';
import { getCurrentUserId } from '../database/client.js';
import * as repo from '../database/recipeRepository.js';
import {
  rateRecipeSchema,
  recipeQuerySchema,
  saveRecipeSchema,
  updateRecipeSchema,
} from '../schemas/recipe.js';
import { isSupportedPhotoType, MAX_PHOTO_BYTES } from '../services/media/storage.js';
import { appError } from '../utils/errors.js';

/**
 * Controllers recettes.
 *
 * Chaque handler suit le même contrat : valider l'entrée avec Zod, déléguer au
 * repository, renvoyer du JSON. Les erreurs sont levées et traitées par le
 * middleware d'erreur central — pas de try/catch ici.
 */

export async function list(req: Request, res: Response): Promise<void> {
  const parsed = recipeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: 'Paramètres de recherche invalides.',
      detail: parsed.error.issues.map((i) => i.path.join('.')).join(', '),
    });
  }

  const userId = await getCurrentUserId();
  const result = await repo.listRecipes(userId, parsed.data);
  res.json(result);
}

export async function facets(_req: Request, res: Response): Promise<void> {
  const userId = await getCurrentUserId();
  res.json(await repo.getFilterFacets(userId));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const userId = await getCurrentUserId();
  const recipe = await repo.getRecipe(userId, req.params['id'] ?? '');

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

export async function create(req: Request, res: Response): Promise<void> {
  const parsed = saveRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: 'La recette envoyée est incomplète.',
      detail: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' ; '),
      status: 422,
    });
  }

  const userId = await getCurrentUserId();
  const recipe = await repo.createRecipe(userId, parsed.data);
  res.status(201).json(recipe);
}

export async function update(req: Request, res: Response): Promise<void> {
  const parsed = updateRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: 'Les modifications envoyées sont invalides.',
      detail: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' ; '),
      status: 422,
    });
  }

  const userId = await getCurrentUserId();
  const recipe = await repo.updateRecipe(userId, req.params['id'] ?? '', parsed.data);

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const userId = await getCurrentUserId();
  const deleted = await repo.deleteRecipe(userId, req.params['id'] ?? '');

  if (!deleted) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.status(204).end();
}

/**
 * Note d'essai (1..5), ou `rating: null` pour retirer la note.
 *
 * Endpoint distinct de PATCH /recipes/:id plutôt qu'un champ de plus dans
 * `updateRecipeSchema` : noter une recette qu'on vient de cuisiner et
 * corriger sa liste d'ingrédients sont deux gestes différents, et le premier
 * doit pouvoir partir d'un simple clic sur une étoile sans réenvoyer la
 * recette entière.
 */
export async function rate(req: Request, res: Response): Promise<void> {
  const parsed = rateRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: 'La note doit être comprise entre 1 et 5 étoiles.',
      detail: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' ; '),
      status: 422,
    });
  }

  const userId = await getCurrentUserId();
  const recipe = await repo.rateRecipe(userId, req.params['id'] ?? '', parsed.data);

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

/**
 * Dépose la photo du plat.
 *
 * Le corps est le fichier brut (voir express.raw dans routes/index.ts) et le
 * type vient de l'en-tête `Content-Type`. Pas de multipart : une seule image
 * par requête, donc l'enveloppe n'apporterait rien et coûterait une
 * dépendance de plus à auditer.
 *
 * Le type annoncé est vérifié contre la liste blanche avant toute écriture —
 * on ne devine jamais le format d'après le nom du fichier.
 */
export async function uploadPhoto(req: Request, res: Response): Promise<void> {
  const mime = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';

  if (!isSupportedPhotoType(mime)) {
    throw appError('INVALID_INPUT', {
      message: 'Format non pris en charge. Utilise une image JPEG, PNG ou WebP.',
      detail: `Content-Type reçu : ${mime || '(absent)'}`,
      status: 415,
    });
  }

  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw appError('INVALID_INPUT', {
      message: "Aucune image n'a été reçue.",
      status: 422,
    });
  }

  // express.raw rejette déjà au-delà de la limite ; ce contrôle couvre le cas
  // où la limite viendrait à diverger de MAX_PHOTO_BYTES.
  if (body.length > MAX_PHOTO_BYTES) {
    throw appError('TOO_LARGE', {
      message: `Cette image dépasse ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} Mo.`,
      status: 413,
    });
  }

  const userId = await getCurrentUserId();
  const recipe = await repo.setUserPhoto(userId, req.params['id'] ?? '', body, mime);

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

/** Retire la photo : la fiche retrouve l'image de sa source. */
export async function removePhoto(req: Request, res: Response): Promise<void> {
  const userId = await getCurrentUserId();
  const recipe = await repo.removeUserPhoto(userId, req.params['id'] ?? '');

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

export async function favorite(req: Request, res: Response): Promise<void> {
  const userId = await getCurrentUserId();
  const recipe = await repo.toggleFavorite(userId, req.params['id'] ?? '');

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}
