import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import * as importController from '../controllers/importController.js';
import * as recipeController from '../controllers/recipeController.js';
import * as shoppingController from '../controllers/shoppingListController.js';
import { MAX_PHOTO_BYTES } from '../services/media/storage.js';
import { isAiConfigured } from '../services/recipeAI/index.js';

/**
 * Table de routage de l'API.
 *
 * Deux limiteurs distincts (§19) : un généreux pour la navigation, un serré
 * pour l'import — qui déclenche des requêtes sortantes et des appels IA
 * payants, donc coûteux à laisser marteler.
 */

const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Trop de requêtes. Patiente un instant.' } },
});

const importLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: "Trop d'imports d'affilée. Attends une minute avant de réessayer.",
    },
  },
});

/**
 * Les handlers sont `async` ; Express 4 ne propage pas automatiquement leurs
 * rejets vers le middleware d'erreur. Ce wrapper s'en charge.
 * (Express 5 le fera nativement — ce helper pourra alors disparaître.)
 */
function wrap(
  handler: (req: Request, res: Response) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

export const router = Router();

router.use(generalLimiter);

// --- Santé / configuration ---
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', aiConfigured: isAiConfigured() });
});

// --- Import ---
router.get('/import/detect', importController.detect);
router.post('/import', importLimiter, wrap(importController.create));
router.post('/import/manual', importLimiter, wrap(importController.manual));
router.get('/import/:id', wrap(importController.getOne));

// --- Recettes ---
router.get('/recipes', wrap(recipeController.list));
router.get('/recipes/facets', wrap(recipeController.facets));
router.get('/recipes/:id', wrap(recipeController.getOne));
router.post('/recipes', wrap(recipeController.create));
router.patch('/recipes/:id', wrap(recipeController.update));
router.delete('/recipes/:id', wrap(recipeController.remove));
router.post('/recipes/:id/favorite', wrap(recipeController.favorite));
router.post('/recipes/:id/rating', wrap(recipeController.rate));

/*
 * Photo du plat : corps binaire brut, pas de multipart.
 *
 * `type` accepte n'importe quelle image pour que le contrôleur puisse
 * répondre « format non pris en charge » sur un GIF ou un SVG ; si ce
 * middleware filtrait lui-même, le corps arriverait vide et l'utilisateur
 * lirait « aucune image reçue », ce qui ne lui dirait pas quoi corriger.
 *
 * La limite est la même valeur que celle contrôlée dans le handler, pour
 * qu'un dépassement soit toujours signalé de la même façon.
 */
router.put(
  '/recipes/:id/photo',
  express.raw({ type: 'image/*', limit: MAX_PHOTO_BYTES }),
  wrap(recipeController.uploadPhoto),
);
router.delete('/recipes/:id/photo', wrap(recipeController.removePhoto));

// --- Liste de courses ---
router.get('/shopping-list', wrap(shoppingController.get));
router.post('/shopping-list/recipes', wrap(shoppingController.addRecipes));
router.post('/shopping-list/items', wrap(shoppingController.addItem));
router.post('/shopping-list/items/:itemId/toggle', wrap(shoppingController.toggleItem));
router.delete('/shopping-list/items/:itemId', wrap(shoppingController.removeItem));
router.delete('/shopping-list/recipes/:recipeId', wrap(shoppingController.removeRecipe));
router.delete('/shopping-list', wrap(shoppingController.clear));
