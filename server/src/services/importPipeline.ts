import { prisma } from '../database/client.js';
import {
  IMPORT_STEP_KEYS,
  type ExtractedContent,
  type ImportStep,
  type ImportStepKey,
  type ManualImportInput,
} from '../schemas/import.js';
import type { GeneratedRecipe, Platform } from '../schemas/recipe.js';
import { appError, isAppError, type AppError } from '../utils/errors.js';
import { parseJson, serializeJson } from '../utils/json.js';
import { cleanUrl, detectPlatform, fetchFromUrl, usableText } from './importers/index.js';
import { emptyContent } from './importers/types.js';
import { generateRecipe } from './recipeAI/index.js';
import { analyzeVideo, isVideoAnalysisConfigured } from './media/videoAnalyzer.js';
import { downloadVideo, isVideoAnalysisAvailable } from './media/videoFetcher.js';
import { tempDirFor } from './media/storage.js';

/**
 * Orchestration d'un import, de l'URL à la prévisualisation.
 *
 * Deux exigences structurent ce fichier :
 *
 * 1. §2 — « ne jamais afficher un faux succès ». Le journal d'étapes est écrit
 *    APRÈS chaque opération réussie, jamais avant. Une étape sans objet pour
 *    la source (transcription d'un article) est marquée `skipped`, pas `done`.
 *
 * 2. §15 — toute erreur est enregistrée sur l'Import avec son code, son
 *    message lisible et l'indication de reprise manuelle. L'enregistrement
 *    survit à l'échec : c'est ce qui permet la saisie manuelle ensuite.
 */

/** Journal d'étapes, initialisé à "pending". */
function initialSteps(): ImportStep[] {
  return IMPORT_STEP_KEYS.map((key) => ({
    key,
    status: 'pending' as const,
    detail: null,
    at: null,
  }));
}

class StepTracker {
  private steps: ImportStep[] = initialSteps();

  mark(key: ImportStepKey, status: ImportStep['status'], detail?: string | null): void {
    const step = this.steps.find((candidate) => candidate.key === key);
    if (!step) return;
    step.status = status;
    step.detail = detail ?? null;
    step.at = new Date().toISOString();
  }

  /** Marque échouée l'étape en cours et laisse les suivantes en attente. */
  failCurrent(detail: string): void {
    const running = this.steps.find((step) => step.status === 'running');
    const target = running ?? this.steps.find((step) => step.status === 'pending');
    if (target) {
      target.status = 'failed';
      target.detail = detail.slice(0, 200);
      target.at = new Date().toISOString();
    }
  }

  snapshot(): ImportStep[] {
    return this.steps.map((step) => ({ ...step }));
  }
}

export interface ImportResult {
  importId: string;
  status: 'ready' | 'failed';
  platform: Platform;
  steps: ImportStep[];
  recipe: GeneratedRecipe | null;
  error: {
    code: string;
    message: string;
    canRetryManually: boolean;
  } | null;
  /** Ce que les importers ont signalé : limites, approximations. */
  notes: string[];
}

/**
 * Import complet depuis une URL.
 *
 * Volontairement synchrone (une requête = un import terminé) : pour un usage
 * mono-utilisateur, un import prend quelques secondes et la complexité d'une
 * file d'attente ne se justifie pas. L'Import est créé en base dès le départ,
 * donc rien n'est perdu si le client coupe la connexion.
 */
export async function runImport(userId: string, rawUrl: string): Promise<ImportResult> {
  const url = cleanUrl(rawUrl);
  const platform = detectPlatform(url);
  const tracker = new StepTracker();

  const record = await prisma.import.create({
    data: {
      userId,
      url,
      platform,
      status: 'fetching',
      steps: serializeJson(tracker.snapshot()) ?? '[]',
    },
  });

  // La plateforme est déterminée par l'URL seule : cette étape est
  // réellement franchie dès maintenant.
  tracker.mark('source-detected', 'done', platform);

  try {
    // ---- Récupération du contenu ----
    tracker.mark('content-fetched', 'running');
    const { content } = await fetchFromUrl(url);
    tracker.mark('content-fetched', 'done', content.title ?? null);

    markMediaSteps(tracker, content);

    let text = usableText(content);

    // ---- Analyse visuelle, en dernier recours ----
    //
    // Déclenchée uniquement quand le texte disponible ne suffit pas. Elle
    // coûte ~8x plus de tokens et une vingtaine de secondes : la réserver aux
    // cas désespérés garde les imports ordinaires rapides et bon marché.
    //
    // C'est ce qui permet de récupérer les recettes des vidéos muettes, où
    // tout se joue dans les gestes et le texte incrusté à l'image.
    if (!text && canAnalyzeVideo(platform)) {
      const analysed = await tryVideoAnalysis(record.id, url, content, tracker);
      if (analysed) text = analysed;
    }

    if (!text) {
      // Distinguer « rien du tout » de « un titre et des hashtags » : dans le
      // second cas l'utilisateur voit bien du texte à l'écran et ne
      // comprendrait pas qu'on annonce n'avoir rien trouvé.
      const onlyPromotional = Boolean(
        (content.description ?? content.text ?? '').trim().length > 0,
      );

      throw appError('NO_CONTENT', {
        message: onlyPromotional
          ? "La publication ne contient que son titre et des hashtags, et la vidéo n'a pas pu être analysée. Colle le texte de la recette à la main pour continuer."
          : "Aucun texte exploitable n'a été trouvé à cette adresse. Colle la recette à la main pour continuer.",
        canRetryManually: true,
      });
    }

    await prisma.import.update({
      where: { id: record.id },
      data: {
        status: 'generating',
        rawMetadata: serializeJson(content.metadata),
        rawText: content.text ?? content.description ?? null,
        transcript: content.transcript,
        steps: serializeJson(tracker.snapshot()) ?? '[]',
      },
    });

    // ---- Génération ----
    return await generateAndStore(record.id, content, tracker, platform);
  } catch (error) {
    return failImport(record.id, platform, tracker, error);
  }
}

