import { existsSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../../database/client.js';
import { isAppError } from '../../utils/errors.js';
import { isVideoAnalysisConfigured, locateStepsInVideo } from './videoAnalyzer.js';
import { downloadVideo, isVideoAnalysisAvailable } from './videoFetcher.js';
import {
  extractFrame,
  extractPoster,
  recipeDirFor,
  recipeMediaPath,
  recipeMediaUrl,
} from './storage.js';

/**
 * Illustration des étapes par des images de la vidéo d'origine.
 *
 * Trois temps, une fois la recette enregistrée :
 *  1. s'assurer d'avoir la vidéo sur le disque — elle y est déjà quand
 *     l'import a dû l'analyser, sinon on la télécharge maintenant ;
 *  2. demander à Gemini à quel instant chaque étape est montrée ;
 *  3. extraire avec ffmpeg l'image de chacun de ces instants.
 *
 * Tout se passe en tâche de fond, après la réponse à l'enregistrement : le
 * téléchargement et l'analyse prennent de 20 à 60 secondes, et l'utilisateur
 * n'a pas à les attendre pour consulter sa fiche. Le client sait qu'il doit
 * patienter grâce à `stepFramesStatus`, et recharge la fiche en attendant.
 *
 * Les tâches passent une par une : un serveur mono-utilisateur n'a pas à
 * lancer trois ffmpeg et trois envois de vidéo de front parce qu'on a
 * importé trois recettes d'affilée.
 */

const VIDEO_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube'];

const queue: string[] = [];
let running = false;

/**
 * Indique si l'illustration peut être tentée pour cette recette.
 * Sans clé Gemini, ou sans vidéo ni moyen d'en obtenir une, on ne promet
 * rien au client : le statut reste null.
 */
export function canIllustrateSteps(recipe: {
  videoUrl: string | null;
  sourceUrl: string | null;
  sourcePlatform: string | null;
}): boolean {
  if (!isVideoAnalysisConfigured()) return false;
  if (recipe.videoUrl) return true;
  return Boolean(
    recipe.sourceUrl &&
      recipe.sourcePlatform &&
      VIDEO_PLATFORMS.includes(recipe.sourcePlatform) &&
      isVideoAnalysisAvailable(),
  );
}

/** Met la recette en file. Le statut doit déjà valoir "pending". */
export function scheduleStepFrames(recipeId: string): void {
  if (!queue.includes(recipeId)) queue.push(recipeId);
  void drain();
}

/**
 * Relance les tâches interrompues par un redémarrage du serveur : sans cela,
 * leur fiche resterait indéfiniment « en préparation ».
 */
export async function resumePendingStepFrames(): Promise<number> {
  const pending = await prisma.recipe.findMany({
    where: { stepFramesStatus: 'pending' },
    select: { id: true },
  });
  for (const { id } of pending) scheduleStepFrames(id);
  return pending.length;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const recipeId = queue.shift()!;
      await illustrate(recipeId);
    }
  } finally {
    running = false;
  }
}

async function illustrate(recipeId: string): Promise<void> {
  let status: 'done' | 'failed' = 'failed';

  try {
    status = await illustrateSteps(recipeId);
  } catch (error) {
    const reason = isAppError(error) ? error.message : error;
    console.warn(`[step-frames] ${recipeId} : illustration impossible :`, reason);
  }

  // `updateMany` plutôt qu'`update` : la recette a pu être supprimée pendant
  // le traitement, ce qui n'est pas une erreur.
  await prisma.recipe
    .updateMany({ where: { id: recipeId }, data: { stepFramesStatus: status } })
    .catch(() => undefined);
}

async function illustrateSteps(recipeId: string): Promise<'done' | 'failed'> {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!recipe || recipe.steps.length === 0) return 'failed';

  const video = await ensureVideo(recipe);
  if (!video) return 'failed';

  const located = await locateStepsInVideo(video, recipe.steps);
  const dir = recipeDirFor(recipeId);
  let illustrated = 0;

  for (const step of recipe.steps) {
    const seconds = located.get(step.order);
    if (seconds === undefined) continue;

    // L'instant est dans le nom du fichier : les médias sont servis avec un
    // cache « immutable », une nouvelle image doit avoir une nouvelle adresse.
    const fileName = `step-${step.order}-${Math.round(seconds * 10)}.jpg`;
    const ok = await extractFrame(video.filePath, seconds, path.join(dir, fileName));

    // L'instant est gardé même sans image : il suffit à relancer la vidéo au
    // bon moment depuis la fiche.
    await prisma.recipeStep.updateMany({
      where: { id: step.id },
      data: { videoTime: seconds, imageUrl: ok ? recipeMediaUrl(recipeId, fileName) : null },
    });
    if (ok) illustrated++;
  }

  console.log(
    `[step-frames] ${recipeId} : ${located.size}/${recipe.steps.length} étapes situées, ${illustrated} illustrées`,
  );
  return 'done';
}

/**
 * Renvoie la vidéo de la recette sur le disque, en la téléchargeant si
 * l'import ne l'avait pas déjà fait. Une vidéo téléchargée ici est aussi
 * rattachée à la fiche : autant en profiter pour pouvoir la revoir.
 */
async function ensureVideo(recipe: {
  id: string;
  videoUrl: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
}): Promise<{ filePath: string; mimeType: string } | null> {
  if (recipe.videoUrl) {
    const filePath = recipeMediaPath(recipe.id, recipe.videoUrl);
    if (!filePath || !existsSync(filePath)) return null;
    return { filePath, mimeType: filePath.endsWith('.webm') ? 'video/webm' : 'video/mp4' };
  }

  if (!recipe.sourceUrl) return null;

  const dir = recipeDirFor(recipe.id);
  const video = await downloadVideo(recipe.sourceUrl, dir);
  const posterUrl = await extractPoster(video.filePath, dir, recipe.id);

  await prisma.recipe.updateMany({
    where: { id: recipe.id },
    data: {
      videoUrl: recipeMediaUrl(recipe.id, path.basename(video.filePath)),
      posterUrl,
      ...(recipe.imageUrl ? {} : { imageUrl: posterUrl }),
    },
  });

  return video;
}
