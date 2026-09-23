import { GoogleGenAI } from '@google/genai';
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

RÈGLE ABSOLUE : n'invente aucune quantité, aucune durée, aucune température.
Si une quantité n'est ni écrite ni dite, écris « non précisé » — même si tu peux l'estimer à l'œil. Une estimation visuelle n'est pas une donnée.
Si tu vois un four sans que la température soit indiquée, écris « température non précisée ».

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
