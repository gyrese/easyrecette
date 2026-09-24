import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/authController.js';
import * as importController from '../controllers/importController.js';
import * as recipeController from '../controllers/recipeController.js';
import * as shoppingController from '../controllers/shoppingListController.js';
import { attachUser, requireAuth } from '../middleware/auth.js';
import { MAX_PHOTO_BYTES } from '../services/media/storage.js';
import { isAiConfigured } from '../services/recipeAI/index.js';

/**
 * Table de routage de l'API.
 *
 * Deux limiteurs distincts (§19) : un généreux pour la navigation, un serré
 * pour l'import — qui déclenche des requêtes sortantes et des appels IA
 * payants, donc coûteux à laisser marteler. Un troisième, très serré, protège
 * la connexion : c'est la seule route qui crée des comptes.
 *
 * Deux périmètres d'accès, marqués explicitement route par route :
 *  - OUVERT : santé, connexion, page Découvrir, lecture d'une fiche. Un
 *    visiteur sans compte peut parcourir ce qui a été partagé ;
 *  - `requireAuth` : tout ce qui touche à SON fichier — importer, créer,
 *    modifier, noter, publier, faire ses courses.
 *
 * La protection est posée route par route, jamais « par défaut sauf
 * exception » : une nouvelle route arrive donc fermée si on écrit
 * `requireAuth`, et son absence se voit à la lecture de ce fichier.
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

/*
 * Connexion : 20 tentatives par minute et par IP. Large pour un usage normal
 * (un aller-retour OAuth en consomme deux), serré pour qui voudrait marteler
 * le callback avec des codes forgés.
 */
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Trop de tentatives de connexion. Attends une minute.',
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

// Résout la session si elle existe. Ne refuse rien : c'est `requireAuth`
// qui décide, route par route, si l'identité est obligatoire.
router.use(attachUser);

// --- Santé / configuration --- (OUVERT)
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', aiConfigured: isAiConfigured() });
});

// --- Authentification ---
// Les deux routes Google répondent par des redirections, pas du JSON : c'est
// le navigateur qui les suit. Voir authController pour le détail du flux.
router.get('/auth/google', authLimiter, authController.googleStart);
router.get('/auth/google/callback', authLimiter, wrap(authController.googleCallback));
// OUVERT : renvoie `user: null` plutôt qu'un 401 quand personne n'est connecté.
router.get('/auth/me', authController.me);
router.post('/auth/logout', wrap(authController.logout));
router.post('/auth/logout-all', requireAuth, wrap(authController.logoutEverywhere));
router.patch('/auth/profile', requireAuth, wrap(authController.updateProfile));
router.delete('/auth/account', requireAuth, wrap(authController.deleteAccount));

// --- Découvrir --- (OUVERT : les recettes partagées sont lisibles sans compte)
router.get('/discover', wrap(recipeController.discover));
router.get('/discover/facets', wrap(recipeController.discoverFacets));

// --- Import --- (réservé : un import coûte des appels IA facturés)
router.get('/import/detect', importController.detect);
router.post('/import', requireAuth, importLimiter, wrap(importController.create));
router.post('/import/manual', requireAuth, importLimiter, wrap(importController.manual));
router.get('/import/:id', requireAuth, wrap(importController.getOne));

// --- Recettes ---
router.get('/recipes', requireAuth, wrap(recipeController.list));
router.get('/recipes/facets', requireAuth, wrap(recipeController.facets));
// OUVERT : sert sa propre fiche ou n'importe quelle fiche publique. Une
// recette privée d'autrui répond 404 (voir getVisibleRecipe).
router.get('/recipes/:id', wrap(recipeController.getOne));
router.post('/recipes', requireAuth, wrap(recipeController.create));
router.patch('/recipes/:id', requireAuth, wrap(recipeController.update));
router.delete('/recipes/:id', requireAuth, wrap(recipeController.remove));
router.post('/recipes/:id/favorite', requireAuth, wrap(recipeController.favorite));
router.post('/recipes/:id/rating', requireAuth, wrap(recipeController.rate));
/*
 * Publication et copie.
 *
 * `visibility` n'est pas un champ de PATCH /recipes/:id : rendre une fiche
 * visible par des inconnus est un geste à part, qui ne doit pas pouvoir
 * partir d'un enregistrement de formulaire.
 */
router.post('/recipes/:id/visibility', requireAuth, wrap(recipeController.setVisibility));
router.post('/recipes/:id/copy', requireAuth, wrap(recipeController.copy));

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
  requireAuth,
  express.raw({ type: 'image/*', limit: MAX_PHOTO_BYTES }),
  wrap(recipeController.uploadPhoto),
);
router.delete('/recipes/:id/photo', requireAuth, wrap(recipeController.removePhoto));

// --- Liste de courses --- (entièrement personnelle)
router.use('/shopping-list', requireAuth);
router.get('/shopping-list', wrap(shoppingController.get));
router.post('/shopping-list/recipes', wrap(shoppingController.addRecipes));
router.post('/shopping-list/items', wrap(shoppingController.addItem));
router.post('/shopping-list/items/:itemId/toggle', wrap(shoppingController.toggleItem));
router.delete('/shopping-list/items/:itemId', wrap(shoppingController.removeItem));
router.delete('/shopping-list/recipes/:recipeId', wrap(shoppingController.removeRecipe));
router.delete('/shopping-list', wrap(shoppingController.clear));
