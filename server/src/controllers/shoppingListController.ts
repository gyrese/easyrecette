import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUserId } from '../middleware/auth.js';
import * as service from '../services/shoppingList.js';
import { appError } from '../utils/errors.js';

const addRecipesSchema = z.object({
  recipeIds: z.array(z.string().cuid()).min(1).max(50),
  servings: z.record(z.coerce.number().int().min(1).max(100)).optional(),
});

const addItemSchema = z.object({
  label: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(100_000).nullable().default(null),
  unit: z.string().trim().max(32).nullable().default(null),
});

export async function get(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  res.json(await service.getList(userId));
}

export async function addRecipes(req: Request, res: Response): Promise<void> {
  const parsed = addRecipesSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', { message: 'Aucune recette sélectionnée.', status: 422 });
  }

  const userId = currentUserId(req);
  res.json(await service.addRecipes(userId, parsed.data));
}

export async function addItem(req: Request, res: Response): Promise<void> {
  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) {
    throw appError('INVALID_INPUT', { message: 'Article invalide.', status: 422 });
  }

  const userId = currentUserId(req);
  const { label, quantity, unit } = parsed.data;
  res.json(await service.addManualItem(userId, label, quantity, unit));
}

export async function toggleItem(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const result = await service.toggleItem(userId, req.params['itemId'] ?? '');

  if (!result) {
    throw appError('NOT_FOUND', { message: "Cet article n'existe pas.", status: 404 });
  }

  res.json(result);
}

export async function removeItem(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  res.json(await service.removeItem(userId, req.params['itemId'] ?? ''));
}

export async function removeRecipe(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  res.json(await service.removeRecipe(userId, req.params['recipeId'] ?? ''));
}

export async function clear(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const onlyChecked = req.query['checked'] === '1' || req.query['checked'] === 'true';
  res.json(await service.clearList(userId, { onlyChecked }));
}