/** Plateformes dont on sait télécharger la vidéo. */
function canAnalyzeVideo(platform: Platform): boolean {
  return ['facebook', 'instagram', 'tiktok', 'youtube'].includes(platform);
}

/**
 * Télécharge la vidéo et la fait analyser.
 *
 * Tout échec est absorbé : l'analyse visuelle est un bonus, pas un passage
 * obligé. Si elle ne marche pas, l'import poursuit son cours et se terminera
 * par le message habituel proposant la saisie manuelle — on ne remplace pas
 * une erreur claire par une erreur technique obscure.
 *
 * Le contenu est enrichi sur place : le rapport d'analyse devient la
 * transcription, et l'image extraite illustre la fiche.
 */
async function tryVideoAnalysis(
  importId: string,
  url: string,
  content: ExtractedContent,
  tracker: StepTracker,
): Promise<string | null> {
  if (!isVideoAnalysisAvailable() || !isVideoAnalysisConfigured()) return null;

  tracker.mark('media-analyzed', 'running', 'Téléchargement de la vidéo…');

  try {
    const video = await downloadVideo(url, tempDirFor(importId));

    tracker.mark(
      'media-analyzed',
      'done',
      `Vidéo téléchargée (${(video.bytes / 1024 / 1024).toFixed(1)} Mo)`,
    );
    tracker.mark('transcript-ready', 'running', 'Analyse du contenu visuel…');

    const analysis = await analyzeVideo(video);

    const words = analysis.report.split(/\s+/).length;
    tracker.mark('transcript-ready', 'done', `Vidéo analysée (${words} mots relevés)`);

    content.transcript = analysis.report;
    content.notes.push(
      "La légende ne contenait pas la recette : elle a été reconstituée en analysant la vidéo (texte affiché à l'écran et gestes visibles).",
    );
    content.metadata['videoAnalyzed'] = true;

    await prisma.import.update({
      where: { id: importId },
      data: { videoAnalyzed: true },
    });

    return usableText(content);
  } catch (error) {
    // Échec silencieux : on note la raison et on laisse le pipeline conclure.
    const reason = isAppError(error) ? error.message : 'Analyse vidéo indisponible';
    tracker.mark('media-analyzed', 'skipped', reason.slice(0, 120));
    tracker.mark('transcript-ready', 'skipped', 'Analyse vidéo impossible');
    return null;
  }
}

/**
 * Reprise manuelle : l'utilisateur a collé le texte lui-même.
 * On saute toute la phase de récupération et on va droit à la génération.
 */
export async function runManualImport(
  userId: string,
  input: ManualImportInput,
  existingImportId?: string,
): Promise<ImportResult> {
  const url = input.url ? cleanUrl(input.url) : '';
  const platform: Platform = input.platform ?? (url ? detectPlatform(url) : 'manual');
  const tracker = new StepTracker();

  // `sourceUrl` reste une chaîne vide quand l'utilisateur n'a pas fourni de
  // lien : ce champ alimente `source.url`, qui doit être une vraie URL ou
  // rien du tout. Un libellé de remplacement y serait rejeté à la validation.
  const content: ExtractedContent = {
    ...emptyContent(url, platform),
    title: input.title ?? null,
    author: input.author ?? null,
    text: input.text,
    notes: ['Texte fourni manuellement par l\'utilisateur.'],
  };

  tracker.mark('source-detected', 'done', platform);
  tracker.mark('content-fetched', 'done', 'Texte saisi manuellement');
  tracker.mark('media-analyzed', 'skipped', 'Saisie manuelle');
  tracker.mark('transcript-ready', 'skipped', 'Saisie manuelle');

  const record = existingImportId
    ? await prisma.import.update({
        where: { id: existingImportId },
        data: {
          status: 'generating',
          rawText: input.text,
          errorCode: null,
          error: null,
          steps: serializeJson(tracker.snapshot()) ?? '[]',
        },
      })
    : await prisma.import.create({
        data: {
          userId,
          url: url || 'saisie-manuelle',
          platform,
          status: 'generating',
          rawText: input.text,
          steps: serializeJson(tracker.snapshot()) ?? '[]',
        },
      });

  try {
    return await generateAndStore(record.id, content, tracker, platform);
  } catch (error) {
    return failImport(record.id, platform, tracker, error);
  }
}

