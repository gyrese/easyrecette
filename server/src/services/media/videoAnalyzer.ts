import { GoogleGenAI, MediaResolution } from '@google/genai';
import { config } from '../../config.js';
import { appError } from '../../utils/errors.js';
import { readVideoBase64, type FetchedVideo } from './videoFetcher.js';

/**
 * Analyse visuelle d'une vidéo de recette.
 *
 * Dernier recours du pipeline : on n'y arrive que lorsque la légende et les
 * sous-titres n'ont rien donné. Le modèle regarde la vidéo et rend un compte
 * rendu textuel — texte incrusté à l'écran, paroles éventuelles, et gestes
 * observés. Ce compte rendu est ensuite traité comme n'importe quelle autre
 * source par le service de génération.
 *
 * Vérifié en conditions réelles sur un Reel sans légende, sans sous-titres et
 * sans voix off : le modèle a reconstitué la recette à partir des seuls gestes
 * (épluchage, mandoline, cuisson, dressage), en notant « non précisé » pour
 * chaque quantité absente.
 *
 * Seul Gemini est utilisé ici : c'est le seul des trois fournisseurs
 * configurables à accepter une vidéo en entrée à un coût raisonnable.
 */

/** Deux minutes : le modèle prend ~20 s pour 30 s de vidéo. */
const ANALYSIS_TIMEOUT_MS = 120_000;

const ANALYSIS_PROMPT = `Cette vidéo montre la préparation d'un plat. Ton travail est de relever TOUT ce qui permet de reconstituer la recette.

Trois sources d'information, par ordre de fiabilité :

1. LE TEXTE INCRUSTÉ À L'ÉCRAN — c'est le plus fiable. Beaucoup de vidéos de cuisine affichent la liste des ingrédients avec les quantités, et les étapes. Relève ce texte mot à mot, y compris les nombres et les unités.
2. CE QUI EST DIT — s'il y a une voix, transcris les informations de recette.
3. LES GESTES VISIBLES — ce qui est épluché, coupé, versé, mélangé, cuit, et dans quel ordre.

Rends un compte rendu factuel en français, structuré ainsi :

TEXTE À L'ÉCRAN :
(tout le texte lu à l'écran, ou « aucun »)

PAROLES :
(ce qui est dit, ou « aucune »)

INGRÉDIENTS OBSERVÉS :
(un par ligne, avec la quantité UNIQUEMENT si elle est écrite ou dite)

ÉTAPES OBSERVÉES :
(dans l'ordre, une action par ligne)

RÈGLE FACTUELLE : distingue ce qui est explicitement dit/écrit de ce qui n'est que visible.
Si une quantité n'est ni écrite ni dite, écris « non précisé » (tu peux ajouter une estimation visuelle indicative entre parenthèses si le geste est net, ex: « non précisé (visuel : environ 2 c. à soupe) »).
Si tu vois un four ou une cuisson sans que la température soit indiquée, écris « température non précisée ».

Si la vidéo ne montre pas de préparation culinaire, réponds uniquement : PAS_UNE_RECETTE`;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: config.ai.gemini.apiKey ?? '' });
  return client;
}

export function isVideoAnalysisConfigured(): boolean {
  return Boolean(config.ai.gemini.apiKey);
}

export interface VideoAnalysis {
  /** Compte rendu textuel, prêt à être passé au générateur de recette. */
  report: string;
  model: string;
  /** Tokens consommés, pour information dans les logs. */
  tokens: number | null;
}

