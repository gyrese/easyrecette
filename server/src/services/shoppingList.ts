import { prisma } from '../database/client.js';
import { addQuantities, ingredientSlug, normalizeUnit, scaleQuantity } from '../utils/units.js';

/**
 * Liste de courses (§12).
 *
 * Le point délicat est le regroupement : « 2 oignons » + « 1 oignon » = 3,
 * mais « 200 g de tomates » + « 3 tomates » ne doit PAS fusionner — les unités
 * sont incompatibles, additionner produirait un chiffre faux.
 *
 * La règle appliquée : on ne fusionne que si l'ingrédient canonique est le
 * même ET que addQuantities() accepte les deux unités. Sinon on garde deux
 * lignes distinctes, ce qui est plus honnête qu'un total approximatif.
 */

export interface ShoppingItemDto {
  id: string;
  quantity: number | null;
  unit: string | null;
  label: string;
  note: string | null;
  checked: boolean;
  isManual: boolean;
  recipeId: string | null;
  recipeTitle: string | null;
}

export interface ShoppingListDto {
  id: string;
  name: string;
  items: ShoppingItemDto[];
  /** Titres des recettes actuellement représentées dans la liste. */
  recipes: Array<{ id: string; title: string }>;
}

/** Chaque utilisateur a une liste courante, créée à la demande. */
async function getOrCreateList(userId: string) {
  const existing = await prisma.shoppingList.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;

  return prisma.shoppingList.create({ data: { userId } });
}

export async function getList(userId: string): Promise<ShoppingListDto> {
  const list = await getOrCreateList(userId);

  const items = await prisma.shoppingListItem.findMany({
    where: { listId: list.id },
    include: { recipe: { select: { id: true, title: true } } },
    orderBy: [{ checked: 'asc' }, { createdAt: 'asc' }],
  });

  const recipes = new Map<string, string>();
  for (const item of items) {
    if (item.recipe) recipes.set(item.recipe.id, item.recipe.title);
  }

  return {
    id: list.id,
    name: list.name,
    items: items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unit: item.unit,
      label: item.label,
      note: item.note,
      checked: item.checked,
      isManual: item.isManual,
      recipeId: item.recipeId,
      recipeTitle: item.recipe?.title ?? null,
    })),
    recipes: [...recipes.entries()].map(([id, title]) => ({ id, title })),
  };
}

export interface AddRecipesInput {
  recipeIds: string[];
  /** Portions souhaitées par recette : { recipeId: portions } */
  servings?: Record<string, number>;
}

/**
 * Ajoute une ou plusieurs recettes à la liste, en fusionnant ce qui peut l'être
 * avec les lignes déjà présentes.
 */
export async function addRecipes(
  userId: string,
  input: AddRecipesInput,
): Promise<ShoppingListDto> {
  const list = await getOrCreateList(userId);

  const recipes = await prisma.recipe.findMany({
    where: { id: { in: input.recipeIds }, userId },
    include: { ingredients: { include: { ingredient: true }, orderBy: { position: 'asc' } } },
  });

  for (const recipe of recipes) {
    const targetServings = input.servings?.[recipe.id];

    for (const item of recipe.ingredients) {
      // Mise à l'échelle si l'utilisateur a changé les portions avant d'ajouter.
      const scaled = scaleQuantity(
        item.quantity,
        item.unit,
        recipe.servings,
        targetServings ?? recipe.servings,
      );

      await mergeItem(list.id, {
        ingredientId: item.ingredientId,
        quantity: scaled.quantity,
        unit: scaled.unit,
        label: item.label ?? item.ingredient.name,
        note: item.note,
        recipeId: recipe.id,
      });
    }
  }

  return getList(userId);
}

interface MergeInput {
  ingredientId: string | null;
  quantity: number | null;
  unit: string | null;
  label: string;
  note: string | null;
  recipeId: string | null;
}

/**
 * Fusionne une ligne dans la liste si une ligne compatible existe déjà,
 * sinon en crée une nouvelle.
 */
async function mergeItem(listId: string, input: MergeInput): Promise<void> {
  const unit = normalizeUnit(input.unit);

  // Candidats : même ingrédient canonique, non coché (on ne modifie pas une
  // ligne que l'utilisateur a déjà mise dans son panier).
  const candidates = input.ingredientId
    ? await prisma.shoppingListItem.findMany({
        where: { listId, ingredientId: input.ingredientId, checked: false },
      })
    : await prisma.shoppingListItem.findMany({
        where: { listId, label: input.label, checked: false },
      });

  for (const candidate of candidates) {
    const merged = addQuantities(
      { quantity: candidate.quantity, unit: candidate.unit },
      { quantity: input.quantity, unit },
    );

    if (merged) {
      await prisma.shoppingListItem.update({
        where: { id: candidate.id },
        data: {
          quantity: merged.quantity,
          unit: merged.unit,
          // Une somme dont un terme est inconnu reste inconnue : on le dit.
          note:
            merged.quantity === null
              ? 'quantité non précisée dans une des recettes'
              : candidate.note,
        },
      });
      return;
    }
  }

  await prisma.shoppingListItem.create({
    data: {
      listId,
      ingredientId: input.ingredientId,
      quantity: input.quantity,
      unit,
      label: input.label,
      note: input.note,
      recipeId: input.recipeId,
    },
  });
}

export async function addManualItem(
  userId: string,
  label: string,
  quantity: number | null,
  unit: string | null,
): Promise<ShoppingListDto> {
  const list = await getOrCreateList(userId);

  // On rattache quand même à un Ingredient canonique : la ligne manuelle
  // « 2 oignons » doit pouvoir fusionner avec celle d'une recette.
  const slug = ingredientSlug(label);
  const ingredient = await prisma.ingredient.upsert({
    where: { slug },
    update: {},
    create: { name: label.trim().slice(0, 200), slug },
  });

  await mergeItem(list.id, {
    ingredientId: ingredient.id,
    quantity,
    unit,
    label: label.trim(),
    note: null,
    recipeId: null,
  });

  // isManual n'est pas géré par mergeItem (qui sert surtout aux recettes) :
  // on le pose sur la ligne si elle vient d'être créée sans recette.
  await prisma.shoppingListItem.updateMany({
    where: { listId: list.id, ingredientId: ingredient.id, recipeId: null },
    data: { isManual: true },
  });

  return getList(userId);
}

export async function toggleItem(
  userId: string,
  itemId: string,
): Promise<ShoppingListDto | null> {
  const list = await getOrCreateList(userId);
  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, listId: list.id },
  });
  if (!item) return null;

  await prisma.shoppingListItem.update({
    where: { id: itemId },
    data: { checked: !item.checked },
  });

  return getList(userId);
}

export async function removeItem(userId: string, itemId: string): Promise<ShoppingListDto> {
  const list = await getOrCreateList(userId);
  await prisma.shoppingListItem.deleteMany({ where: { id: itemId, listId: list.id } });
  return getList(userId);
}

/** Retire toutes les lignes venant d'une recette donnée. */
export async function removeRecipe(userId: string, recipeId: string): Promise<ShoppingListDto> {
  const list = await getOrCreateList(userId);
  await prisma.shoppingListItem.deleteMany({ where: { listId: list.id, recipeId } });
  return getList(userId);
}

export async function clearList(
  userId: string,
  options: { onlyChecked?: boolean } = {},
): Promise<ShoppingListDto> {
  const list = await getOrCreateList(userId);
  await prisma.shoppingListItem.deleteMany({
    where: { listId: list.id, ...(options.onlyChecked ? { checked: true } : {}) },
  });
  return getList(userId);
}