/** Partie commune aux deux chemins : génération, validation, stockage. */
async function generateAndStore(
  importId: string,
  content: ExtractedContent,
  tracker: StepTracker,
  platform: Platform,
): Promise<ImportResult> {
  tracker.mark('ingredients-found', 'running');

  const generation = await generateRecipe(content);
  const recipe = generation.recipe;

  // Ces deux étapes sont franchies ensemble par la génération ; on les
  // marque après coup, avec le décompte réel.
  tracker.mark(
    'ingredients-found',
    'done',
    `${recipe.ingredients.length} ingrédient${recipe.ingredients.length > 1 ? 's' : ''}`,
  );
  tracker.mark(
    'steps-generated',
    'done',
    `${recipe.steps.length} étape${recipe.steps.length > 1 ? 's' : ''}`,
  );
  tracker.mark(
    'recipe-ready',
    'done',
    generation.usedAi ? `Générée via ${generation.provider}` : 'Données structurées du site',
  );

  const steps = tracker.snapshot();

  await prisma.import.update({
    where: { id: importId },
    data: {
      status: 'ready',
      draft: serializeJson(recipe),
      steps: serializeJson(steps) ?? '[]',
      aiProvider: generation.provider,
      aiModel: generation.model,
      errorCode: null,
      error: null,
      canRetryManually: false,
    },
  });

  return {
    importId,
    status: 'ready',
    platform,
    steps,
    recipe,
    error: null,
    notes: content.notes,
  };
}

/**
 * Les étapes « vidéo analysée » et « transcription terminée » n'ont de sens
 * que pour une source vidéo, et ne sont `done` que si on a vraiment obtenu
 * une transcription. Sinon : `skipped`, avec la raison.
 */
function markMediaSteps(tracker: StepTracker, content: ExtractedContent): void {
  const isVideo = ['youtube', 'tiktok', 'instagram', 'facebook'].includes(content.platform);

  if (!isVideo) {
    tracker.mark('media-analyzed', 'skipped', 'Contenu texte');
    tracker.mark('transcript-ready', 'skipped', 'Contenu texte');
    return;
  }

  tracker.mark('media-analyzed', 'done', content.author ? `@${content.author}` : null);

  if (content.transcript) {
    const words = content.transcript.split(/\s+/).length;
    tracker.mark('transcript-ready', 'done', `${words} mots`);
    return;
  }

  // Distinguer « la vidéo n'a pas de sous-titres » de « la plateforme nous en
  // refuse l'accès » : ce sont deux situations différentes pour l'utilisateur,
  // et la seconde n'est pas un défaut de la vidéo qu'il a choisie.
  const blocked = content.metadata['transcriptBlocked'] === true;

  tracker.mark(
    'transcript-ready',
    'skipped',
    blocked
      ? 'Sous-titres présents mais inaccessibles depuis un serveur'
      : content.platform === 'youtube'
        ? 'Aucun sous-titre disponible'
        : 'Transcription non accessible sur cette plateforme',
  );
}

/** Enregistre l'échec et renvoie un résultat exploitable par le client. */
async function failImport(
  importId: string,
  platform: Platform,
  tracker: StepTracker,
  error: unknown,
): Promise<ImportResult> {
  const appErr: AppError = isAppError(error)
    ? error
    : appError('INTERNAL', {
        detail: error instanceof Error ? error.message : String(error),
        canRetryManually: true,
      });

  if (!isAppError(error)) {
    console.error('[import] erreur inattendue', error);
  }

  tracker.failCurrent(appErr.message);
  const steps = tracker.snapshot();

  await prisma.import.update({
    where: { id: importId },
    data: {
      status: 'failed',
      errorCode: appErr.code,
      error: appErr.message,
      canRetryManually: appErr.canRetryManually,
      steps: serializeJson(steps) ?? '[]',
    },
  });

  return {
    importId,
    status: 'failed',
    platform,
    steps,
    recipe: null,
    error: {
      code: appErr.code,
      message: appErr.message,
      canRetryManually: appErr.canRetryManually,
    },
    notes: [],
  };
}

/** Relit un import (pour rouvrir une prévisualisation). */
export async function getImport(userId: string, importId: string) {
  const record = await prisma.import.findFirst({ where: { id: importId, userId } });
  if (!record) return null;

  return {
    importId: record.id,
    url: record.url,
    status: record.status,
    platform: record.platform as Platform,
    steps: parseJson<ImportStep[]>(record.steps, []),
    recipe: parseJson<GeneratedRecipe | null>(record.draft, null),
    rawText: record.rawText,
    transcript: record.transcript,
    error: record.errorCode
      ? {
          code: record.errorCode,
          message: record.error ?? '',
          canRetryManually: record.canRetryManually,
        }
      : null,
    createdAt: record.createdAt.toISOString(),
  };
}
