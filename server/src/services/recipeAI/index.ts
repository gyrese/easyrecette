import type { ExtractedContent } from '../../schemas/import.js';
import {
  generatedRecipeSchema,
  type GeneratedRecipe,
} from '../../schemas/recipe.js';
import { appError, isAppError } from '../../utils/errors.js';
import { normalizeUnit } from '../../utils/units.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { getAvailableAdapters } from './providers.js';
import { recipeFromSchemaOrg } from './fromSchemaOrg.js';

/**
 * Génération d'une recette structurée à partir d'un contenu extrait.
 *
 * Deux chemins :
 *  A. La page contenait déjà une recette Schema.org complète → on la convertit
 *     directement, sans appel IA. C'est plus fidèle, gratuit et instantané (§4).
 *  B. Sinon → appel IA, avec repli sur les autres providers configurés.
 *
 * Dans les deux cas, la sortie repasse par le schéma Zod : rien n'entre en
 * base sans avoir été validé.
 */

export interface GenerationResult {
  recipe: GeneratedRecipe;
  /** null quand la recette vient directement de Schema.org. */
  provider: string | null;
  model: string | null;
  usedAi: boolean;
}

export function isAiConfigured(): boolean {
  return getAvailableAdapters().length > 0;
}

export async function generateRecipe(content: ExtractedContent): Promise<GenerationResult> {
  // --- Chemin A : données structurées du site ---
  const fromSchema = recipeFromSchemaOrg(content);
  if (fromSchema) {
    return { recipe: normalize(fromSchema), provider: null, model: null, usedAi: false };
  }

  // --- Chemin B : génération IA ---
  const adapters = getAvailableAdapters();
  if (adapters.length === 0) {
    throw appError('AI_UNAVAILABLE', {
      message:
        "Aucune clé d'IA n'est configurée sur le serveur. Ajoute ANTHROPIC_API_KEY, OPENAI_API_KEY ou GEMINI_API_KEY dans server/.env, ou saisis la recette à la main.",
      status: 503,
      canRetryManually: true,
    });
  }

  const system = SYSTEM_PROMPT;
  const user = buildUserPrompt(content);

  let lastError: unknown = null;

  for (const adapter of adapters) {
    /*
     * Deux tentatives par provider.
     *
     * La génération est stochastique : sur une même source, le modèle peut
     * rendre une recette impeccable puis, au tirage suivant, une sortie qui
     * viole le schéma. Abandonner au premier écart transforme un aléa en
     * échec visible pour l'utilisateur, alors qu'un simple nouvel essai
     * aboutit la plupart du temps.
     *
     * On ne réessaie que les défauts de forme. Un rate limit, une panne ou un
     * contenu qui n'est pas une recette ne s'améliorent pas en insistant :
     * ils sortent immédiatement de la boucle.
     */
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await adapter.generate(system, user);
        const parsed = parseAndValidate(result.json, content);
        assertLooksLikeRecipe(parsed);
        return {
          recipe: normalize(parsed),
          provider: result.provider,
          model: result.model,
          usedAi: true,
        };
      } catch (error) {
        lastError = error;

        // Diagnostic définitif : ni un autre essai ni un autre provider
        // n'y changeront quoi que ce soit.
        if (
          isAppError(error) &&
          ['NOT_A_RECIPE', 'AI_UNAVAILABLE', 'NO_CONTENT'].includes(error.code)
        ) {
          throw error;
        }

        // Rate limit ou panne du fournisseur : passer au suivant sans
        // gaspiller une seconde tentative sur celui-ci.
        if (isAppError(error) && ['RATE_LIMITED', 'AI_ERROR', 'TIMEOUT'].includes(error.code)) {
          break;
        }
      }
    }
  }

  if (isAppError(lastError)) throw lastError;
  throw appError('AI_ERROR', {
    detail: lastError instanceof Error ? lastError.message : String(lastError),
    canRetryManually: true,
  });
}

/**
 * Refuse une sortie qui décrit autre chose qu'une recette.
 *
 * Le prompt demande au modèle de le signaler plutôt que d'inventer un plat ;
 * il le fait via une confiance très basse et un warning explicite. Sans ce
 * garde-fou, l'utilisateur arriverait sur la prévisualisation d'un « vlog
 * d'appartement » présenté comme une recette — exactement le faux succès que
 * le cahier des charges proscrit (§15).
 *
 * Deux signaux plutôt qu'un seul : une confiance basse peut légitimement
 * accompagner une vraie recette mal transcrite, et le warning seul pourrait
 * venir d'une formulation maladroite. C'est leur conjonction qui tranche.
 */
