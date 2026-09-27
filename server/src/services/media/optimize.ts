import { existsSync } from 'node:fs';
import { copyFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../database/client.js';
import { enqueueMediaTask } from './mediaQueue.js';
import {
  compressVideo,
  convertImageToWebp,
  recipeDirFor,
  recipeMediaPath,
  recipeMediaUrl,
} from './storage.js';

/**
 * Optimisation des médias stockés avec une recette, pour gagner de la place.
 *
 *  - Images (affiche, images d'étapes, photo du plat) : converties en WebP.
 *  - Vidéo : recompressée en MP4 H.264 (voir compressVideo). Pas en WebP :
 *    c'est un format d'image, une « vidéo WebP » n'aurait ni son ni
 *    possibilité de sauter à un instant.
 *
 * Les nouveaux médias sont déjà écrits en WebP ; ce module recompresse la
 * vidéo des nouvelles recettes, et rattrape au démarrage les fiches
 * enregistrées avant (JPEG, PNG, vidéo d'origine).
 *
 * Chaque fichier converti prend une nouvelle adresse (poster.jpg →
 * poster.webp, video.mp4 → video-c.mp4) : les médias sont servis avec un
 * cache « immutable », réécrire un fichier sous le même nom laisserait les
 * navigateurs sur l'ancien. L'ancien fichier n'est effacé qu'une fois la
 * base à jour, pour qu'aucune fiche ne pointe jamais vers un fichier absent.
 */

const LEGACY_IMAGE = /\.(jpe?g|png)$/i;

/** Nom de la vidéo recompressée : sa présence marque le travail comme fait. */
const COMPRESSED_VIDEO = 'video-c.mp4';

export function scheduleMediaOptimization(recipeId: string): void {
  enqueueMediaTask(`optimize:${recipeId}`, () => optimizeRecipeMedia(recipeId));
}

interface MediaFields {
  id: string;
  videoUrl: string | null;
  posterUrl: string | null;
  imageUrl: string | null;
  userPhotoUrl: string | null;
  steps: { id: string; imageUrl: string | null }[];
}

const mediaSelect = {
  id: true,
  videoUrl: true,
  posterUrl: true,
  imageUrl: true,
  userPhotoUrl: true,
  steps: { select: { id: true, imageUrl: true } },
} as const;

/** Vrai si un fichier local de cette recette reste à convertir. */
function needsOptimization(recipe: MediaFields): boolean {
  const isLegacyLocalImage = (url: string | null) =>
    Boolean(url && recipeMediaPath(recipe.id, url) && LEGACY_IMAGE.test(url));

  return (
    Boolean(recipe.videoUrl && !recipe.videoUrl.endsWith(`/${COMPRESSED_VIDEO}`)) ||
    [recipe.posterUrl, recipe.imageUrl, recipe.userPhotoUrl].some(isLegacyLocalImage) ||
    recipe.steps.some((step) => isLegacyLocalImage(step.imageUrl))
  );
}

/**
 * Met en file toutes les fiches dont les médias n'ont pas encore été
 * optimisés. Appelé au démarrage : sans commande à lancer, la conversion
 * des fiches existantes se fait d'elle-même après une mise à jour.
 */
export async function optimizeExistingMedia(): Promise<number> {
  const recipes = await prisma.recipe.findMany({
    where: {
      OR: [
        { videoUrl: { not: null } },
        { posterUrl: { not: null } },
        { userPhotoUrl: { not: null } },
        { imageUrl: { startsWith: '/media/' } },
        { steps: { some: { imageUrl: { not: null } } } },
      ],
    },
    select: mediaSelect,
  });

  const todo = recipes.filter(needsOptimization);
  for (const recipe of todo) scheduleMediaOptimization(recipe.id);
  return todo.length;
}

async function sizeOf(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function optimizeRecipeMedia(recipeId: string): Promise<void> {
  const recipe = await prisma.recipe.findUnique({ where: { id: recipeId }, select: mediaSelect });
  if (!recipe) return;

  const dir = recipeDirFor(recipeId);
  const obsolete: string[] = [];
  let before = 0;
  let after = 0;

  // Une même image peut servir à deux champs (l'affiche est souvent aussi
  // l'image de la fiche) : chaque adresse n'est convertie qu'une fois.
  const converted = new Map<string, string>();

  async function toWebp(url: string | null): Promise<string | null> {
    if (!url || !LEGACY_IMAGE.test(url)) return url;
    const cached = converted.get(url);
    if (cached) return cached;

    // Adresse distante (image fournie par la plateforme) : pas à nous.
    const source = recipeMediaPath(recipeId, url);
    if (!source || !existsSync(source)) return url;

    const webpName = path.basename(source).replace(LEGACY_IMAGE, '.webp');
    const target = path.join(dir, webpName);
    if (!(await convertImageToWebp(source, target))) return url;

    before += await sizeOf(source);
    after += await sizeOf(target);
    obsolete.push(source);

    const next = recipeMediaUrl(recipeId, webpName);
    converted.set(url, next);
    return next;
  }

  const posterUrl = await toWebp(recipe.posterUrl);
  const imageUrl = await toWebp(recipe.imageUrl);
  const userPhotoUrl = await toWebp(recipe.userPhotoUrl);

  const steps: { id: string; imageUrl: string | null }[] = [];
  for (const step of recipe.steps) {
    const next = await toWebp(step.imageUrl);
    if (next !== step.imageUrl) steps.push({ id: step.id, imageUrl: next });
  }

  const videoUrl = await compressRecipeVideo(recipe, dir, obsolete, (a, b) => {
    before += a;
    after += b;
  });

  if (
    posterUrl === recipe.posterUrl &&
    imageUrl === recipe.imageUrl &&
    userPhotoUrl === recipe.userPhotoUrl &&
    videoUrl === recipe.videoUrl &&
    steps.length === 0
  ) {
    return;
  }

  // La base d'abord, les fichiers ensuite. `updateMany` : la recette a pu
  // être supprimée pendant la conversion, ce n'est pas une erreur.
  await prisma.$transaction([
    prisma.recipe.updateMany({
      where: { id: recipeId },
      data: { posterUrl, imageUrl, userPhotoUrl, videoUrl },
    }),
    ...steps.map((step) =>
      prisma.recipeStep.updateMany({ where: { id: step.id }, data: { imageUrl: step.imageUrl } }),
    ),
  ]);

  await Promise.all(obsolete.map((file) => rm(file, { force: true })));

  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  console.log(`[media] ${recipeId} : ${mb(before)} Mo → ${mb(after)} Mo`);
}

/**
 * Recompresse la vidéo de la fiche et renvoie sa nouvelle adresse.
 *
 * Si la version recompressée n'est pas plus légère (vidéo déjà très
 * compressée par la plateforme), l'original est gardé sous le nouveau nom :
 * le travail est marqué comme fait et ne sera pas retenté à chaque démarrage.
 * Si ffmpeg échoue, rien ne change et l'essai sera refait au prochain.
 */
async function compressRecipeVideo(
  recipe: MediaFields,
  dir: string,
  obsolete: string[],
  count: (before: number, after: number) => void,
): Promise<string | null> {
  if (!recipe.videoUrl || recipe.videoUrl.endsWith(`/${COMPRESSED_VIDEO}`)) {
    return recipe.videoUrl;
  }

  const source = recipeMediaPath(recipe.id, recipe.videoUrl);
  if (!source || !existsSync(source)) return recipe.videoUrl;

  const target = path.join(dir, COMPRESSED_VIDEO);
  if (!(await compressVideo(source, target))) return recipe.videoUrl;

  const sourceSize = await sizeOf(source);
  const targetSize = await sizeOf(target);

  if (targetSize >= sourceSize) {
    // Copie et non déplacement : l'original doit rester en place tant que
    // la base pointe dessus.
    await copyFile(source, target);
  }

  obsolete.push(source);
  count(sourceSize, Math.min(sourceSize, targetSize));

  return recipeMediaUrl(recipe.id, COMPRESSED_VIDEO);
}