export async function analyzeVideo(video: FetchedVideo): Promise<VideoAnalysis> {
  if (!isVideoAnalysisConfigured()) {
    throw appError('AI_UNAVAILABLE', {
      message:
        "L'analyse vidéo nécessite une clé Gemini (GEMINI_API_KEY) dans server/.env.",
      canRetryManually: true,
    });
  }

  const base64 = await readVideoBase64(video.filePath);
  const model = config.ai.gemini.model;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

  try {
    const response = await getClient().models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: video.mimeType, data: base64 } },
            { text: ANALYSIS_PROMPT },
          ],
        },
      ],
      config: { abortSignal: controller.signal },
    });

    const report = response.text?.trim();

    if (!report) {
      throw appError('NO_CONTENT', {
        message: "L'analyse de la vidéo n'a rien donné.",
        canRetryManually: true,
      });
    }

    if (report.includes('PAS_UNE_RECETTE')) {
      throw appError('NOT_A_RECIPE', {
        message: "Cette vidéo ne montre pas de préparation culinaire.",
        canRetryManually: true,
      });
    }

    return {
      report,
      model,
      tokens: response.usageMetadata?.totalTokenCount ?? null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw appError('TIMEOUT', {
        message: "L'analyse de la vidéo a pris trop de temps.",
        canRetryManually: true,
      });
    }

    throw appError('AI_ERROR', {
      message: "L'analyse de la vidéo a échoué.",
      detail: error instanceof Error ? error.message : String(error),
      canRetryManually: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Repérage des étapes dans la vidéo
// ---------------------------------------------------------------------------

/**
 * Le modèle ne voit qu'une image par seconde et n'a pas à lire de texte :
 * la basse résolution suffit pour reconnaître un geste, et divise par quatre
 * les tokens consommés par rapport à l'analyse complète.
 */
const LOCATE_PROMPT = (steps: string) => `Voici une vidéo de recette et la liste de ses étapes.

Pour CHAQUE étape, indique l'instant de la vidéo (au format MM:SS) où le geste qu'elle décrit est le plus clairement visible à l'écran : les mains en action, l'ingrédient versé, la préparation en cours de cuisson. Évite les instants où l'image est couverte par du texte ou montre le visage de la personne qui parle.

Si une étape n'est pas montrée dans la vidéo (étape déduite, temps de repos, préchauffage non filmé), mets timestamp à null plutôt que de choisir un instant au hasard.

Les instants doivent suivre l'ordre de la vidéo, pas forcément celui de la liste.

ÉTAPES :
${steps}`;

const LOCATE_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          order: { type: 'integer' },
          timestamp: { type: 'string', nullable: true, description: 'MM:SS, ou null.' },
        },
        required: ['order', 'timestamp'],
      },
    },
  },
  required: ['steps'],
};

/** "1:05", "01:05" ou "0:01:05" → 65. null si illisible. */
export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:\.\d+)?\s*$/.exec(value);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  const total = Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) ? total : null;
}

/**
 * Demande au modèle à quel instant de la vidéo chaque étape est montrée.
 *
 * Renvoie une table ordre d'étape → secondes. Une étape absente de la table
 * n'a pas été repérée : c'est un résultat normal, pas une erreur.
 */
export async function locateStepsInVideo(
  video: Pick<FetchedVideo, 'filePath' | 'mimeType'>,
  steps: { order: number; instruction: string }[],
): Promise<Map<number, number>> {
  if (!isVideoAnalysisConfigured()) {
    throw appError('AI_UNAVAILABLE', {
      message: "Le repérage des étapes nécessite une clé Gemini (GEMINI_API_KEY).",
    });
  }

  const base64 = await readVideoBase64(video.filePath);
  const list = steps
    .map((step) => `${step.order}. ${step.instruction.replace(/<\/?mark>/g, '')}`)
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

  try {
    const response = await getClient().models.generateContent({
      model: config.ai.gemini.stepsModel,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: video.mimeType, data: base64 } },
            { text: LOCATE_PROMPT(list) },
          ],
        },
      ],
      config: {
        abortSignal: controller.signal,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
        responseMimeType: 'application/json',
        responseSchema: LOCATE_SCHEMA,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}') as {
      steps?: { order?: unknown; timestamp?: unknown }[];
    };

    const known = new Set(steps.map((step) => step.order));
    const located = new Map<number, number>();

    for (const item of parsed.steps ?? []) {
      if (typeof item.order !== 'number' || !known.has(item.order)) continue;
      const seconds = parseTimestamp(typeof item.timestamp === 'string' ? item.timestamp : null);
      if (seconds !== null) located.set(item.order, seconds);
    }

    return located;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw appError('TIMEOUT', { message: 'Le repérage des étapes a pris trop de temps.' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
