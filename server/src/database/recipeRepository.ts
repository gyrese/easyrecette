import type { Prisma } from '@prisma/client';
import { prisma } from './client.js';
import {
  type DiscoverQuery,
  type GeneratedRecipe,
  type RateRecipeInput,
  type RecipeQuery,
  type SaveRecipeInput,
  type UpdateRecipeInput,
  type VisibilityInput,
} from '../schemas/recipe.js';
import { parseList, serializeList } from '../utils/json.js';
import { ingredientSlug, normalizeUnit } from '../utils/units.js';
import {
  attachVideoToRecipe,
  deleteRecipeMedia,
  deleteUserPhoto,
  isStepImageOf,
  saveUserPhoto,
} from '../services/media/storage.js';
import { canIllustrateSteps, scheduleStepFrames } from '../services/media/stepFrames.js';
import { publicAuthorName } from '../services/auth/accounts.js';

/**
 * Accès aux recettes.
 *
 * Tout passe par ici : les controllers ne touchent jamais Prisma directement.
 * Deux responsabilités : la traduction entre le modèle relationnel et la
 * structure `GeneratedRecipe` manipulée par l'API et le client, et la
 * déduplication des ingrédients (indispensable pour la liste de courses).
 */

/** Forme complète chargée depuis la base, relations comprises. */
const recipeInclude = {
  ingredients: {
    include: { ingredient: true },
    orderBy: { position: 'asc' },
  },
  steps: { orderBy: { order: 'asc' } },
  tags: { include: { tag: true } },
  /*
   * L'auteur est chargé avec la recette pour pouvoir l'afficher sur la page
   * Découvrir. Seuls le nom d'affichage et l'identifiant sortent du serveur :
   * l'adresse e-mail n'est jamais exposée, y compris sur une fiche publique.
   */
  user: { select: { id: true, name: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.RecipeInclude;

type RecipeWithRelations = Prisma.RecipeGetPayload<{ include: typeof recipeInclude }>;

export interface RecipeAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface RecipeDto extends GeneratedRecipe {
  id: string;
  /// Vidéo d'origine conservée localement, servie sous /media.
  videoUrl: string | null;
  posterUrl: string | null;
  /// Illustration des étapes en tâche de fond. Voir services/media/stepFrames.ts.
  stepFramesStatus: 'pending' | 'done' | 'failed' | null;
  /// Photo du plat prise par l'utilisateur. Prime sur `imageUrl` à l'affichage.
  userPhotoUrl: string | null;
  isFavorite: boolean;
  /// 1..5 une fois la recette essayée, null tant qu'elle ne l'a pas été.
  rating: number | null;
  ratingNote: string | null;
  triedAt: string | null;
  createdAt: string;
  updatedAt: string;
  importedAt: string | null;

  /// Partagée avec tout le monde. Voir setVisibility().
  isPublic: boolean;
  publishedAt: string | null;
  /// Nombre de fois que la fiche a été copiée par d'autres utilisateurs.
  copyCount: number;
  /// Auteur, pour l'attribution sur la page Découvrir.
  author: RecipeAuthor;
  /// Renseigné quand la fiche est une copie d'une recette publique.
  copiedFromId: string | null;
  /**
   * true quand la fiche est consultée par quelqu'un d'autre que son auteur.
   * Le client s'en sert pour masquer les gestes qui ne le concernent pas
   * (éditer, noter, supprimer) plutôt que de les afficher puis échouer en 403.
   */
  isOwner: boolean;
}

/**
 * Traduction vers le DTO de l'API.
 *
 * `viewerId` décide de deux choses : le drapeau `isOwner`, et l'effacement
 * des champs personnels. Une recette publique consultée par un tiers ne doit
 * pas révéler la note que son auteur lui a donnée, son commentaire d'essai ni
 * son statut de favori : ce sont des annotations privées, pas du contenu
 * partagé. Les omettre ici — au seul endroit qui construit les réponses —
 * garantit qu'aucun futur endpoint ne pourra les laisser fuir par oubli.
 */
export function toDto(recipe: RecipeWithRelations, viewerId: string | null = null): RecipeDto {
  const isOwner = viewerId !== null && recipe.userId === viewerId;

  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description ?? '',
    servings: recipe.servings,
    servingsDeduced: recipe.servingsDeduced,
    prepTime: recipe.prepTime,
    cookingTime: recipe.cookingTime,
    totalTime: recipe.totalTime,
    difficulty: recipe.difficulty as RecipeDto['difficulty'],
    category: recipe.category as RecipeDto['category'],
    cuisine: recipe.cuisine,
    imageUrl: recipe.imageUrl,
    videoUrl: recipe.videoUrl,
    posterUrl: recipe.posterUrl,
    stepFramesStatus: recipe.stepFramesStatus as RecipeDto['stepFramesStatus'],
    userPhotoUrl: recipe.userPhotoUrl,

    ingredients: recipe.ingredients.map((item) => ({
      quantity: item.quantity,
      unit: item.unit,
      ingredient: item.label ?? item.ingredient.name,
      preparation: item.preparation,
      note: item.note,
      section: item.section,
      isDeduced: item.isDeduced,
    })),

    steps: recipe.steps.map((step) => ({
      order: step.order,
      title: step.title,
      instruction: step.instruction,
      duration: step.duration,
      temperature: step.temperature,
      isDeduced: step.isDeduced,
      videoTime: step.videoTime,
      imageUrl: step.imageUrl,
    })),

    equipment: parseList(recipe.equipment),
    tips: parseList(recipe.tips),
    tags: recipe.tags.map((link) => link.tag.name),

    source: {
      platform: (recipe.sourcePlatform ?? 'manual') as RecipeDto['source']['platform'],
      url: recipe.sourceUrl,
      author: recipe.sourceAuthor,
      originalTitle: recipe.sourceTitle,
    },

    confidence: recipe.confidence ?? 1,
    warnings: parseList(recipe.warnings),

    // Annotations privées : neutralisées pour un visiteur tiers.
    isFavorite: isOwner ? recipe.isFavorite : false,
    rating: isOwner ? recipe.rating : null,
    ratingNote: isOwner ? recipe.ratingNote : null,
    triedAt: isOwner ? (recipe.triedAt?.toISOString() ?? null) : null,

    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
    importedAt: recipe.importedAt?.toISOString() ?? null,

    isPublic: recipe.isPublic,
    publishedAt: recipe.publishedAt?.toISOString() ?? null,
    copyCount: recipe.copyCount,
    author: {
      id: recipe.user.id,
      name: publicAuthorName(recipe.user),
      avatarUrl: recipe.user.avatarUrl,
    },
    copiedFromId: recipe.copiedFromId,
    isOwner,
  };
}

/**
 * Récupère ou crée l'Ingredient canonique correspondant à un nom.
 * La déduplication se fait sur le slug ("Oignons rouges" et "oignon rouge"
 * pointent vers la même ligne), ce qui permet de regrouper les courses.
 */
async function resolveIngredientId(
  tx: Prisma.TransactionClient,
  name: string,
): Promise<string> {
  const slug = ingredientSlug(name);

  const existing = await tx.ingredient.findUnique({ where: { slug } });
  if (existing) return existing.id;

  const created = await tx.ingredient.create({
    data: { name: name.trim().slice(0, 200), slug },
  });
  return created.id;
}

/** Idem pour les tags. */
async function resolveTagId(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const slug = ingredientSlug(name);
  const existing = await tx.tag.findUnique({ where: { slug } });
  if (existing) return existing.id;

  const created = await tx.tag.create({
    data: { name: name.trim().slice(0, 60), slug },
  });
  return created.id;
}

export async function createRecipe(
  userId: string,
  input: SaveRecipeInput,
): Promise<RecipeDto> {
  const recipe = await prisma.$transaction(async (tx) => {
    const created = await tx.recipe.create({
      data: {
        userId,
        title: input.title,
        description: input.description || null,
        imageUrl: input.imageUrl,
        servings: input.servings,
        servingsDeduced: input.servingsDeduced ?? false,
        prepTime: input.prepTime,
        cookingTime: input.cookingTime,
        totalTime: input.totalTime,
        difficulty: input.difficulty,
        category: input.category,
        cuisine: input.cuisine,
        equipment: serializeList(input.equipment),
        tips: serializeList(input.tips),
        confidence: input.confidence,
        warnings: serializeList(input.warnings),
        sourceUrl: input.source.url,
        sourcePlatform: input.source.platform,
        sourceAuthor: input.source.author,
        sourceTitle: input.source.originalTitle,
        importedAt: input.source.platform === 'manual' ? null : new Date(),
        steps: {
          create: input.steps.map((step, index) => ({
            order: index + 1,
            title: step.title,
            instruction: step.instruction,
            duration: step.duration,
            temperature: step.temperature,
            isDeduced: step.isDeduced ?? false,
          })),
        },
      },
    });

    // Ingrédients : résolus un par un pour garantir l'unicité du slug.
    for (const [index, item] of input.ingredients.entries()) {
      const ingredientId = await resolveIngredientId(tx, item.ingredient);
      await tx.recipeIngredient.create({
        data: {
          recipeId: created.id,
          ingredientId,
          quantity: item.quantity,
          unit: normalizeUnit(item.unit),
          label: item.ingredient,
          preparation: item.preparation,
          note: item.note,
          section: item.section,
          position: index,
          isDeduced: item.isDeduced ?? false,
        },
      });
    }

    for (const tagName of input.tags) {
      const tagId = await resolveTagId(tx, tagName);
      await tx.recipeTag.create({ data: { recipeId: created.id, tagId } });
    }

    if (input.importId) {
      await tx.import.update({
        where: { id: input.importId },
        data: { status: 'saved', recipeId: created.id },
      });
    }

    return tx.recipe.findUniqueOrThrow({
      where: { id: created.id },
      include: recipeInclude,
    });
  });

  /*
   * Rattachement de la vidéo, hors transaction.
   *
   * Ce sont des opérations de fichiers : les inclure dans la transaction
   * la ferait durer le temps d'un déplacement de fichier et d'un appel à
   * ffmpeg, et un échec disque annulerait l'enregistrement d'une recette
   * par ailleurs valide. La recette prime ; la vidéo est un complément.
   */
  let saved = recipe;

  if (input.importId) {
    try {
      const media = await attachVideoToRecipe(input.importId, recipe.id);
      if (media) {
        saved = await prisma.recipe.update({
          where: { id: recipe.id },
          data: {
            videoUrl: media.videoUrl,
            posterUrl: media.posterUrl,
            // L'image extraite de la vidéo illustre la fiche quand la
            // plateforme n'en fournissait pas.
            ...(recipe.imageUrl ? {} : { imageUrl: media.posterUrl }),
          },
          include: recipeInclude,
        });
      }
    } catch (error) {
      console.warn('[media] rattachement de la vidéo impossible :', error);
    }
  }

  /*
   * Illustration des étapes, en tâche de fond : la réponse part tout de
   * suite avec le statut « pending », les images arrivent ensuite.
   */
  if (canIllustrateSteps(saved)) {
    saved = await prisma.recipe.update({
      where: { id: recipe.id },
      data: { stepFramesStatus: 'pending' },
      include: recipeInclude,
    });
    scheduleStepFrames(recipe.id);
  }

  return toDto(saved, userId);
}

export async function updateRecipe(
  userId: string,
  recipeId: string,
  input: UpdateRecipeInput,
): Promise<RecipeDto | null> {
  const existing = await prisma.recipe.findFirst({ where: { id: recipeId, userId } });
  if (!existing) return null;

  const recipe = await prisma.$transaction(async (tx) => {
    await tx.recipe.update({
      where: { id: recipeId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description || null }),
        ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
        ...(input.servings !== undefined && { servings: input.servings }),
        ...(input.servingsDeduced !== undefined && { servingsDeduced: input.servingsDeduced }),
        ...(input.prepTime !== undefined && { prepTime: input.prepTime }),
        ...(input.cookingTime !== undefined && { cookingTime: input.cookingTime }),
        ...(input.totalTime !== undefined && { totalTime: input.totalTime }),
        ...(input.difficulty !== undefined && { difficulty: input.difficulty }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.cuisine !== undefined && { cuisine: input.cuisine }),
        ...(input.equipment !== undefined && { equipment: serializeList(input.equipment) }),
        ...(input.tips !== undefined && { tips: serializeList(input.tips) }),
        ...(input.isFavorite !== undefined && { isFavorite: input.isFavorite }),
      },
    });

    // Étapes et ingrédients : remplacement intégral. Plus simple et plus sûr
    // qu'un diff, et le volume est petit (quelques dizaines de lignes).
    if (input.steps) {
      await tx.recipeStep.deleteMany({ where: { recipeId } });
      for (const [index, step] of input.steps.entries()) {
        await tx.recipeStep.create({
          data: {
            recipeId,
            order: index + 1,
            title: step.title,
            instruction: step.instruction,
            duration: step.duration,
            temperature: step.temperature,
            isDeduced: step.isDeduced ?? false,
            // Repris tels que le client les renvoie, l'image seulement si
            // c'est bien un fichier produit pour cette recette.
            videoTime: step.videoTime,
            imageUrl:
              step.imageUrl && isStepImageOf(recipeId, step.imageUrl) ? step.imageUrl : null,
          },
        });
      }
    }

    if (input.ingredients) {
      await tx.recipeIngredient.deleteMany({ where: { recipeId } });
      for (const [index, item] of input.ingredients.entries()) {
        const ingredientId = await resolveIngredientId(tx, item.ingredient);
        await tx.recipeIngredient.create({
          data: {
            recipeId,
            ingredientId,
            quantity: item.quantity,
            unit: normalizeUnit(item.unit),
            label: item.ingredient,
            preparation: item.preparation,
            note: item.note,
            section: item.section,
            position: index,
            isDeduced: item.isDeduced ?? false,
          },
        });
      }
    }

    if (input.tags) {
      await tx.recipeTag.deleteMany({ where: { recipeId } });
      for (const tagName of input.tags) {
        const tagId = await resolveTagId(tx, tagName);
        await tx.recipeTag.create({ data: { recipeId, tagId } });
      }
    }

    return tx.recipe.findUniqueOrThrow({ where: { id: recipeId }, include: recipeInclude });
  });

  return toDto(recipe, userId);
}