function assertLooksLikeRecipe(recipe: GeneratedRecipe): void {
  const saysNotARecipe = recipe.warnings.some((warning) =>
    /n'est pas une recette|pas une recette de cuisine|aucune recette/i.test(warning),
  );

  if (saysNotARecipe && recipe.confidence <= 0.3) {
    throw appError('NOT_A_RECIPE', { canRetryManually: true });
  }

  /*
   * Fiche squelettique.
   *
   * Cas observé en conditions réelles : une publication dont la légende n'est
   * qu'un titre et des hashtags (« Bœuf aux oignons 🥩🧅 #recette #food… »),
   * la recette n'existant que dans l'audio de la vidéo. Le modèle rend alors
   * honnêtement 1 ingrédient et 1 étape — ce qui passe la validation du
   * schéma (min 1) et produit une fiche vide présentée comme prête.
   *
   * C'est exactement le faux succès proscrit au §2 : mieux vaut dire que la
   * source ne contient pas la recette et proposer la saisie manuelle.
   *
   * Le seuil est volontairement bas (2) : une vraie recette minimaliste
   * (« pâtes au beurre ») a au moins deux ingrédients et deux étapes, alors
   * qu'une légende sans contenu n'en produit jamais autant.
   */
  const tooThin = recipe.ingredients.length < 2 && recipe.steps.length < 2;

  if (tooThin) {
    throw appError('NO_CONTENT', {
      message:
        "La publication ne contient que son titre : la recette n'est pas écrite dans la description. Colle le texte de la recette à la main pour continuer.",
      canRetryManually: true,
    });
  }
}

/** Vrai seulement pour une adresse http(s) exploitable. */
function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Parse la réponse du modèle et la valide.
 * Les providers peuvent encadrer le JSON de ```json … ``` malgré la contrainte
 * de format ; on nettoie avant de parser.
 */
function parseAndValidate(raw: string, content: ExtractedContent): GeneratedRecipe {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Dernier recours : isoler le premier objet JSON complet du texte.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw appError('AI_INVALID_JSON', { canRetryManually: true });
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw appError('AI_INVALID_JSON', { canRetryManually: true });
    }
  }

  // Le modèle ne renseigne pas `source` : c'est nous qui la connaissons.
  const withSource = {
    ...(parsed as Record<string, unknown>),
    source: {
      platform: content.platform,
      // Une saisie manuelle n'a pas d'URL d'origine : le pipeline y place un
      // libellé interne, qui n'est pas une URL et n'a rien à faire dans le
      // champ source. On ne garde que ce qui est réellement une adresse.
      url: isHttpUrl(content.sourceUrl) ? content.sourceUrl : null,
      author: content.author,
      originalTitle: content.title,
    },
    imageUrl: content.images[0] ?? null,
  };

  const result = generatedRecipeSchema.safeParse(withSource);

  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(' ; ');

    // Un modèle qui rend 0 ingrédient ou 0 étape n'a pas mal travaillé : il
    // n'avait pas la matière. Deux causes très différentes pour l'utilisateur,
    // qu'on distingue au lieu de l'accuser d'avoir collé un mauvais lien.
    const missingIngredients = result.error.issues.some(
      (issue) => issue.path[0] === 'ingredients' && issue.code === 'too_small',
    );
    const missingSteps = result.error.issues.some(
      (issue) => issue.path[0] === 'steps' && issue.code === 'too_small',
    );

    if (missingIngredients || missingSteps) {
      // Cas typique d'une légende coupée par la plateforme (Facebook,
      // Instagram) : la liste d'ingrédients est là, la préparation manque.
      const truncated = content.metadata['captionTruncated'] === true;

      if (missingSteps && !missingIngredients) {
        throw appError('NO_CONTENT', {
          message: truncated
            ? "La plateforme n'a fourni qu'un extrait de la publication : les étapes de préparation manquent. Colle le texte complet pour obtenir la recette entière."
            : "Les ingrédients ont été identifiés, mais aucune étape de préparation n'apparaît dans la source. Colle le texte complet pour compléter la recette.",
          canRetryManually: true,
        });
      }

      throw appError('NOT_A_RECIPE', {
        message:
          "Ce contenu ne contient pas assez d'éléments pour en faire une recette (aucun ingrédient ou aucune étape identifiée).",
        canRetryManually: true,
      });
    }

    throw appError('AI_INVALID_JSON', {
      message: "L'IA a renvoyé une recette incomplète ou mal formée.",
      detail: issues,
      canRetryManually: true,
    });
  }

  return result.data;
}

/**
 * Derniers ajustements mécaniques après validation :
 *  - unités ramenées à leur forme canonique ;
 *  - étapes renumérotées séquentiellement (les modèles sautent parfois un numéro) ;
 *  - totalTime déduit quand prep et cuisson sont connus — c'est une addition,
 *    pas une invention ;
 *  - note "quantité non précisée" posée systématiquement là où elle manque,
 *    pour que l'affichage soit cohérent même si le modèle l'a oubliée.
 */
function normalize(recipe: GeneratedRecipe): GeneratedRecipe {
  const ingredients = recipe.ingredients.map((ingredient) => ({
    ...ingredient,
    unit: normalizeUnit(ingredient.unit),
    note:
      ingredient.quantity === null && !ingredient.note
        ? 'quantité non précisée'
        : ingredient.note,
  }));

  const steps = recipe.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((step, index) => ({ ...step, order: index + 1 }));

  const totalTime =
    recipe.totalTime ??
    (recipe.prepTime !== null && recipe.cookingTime !== null
      ? recipe.prepTime + recipe.cookingTime
      : null);

  // Dédoublonnage des tags, insensible à la casse.
  const seen = new Set<string>();
  const tags = recipe.tags.filter((tag) => {
    const key = tag.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ...recipe, ingredients, steps, totalTime, tags };
}
