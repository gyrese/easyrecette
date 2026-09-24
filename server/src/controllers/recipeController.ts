import type { Request, Response } from 'express';
import { currentUserId, optionalUserId } from '../middleware/auth.js';
import * as repo from '../database/recipeRepository.js';
import {
  discoverQuerySchema,
  rateRecipeSchema,
  recipeQuerySchema,
  saveRecipeSchema,
  updateRecipeSchema,
  visibilitySchema,
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

  const userId = currentUserId(req);
  const result = await repo.listRecipes(userId, parsed.data);
  res.json(result);
}

export async function facets(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  res.json(await repo.getFilterFacets(userId));
}

/**
 * Lecture d'une fiche.
 *
 * Route ouverte : elle sert aussi bien sa propre recette qu'une fiche publique
 * partagée par quelqu'un d'autre, y compris à un visiteur sans compte. Le
 * périmètre est décidé par la requête SQL (voir getVisibleRecipe), pas ici.
 *
 * Une recette privée d'autrui répond 404, pas 403 : dire « interdit »
 * confirmerait son existence à qui essaie des identifiants au hasard.
 */
export async function getOne(req: Request, res: Response): Promise<void> {
  const viewerId = optionalUserId(req);
  const recipe = await repo.getVisibleRecipe(viewerId, req.params['id'] ?? '');

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

  const userId = currentUserId(req);
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

  const userId = currentUserId(req);
  const recipe = await repo.updateRecipe(userId, req.params['id'] ?? '', parsed.data);

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
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

  const userId = currentUserId(req);
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

  const userId = currentUserId(req);
  const recipe = await repo.setUserPhoto(userId, req.params['id'] ?? '', body, mime);

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

/** Retire la photo : la fiche retrouve l'image de sa source. */
export async function removePhoto(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const recipe = await repo.removeUserPhoto(userId, req.params['id'] ?? '');

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

export async function favorite(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const recipe = await repo.toggleFavorite(userId, req.params['id'] ?? '');

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

// ---------------------------------------------------------------------------
// Partage public
// ---------------------------------------------------------------------------

/**
 * Publie ou dépublie une recette.
 *
 * Réservé au propriétaire : `setVisibility` filtre sur `userId`, donc une
 * tentative sur la fiche d'autrui répond 404 comme si elle n'existait pas.
 */
export async function setVisibility(req: Request, res: Response): Promise<void> {
  const parsed = visibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: 'Indique si la recette doit être publique ou privée.',
      detail: parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
      status: 422,
    });
  }

  const userId = currentUserId(req);
  const recipe = await repo.setVisibility(userId, req.params['id'] ?? '', parsed.data);

  if (!recipe) {
    throw appError('NOT_FOUND', { message: "Cette recette n'existe pas.", status: 404 });
  }

  res.json(recipe);
}

/** Page Découvrir. Ouverte : un visiteur sans compte peut parcourir. */
export async function discover(req: Request, res: Response): Promise<void> {
  const parsed = discoverQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', {
      message: 'Paramètres de recherche invalides.',
      detail: parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
    });
  }

  const viewerId = optionalUserId(req);
  res.json(await repo.listPublicRecipes(viewerId, parsed.data));
}

export async function discoverFacets(_req: Request, res: Response): Promise<void> {
  res.json(await repo.getPublicFacets());
}

/**
 * Enregistre une copie d'une recette publique dans son propre fichier.
 *
 * Copie plutôt que simple mise en favori : une fois enregistrée, la recette
 * est à soi — modifiable, notable, et elle survit à la dépublication de
 * l'originale. Mettre un lien en favori exposerait à voir une fiche
 * disparaître de sa propre bibliothèque du jour au lendemain.
 */
export async function copy(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const recipe = await repo.copyPublicRecipe(userId, req.params['id'] ?? '');

  if (!recipe) {
    throw appError('NOT_FOUND', {
      message: "Cette recette n'est pas ou plus partagée.",
      status: 404,
    });
  }

  res.status(201).json(recipe);
}