export async function getRecipe(userId: string, recipeId: string): Promise<RecipeDto | null> {
  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, userId },
    include: recipeInclude,
  });
  return recipe ? toDto(recipe, userId) : null;
}

export async function deleteRecipe(userId: string, recipeId: string): Promise<boolean> {
  const result = await prisma.recipe.deleteMany({ where: { id: recipeId, userId } });

  // Les fichiers ne sont pas gérés par la cascade SQL : on les retire nous-mêmes,
  // sans quoi le dossier media/ accumulerait des vidéos orphelines.
  if (result.count > 0) {
    await deleteRecipeMedia(recipeId).catch(() => undefined);
  }

  return result.count > 0;
}

export interface RecipeListResult {
  recipes: RecipeDto[];
  total: number;
}

export async function listRecipes(
  userId: string,
  query: RecipeQuery,
): Promise<RecipeListResult> {
  const where: Prisma.RecipeWhereInput = { userId };

  if (query.category) where.category = query.category;
  if (query.difficulty) where.difficulty = query.difficulty;
  if (query.cuisine) where.cuisine = query.cuisine;
  if (query.favorite) where.isFavorite = true;
  if (query.maxTime) where.totalTime = { lte: query.maxTime, not: null };

  // « Essayées » / « à tester » : c'est la présence d'une note qui tranche,
  // pas sa valeur. Une recette ratée notée 1 reste une recette essayée.
  if (query.tried !== undefined) {
    where.rating = query.tried ? { not: null } : null;
  }
  if (query.minRating) where.rating = { gte: query.minRating };

  if (query.tag) {
    where.tags = { some: { tag: { slug: ingredientSlug(query.tag) } } };
  }

  if (query.q) {
    // SQLite n'a pas d'ILIKE ; `mode: 'insensitive'` n'est pas supporté non
    // plus par son connecteur. La collation par défaut gère l'ASCII, ce qui
    // suffit ici — à revoir si l'on passe à Postgres (où `mode` existe).
    where.OR = [
      { title: { contains: query.q } },
      { description: { contains: query.q } },
      { cuisine: { contains: query.q } },
      { ingredients: { some: { label: { contains: query.q } } } },
      { tags: { some: { tag: { name: { contains: query.q } } } } },
    ];
  }

  const orderBy: Prisma.RecipeOrderByWithRelationInput[] = (() => {
    switch (query.sort) {
      case 'title':
        return [{ title: 'asc' }];
      case 'time':
        // SQLite place les NULL en premier en ASC ; on veut les recettes
        // sans durée à la fin, d'où le tri secondaire.
        return [{ totalTime: 'asc' }, { createdAt: 'desc' }];
      case 'favorite':
        return [{ isFavorite: 'desc' }, { createdAt: 'desc' }];
      case 'rating':
        // `nulls: 'last'` : les recettes pas encore essayées ferment la
        // marche plutôt que d'ouvrir le classement, ce que ferait le tri
        // SQLite par défaut (NULL avant tout le reste en DESC inversé).
        return [{ rating: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
      default:
        return [{ createdAt: 'desc' }];
    }
  })();

  const [recipes, total] = await Promise.all([
    prisma.recipe.findMany({
      where,
      include: recipeInclude,
      orderBy,
      take: query.take,
      skip: query.skip,
    }),
    prisma.recipe.count({ where }),
  ]);

  return { recipes: recipes.map((recipe) => toDto(recipe, userId)), total };
}

/** Valeurs distinctes présentes en base, pour alimenter les filtres de l'UI. */
export async function getFilterFacets(userId: string) {
  const [categories, cuisines, tags] = await Promise.all([
    prisma.recipe.groupBy({
      by: ['category'],
      where: { userId, category: { not: null } },
      _count: { _all: true },
    }),
    prisma.recipe.groupBy({
      by: ['cuisine'],
      where: { userId, cuisine: { not: null } },
      _count: { _all: true },
    }),
    /*
     * Le compteur est filtré, pas seulement la liste.
     *
     * `_count: { recipes: true }` sans filtre compterait TOUTES les liaisons
     * du tag, toutes recettes confondues : l'utilisateur lirait « pâtes · 47 »
     * en n'en ayant que trois, ce qui révélerait l'activité des autres
     * comptes. Le filtre doit donc être répété dans le `_count`.
     */
    prisma.tag.findMany({
      where: { recipes: { some: { recipe: { userId } } } },
      include: {
        _count: { select: { recipes: { where: { recipe: { userId } } } } },
      },
      orderBy: { name: 'asc' },
      take: 40,
    }),
  ]);

  return {
    categories: categories
      .filter((row) => row.category)
      .map((row) => ({ value: row.category as string, count: row._count._all })),
    cuisines: cuisines
      .filter((row) => row.cuisine)
      .map((row) => ({ value: row.cuisine as string, count: row._count._all })),
    tags: tags.map((tag) => ({ value: tag.name, slug: tag.slug, count: tag._count.recipes })),
  };
}

/**
 * Enregistre la note d'essai d'une recette.
 *
 * `triedAt` est posé par le serveur au moment de la première note et n'est
 * plus jamais reculé : réajuster sa note trois mois après ne change pas la
 * date à laquelle le plat a été cuisiné. C'est ce qui permet au fichier de
 * rester un journal fidèle — « essayée en mars, notée 3 puis remontée à 4 »
 * reste une recette essayée en mars.
 *
 * Passer `rating: null` annule la notation : la recette redevient « à
 * tester », et la date d'essai part avec elle. Sans quoi une fiche non notée
 * porterait toujours une date d'essai, ce qui n'aurait aucun sens.
 */
export async function rateRecipe(
  userId: string,
  recipeId: string,
  input: RateRecipeInput,
): Promise<RecipeDto | null> {
  const existing = await prisma.recipe.findFirst({ where: { id: recipeId, userId } });
  if (!existing) return null;

  const updated = await prisma.recipe.update({
    where: { id: recipeId },
    data: {
      rating: input.rating,
      // Une note retirée emporte son commentaire : garder « trop salé » sur
      // une fiche redevenue « à tester » serait incohérent.
      ratingNote: input.rating === null ? null : input.note,
      triedAt: input.rating === null ? null : (existing.triedAt ?? new Date()),
    },
    include: recipeInclude,
  });

  return toDto(updated, userId);
}

/**
 * Attache la photo du plat prise par l'utilisateur.
 *
 * Le fichier est écrit avant la mise à jour de la base, et l'ancienne photo
 * n'est effacée qu'une fois la nouvelle en place (voir saveUserPhoto) : à
 * aucun moment la fiche ne pointe vers un fichier absent.
 */
export async function setUserPhoto(
  userId: string,
  recipeId: string,
  buffer: Buffer,
  mime: string,
): Promise<RecipeDto | null> {
  const existing = await prisma.recipe.findFirst({ where: { id: recipeId, userId } });
  if (!existing) return null;

  const userPhotoUrl = await saveUserPhoto(recipeId, buffer, mime);

  const updated = await prisma.recipe.update({
    where: { id: recipeId },
    data: { userPhotoUrl },
    include: recipeInclude,
  });

  return toDto(updated, userId);
}

/**
 * Retire la photo de l'utilisateur.
 *
 * La base est mise à jour d'abord, le fichier ensuite : si l'effacement
 * disque échoue, la fiche est déjà revenue à son image d'origine et le
 * fichier orphelin partira avec la recette. L'inverse laisserait une fiche
 * pointant vers un fichier supprimé.
 */
export async function removeUserPhoto(
  userId: string,
  recipeId: string,
): Promise<RecipeDto | null> {
  const existing = await prisma.recipe.findFirst({ where: { id: recipeId, userId } });
  if (!existing) return null;

  const updated = await prisma.recipe.update({
    where: { id: recipeId },
    data: { userPhotoUrl: null },
    include: recipeInclude,
  });

  await deleteUserPhoto(recipeId).catch(() => undefined);

  return toDto(updated, userId);
}

export async function toggleFavorite(
  userId: string,
  recipeId: string,
): Promise<RecipeDto | null> {
  const existing = await prisma.recipe.findFirst({ where: { id: recipeId, userId } });
  if (!existing) return null;

  const updated = await prisma.recipe.update({
    where: { id: recipeId },
    data: { isFavorite: !existing.isFavorite },
    include: recipeInclude,
  });

  // Table Favorite tenue à jour en parallèle du drapeau : le drapeau sert aux
  // requêtes de liste (rapide), la table gardera son sens en multi-utilisateur.
  if (updated.isFavorite) {
    await prisma.favorite.upsert({
      where: { userId_recipeId: { userId, recipeId } },
      update: {},
      create: { userId, recipeId },
    });
  } else {
    await prisma.favorite.deleteMany({ where: { userId, recipeId } });
  }

  return toDto(updated, userId);
}

// ---------------------------------------------------------------------------
// Partage public
// ---------------------------------------------------------------------------

/**
 * Publie une recette, ou la repasse en privé.
 *
 * `publishedAt` est posé à la première publication et n'est plus jamais
 * touché : dépublier puis republier ne fait pas remonter la fiche en tête de
 * la page Découvrir, ce qui serait un levier facile pour se maintenir en
 * vitrine. C'est la même logique que `triedAt` pour la notation — une date
 * d'événement ne se réécrit pas.
 *
 * Retirer une recette du public ne touche PAS aux copies déjà faites : elles
 * appartiennent à ceux qui les ont enregistrées. Dépublier ferme la porte, ça
 * ne reprend pas ce qui est déjà sorti.
 */
export async function setVisibility(
  userId: string,
  recipeId: string,
  input: VisibilityInput,
): Promise<RecipeDto | null> {
  const existing = await prisma.recipe.findFirst({
    where: { id: recipeId, userId },
    select: { id: true, publishedAt: true },
  });
  if (!existing) return null;

  if (input.displayName !== undefined) {
    await prisma.user.update({
      where: { id: userId },
      data: { displayName: input.displayName?.trim() || null },
    });
  }

  const updated = await prisma.recipe.update({
    where: { id: recipeId },
    data: {
      isPublic: input.isPublic,
      ...(input.isPublic && !existing.publishedAt ? { publishedAt: new Date() } : {}),
    },
    include: recipeInclude,
  });

  return toDto(updated, userId);
}

/**
 * Lit une recette accessible au visiteur : la sienne, ou n'importe quelle
 * fiche publique.
 *
 * Une seule requête plutôt qu'un `getRecipe` suivi d'un repli sur le public :
 * la condition est dans le `where`, donc il n'existe aucun chemin de code où
 * une recette privée d'autrui serait chargée puis filtrée après coup.
 */
export async function getVisibleRecipe(
  viewerId: string | null,
  recipeId: string,
): Promise<RecipeDto | null> {
  const recipe = await prisma.recipe.findFirst({
    where: {
      id: recipeId,
      OR: [{ isPublic: true }, ...(viewerId ? [{ userId: viewerId }] : [])],
    },
    include: recipeInclude,
  });

  return recipe ? toDto(recipe, viewerId) : null;
}

/** Page Découvrir : toutes les recettes publiques, quel qu'en soit l'auteur. */
export async function listPublicRecipes(
  viewerId: string | null,
  query: DiscoverQuery,
): Promise<RecipeListResult> {
  const where: Prisma.RecipeWhereInput = { isPublic: true };

  if (query.category) where.category = query.category;
  if (query.difficulty) where.difficulty = query.difficulty;
  if (query.cuisine) where.cuisine = query.cuisine;
  if (query.maxTime) where.totalTime = { lte: query.maxTime, not: null };
  if (query.tag) where.tags = { some: { tag: { slug: ingredientSlug(query.tag) } } };

  if (query.q) {
    where.OR = [
      { title: { contains: query.q } },
      { description: { contains: query.q } },
      { cuisine: { contains: query.q } },
      { ingredients: { some: { label: { contains: query.q } } } },
      { tags: { some: { tag: { name: { contains: query.q } } } } },
    ];
  }

  const orderBy: Prisma.RecipeOrderByWithRelationInput[] = (() => {
    switch (query.sort) {
      case 'title':
        return [{ title: 'asc' }];
      case 'time':
        return [{ totalTime: 'asc' }, { publishedAt: 'desc' }];
      case 'popular':
        return [{ copyCount: 'desc' }, { publishedAt: 'desc' }];
      default:
        // Tri sur la date de publication, pas de création : une recette
        // importée l'an dernier et partagée aujourd'hui est une nouveauté
        // pour ceux qui la découvrent.
        return [{ publishedAt: 'desc' }];
    }
  })();

  const [recipes, total] = await Promise.all([
    prisma.recipe.findMany({
      where,
      include: recipeInclude,
      orderBy,
      take: query.take,
      skip: query.skip,
    }),
    prisma.recipe.count({ where }),
  ]);

  return { recipes: recipes.map((recipe) => toDto(recipe, viewerId)), total };
}

/** Facettes calculées sur le seul périmètre public. */
export async function getPublicFacets() {
  const [categories, cuisines, tags] = await Promise.all([
    prisma.recipe.groupBy({
      by: ['category'],
      where: { isPublic: true, category: { not: null } },
      _count: { _all: true },
    }),
    prisma.recipe.groupBy({
      by: ['cuisine'],
      where: { isPublic: true, cuisine: { not: null } },
      _count: { _all: true },
    }),
    // Même filtre dans le `_count` que dans le `where` : sinon le décompte
    // inclurait les recettes privées portant ce tag.
    prisma.tag.findMany({
      where: { recipes: { some: { recipe: { isPublic: true } } } },
      include: {
        _count: { select: { recipes: { where: { recipe: { isPublic: true } } } } },
      },
      orderBy: { name: 'asc' },
      take: 40,
    }),
  ]);

  return {
    categories: categories
      .filter((row) => row.category)
      .map((row) => ({ value: row.category as string, count: row._count._all })),
    cuisines: cuisines
      .filter((row) => row.cuisine)
      .map((row) => ({ value: row.cuisine as string, count: row._count._all })),
    tags: tags.map((tag) => ({ value: tag.name, slug: tag.slug, count: tag._count.recipes })),
  };
}

/**
 * Copie une recette publique dans le fichier du visiteur.
 *
 * Ce qui est copié : le contenu culinaire (ingrédients, étapes, matériel,
 * conseils, tags) et la provenance d'origine. Ce qui ne l'est pas :
 *  - la note, le commentaire d'essai et le favori — ce sont les annotations
 *    de l'auteur, pas des faits sur la recette ;
 *  - la visibilité — une copie arrive privée, à son nouveau propriétaire de
 *    décider s'il la repartage ;
 *  - la vidéo et la photo du plat — ce sont des fichiers sur le disque, qui
 *    se retrouveraient partagés entre deux fiches indépendantes, et que la
 *    suppression de l'une effacerait pour l'autre. La copie garde `imageUrl`,
 *    qui est une adresse distante, pas un fichier local.
 *
 * `copiedFromId` conserve le lien vers l'originale : c'est ce qui permet
 * d'afficher « d'après la recette de X » et de compter les copies.
 */
export async function copyPublicRecipe(
  userId: string,
  recipeId: string,
): Promise<RecipeDto | null> {
  const source = await prisma.recipe.findFirst({
    where: { id: recipeId, isPublic: true },
    include: recipeInclude,
  });

  if (!source) return null;

  // Sa propre recette : rien à copier, on renvoie l'originale telle quelle
  // plutôt que de créer un doublon silencieux dans son propre fichier.
  if (source.userId === userId) return toDto(source, userId);

  const created = await prisma.$transaction(async (tx) => {
    const copy = await tx.recipe.create({
      data: {
        userId,
        title: source.title,
        description: source.description,
        imageUrl: source.imageUrl,
        servings: source.servings,
        prepTime: source.prepTime,
        cookingTime: source.cookingTime,
        totalTime: source.totalTime,
        difficulty: source.difficulty,
        category: source.category,
        cuisine: source.cuisine,
        equipment: source.equipment,
        tips: source.tips,
        confidence: source.confidence,
        warnings: source.warnings,
        sourceUrl: source.sourceUrl,
        sourcePlatform: source.sourcePlatform,
        sourceAuthor: source.sourceAuthor,
        sourceTitle: source.sourceTitle,
        importedAt: source.importedAt,
        copiedFromId: source.id,
        steps: {
          create: source.steps.map((step) => ({
            order: step.order,
            title: step.title,
            instruction: step.instruction,
            duration: step.duration,
            temperature: step.temperature,
          })),
        },
      },
    });

    for (const [index, item] of source.ingredients.entries()) {
      await tx.recipeIngredient.create({
        data: {
          recipeId: copy.id,
          // L'Ingredient canonique est partagé : c'est précisément ce qui
          // permettra de fusionner les courses des deux fiches.
          ingredientId: item.ingredientId,
          quantity: item.quantity,
          unit: item.unit,
          label: item.label,
          preparation: item.preparation,
          note: item.note,
          section: item.section,
          position: index,
        },
      });
    }

    for (const link of source.tags) {
      await tx.recipeTag.create({ data: { recipeId: copy.id, tagId: link.tagId } });
    }

    // Compteur incrémenté dans la transaction : il ne peut pas monter sans
    // qu'une copie existe réellement.
    await tx.recipe.update({
      where: { id: source.id },
      data: { copyCount: { increment: 1 } },
    });

    return tx.recipe.findUniqueOrThrow({ where: { id: copy.id }, include: recipeInclude });
  });

  return toDto(created, userId);
}
