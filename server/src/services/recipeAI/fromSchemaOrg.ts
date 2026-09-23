import type { ExtractedContent } from '../../schemas/import.js';
import {
  CATEGORIES,
  generatedRecipeSchema,
  type Category,
  type GeneratedRecipe,
} from '../../schemas/recipe.js';
import { parseDuration, parseServings, type SchemaRecipe } from '../importers/htmlExtract.js';
import { parseIngredientLine } from './parseIngredientLine.js';

/**
 * Conversion directe Schema.org → recette, sans IA (§4).
 *
 * Quand un site publie déjà sa recette en JSON-LD, ses données sont meilleures
 * que ce qu'une IA reformulerait : quantités exactes, ordre des étapes,
 * temps renseignés par l'auteur. On les reprend telles quelles.
 *
 * Retourne null si les données sont trop incomplètes — l'appelant bascule
 * alors sur le chemin IA.
 */

/** Il faut au minimum des ingrédients ET des étapes pour se passer de l'IA. */
const MIN_INGREDIENTS = 2;
const MIN_STEPS = 1;

/** Mappe recipeCategory (texte libre, souvent en anglais) vers nos catégories. */
function mapCategory(value: string | undefined): Category | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const rules: Array<[RegExp, Category]> = [
    [/apero|aperitif|amuse|appetizer|snack/, 'apero'],
    [/entree|starter|hors.?d.?oeuvre/, 'entree'],
    [/dessert|sweet|gateau|patisserie|cake/, 'dessert'],
    [/sauce|condiment|dressing|marinade/, 'sauce'],
    [/boisson|drink|cocktail|beverage|smoothie/, 'boisson'],
    [/accompagnement|side|garniture/, 'accompagnement'],
    [/petit.?dejeuner|breakfast|brunch/, 'petit-dejeuner'],
    [/plat|main|dinner|lunch|dish/, 'plat'],
  ];

  for (const [pattern, category] of rules) {
    if (pattern.test(normalized)) return category;
  }

  // Valeur déjà conforme à notre nomenclature ?
  return CATEGORIES.find((c) => c === normalized) ?? null;
}

/**
 * Une étape peut être préfixée par "[Nom de section]" (posé par flattenInstructions).
 * On l'utilise comme titre d'étape plutôt que de le perdre.
 */
function splitInstructions(instructions: string[]): Array<{ title: string | null; text: string }> {
  const out: Array<{ title: string | null; text: string }> = [];
  let pendingTitle: string | null = null;

  for (const raw of instructions) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const sectionMarker = trimmed.match(/^\[(.+)\]$/);
    if (sectionMarker?.[1]) {
      pendingTitle = sectionMarker[1].trim();
      continue;
    }

    out.push({ title: pendingTitle, text: trimmed });
    pendingTitle = null;
  }

  return out;
}

export function recipeFromSchemaOrg(content: ExtractedContent): GeneratedRecipe | null {
  const schema = content.structuredRecipe as SchemaRecipe | null;
  if (!schema) return null;

  const rawIngredients = schema.recipeIngredient ?? [];
  const rawInstructions = schema.recipeInstructions ?? [];

  const parsedIngredients = rawIngredients
    .map((line) => parseIngredientLine(line))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const parsedSteps = splitInstructions(rawInstructions);

  if (parsedIngredients.length < MIN_INGREDIENTS || parsedSteps.length < MIN_STEPS) {
    return null;
  }

  const warnings: string[] = [];

  const servings = parseServings(schema.recipeYield);
  if (servings === null) warnings.push('Nombre de portions non précisé dans la source.');

  const prepTime = parseDuration(schema.prepTime);
  const cookingTime = parseDuration(schema.cookTime);
  const totalTime =
    parseDuration(schema.totalTime) ??
    (prepTime !== null && cookingTime !== null ? prepTime + cookingTime : null);

  if (totalTime === null) warnings.push('Durée non précisée dans la source.');

  const missingQuantities = parsedIngredients.filter((i) => i.quantity === null).length;
  if (missingQuantities > 0) {
    warnings.push(
      missingQuantities === 1
        ? "Un ingrédient n'a pas de quantité précisée dans la source."
        : `${missingQuantities} ingrédients n'ont pas de quantité précisée dans la source.`,
    );
  }

  const candidate = {
    title: schema.name ?? content.title ?? 'Recette sans titre',
    description: schema.description ?? '',
    servings,
    prepTime,
    cookingTime,
    totalTime,
    // Schema.org ne définit pas de champ de difficulté : on ne l'invente pas.
    difficulty: null,
    category: mapCategory(schema.recipeCategory),
    cuisine: schema.recipeCuisine ?? null,

    ingredients: parsedIngredients.map((item) => ({
      quantity: item.quantity,
      unit: item.unit,
      ingredient: item.ingredient,
      preparation: item.preparation,
      note: item.note,
      section: null,
    })),

    steps: parsedSteps.map((step, index) => ({
      order: index + 1,
      title: step.title,
      instruction: step.text,
      duration: null,
      temperature: null,
    })),

    equipment: [],
    tips: [],
    tags: (schema.keywords ?? []).slice(0, 20),

    imageUrl: schema.image?.[0] ?? content.images[0] ?? null,

    source: {
      platform: content.platform,
      // Même précaution que dans index.ts : seul un vrai lien http(s) part
      // dans source.url, sinon la validation rejetterait toute la recette.
      url: /^https?:\/\//.test(content.sourceUrl) ? content.sourceUrl : null,
      author: schema.author ?? content.author ?? null,
      originalTitle: schema.name ?? content.title ?? null,
    },

    // Données publiées par le site lui-même : fiabilité élevée.
    confidence: 0.95,
    warnings,
  };

  const result = generatedRecipeSchema.safeParse(candidate);
  // Un échec ici signifie que les données du site sont trop bancales :
  // on laisse l'IA prendre le relais plutôt que de propager du bruit.
  return result.success ? result.data : null;
}
