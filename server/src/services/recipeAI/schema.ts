import { CATEGORIES, DIFFICULTIES } from '../../schemas/recipe.js';

/**
 * Schéma JSON envoyé aux providers pour contraindre la sortie.
 *
 * Volontairement distinct du schéma Zod de src/schemas/recipe.ts :
 *  - les modes JSON stricts (OpenAI `strict`, Gemini `responseSchema`)
 *    refusent les valeurs par défaut et exigent que TOUS les champs soient
 *    requis, la nullabilité passant par le type ;
 *  - on veut pouvoir faire évoluer le prompt sans toucher au modèle métier.
 *
 * La sortie du modèle est de toute façon revalidée par Zod ensuite : ce schéma
 * est une aide au modèle, pas la garantie finale.
 */

const nullableString = { type: ['string', 'null'] } as const;
const nullableNumber = { type: ['number', 'null'] } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;

export const RECIPE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'description',
    'servings',
    'servingsDeduced',
    'prepTime',
    'cookingTime',
    'totalTime',
    'difficulty',
    'category',
    'cuisine',
    'ingredients',
    'steps',
    'equipment',
    'tips',
    'tags',
    'confidence',
    'warnings',
  ],
  properties: {
    title: { type: 'string', description: 'Titre de la recette, en français.' },
    description: {
      type: 'string',
      description: 'Deux ou trois phrases décrivant le plat. Chaîne vide si rien à dire.',
    },
    servings: {
      ...nullableInteger,
      description: 'Nombre de portions (estimé de façon réaliste si non précisé).',
    },
    servingsDeduced: {
      type: 'boolean',
      description: "true si le nombre de portions a été déduit / estimé par l'IA car absent de la source ; false si précisé.",
    },
    prepTime: { ...nullableInteger, description: 'Temps de préparation en minutes, ou null.' },
    cookingTime: { ...nullableInteger, description: 'Temps de cuisson en minutes, ou null.' },
    totalTime: { ...nullableInteger, description: 'Temps total en minutes, ou null.' },
    difficulty: {
      type: ['string', 'null'],
      enum: [...DIFFICULTIES, null],
      description: 'Difficulté, ou null si non déterminable.',
    },
    category: {
      type: ['string', 'null'],
      enum: [...CATEGORIES, null],
      description: 'Catégorie du plat, ou null.',
    },
    cuisine: {
      ...nullableString,
      description: 'Origine culinaire ("japonaise", "italienne", "créole"), ou null.',
    },
    ingredients: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quantity', 'unit', 'ingredient', 'preparation', 'note', 'section', 'isDeduced'],
        properties: {
          quantity: {
            ...nullableNumber,
            description: 'Quantité numérique. Déduis une quantité réaliste si absente de la source (et passe isDeduced à true).',
          },
          unit: { ...nullableString, description: 'Unité normalisée, ou null.' },
          ingredient: { type: 'string', description: "Nom seul de l'ingrédient." },
          preparation: { ...nullableString, description: '"émincé", "à température ambiante"…' },
          note: { ...nullableString, description: 'Note libre le cas échéant, ou null.' },
          section: { ...nullableString, description: 'Groupe : "Sauce", "Poulet"… ou null.' },
          isDeduced: {
            type: 'boolean',
            description: "true si la quantité, l'unité ou cet ingrédient a été déduit / estimé par l'IA car absent de la vidéo ou de la source ; false si explicitement mentionné.",
          },
        },
      },
    },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['order', 'title', 'instruction', 'duration', 'temperature', 'isDeduced'],
        properties: {
          order: { type: 'integer', description: "Numéro d'étape, à partir de 1." },
          title: { ...nullableString, description: 'Titre court de l\'étape, ou null.' },
          instruction: {
            type: 'string',
            description: "Instruction à l'impératif. Si un élément spécifique (durée, température, quantité, précision) a été déduit par l'IA car absent de la vidéo/source, encadre-le impérativement de balises <mark>...</mark> (ex: « Enfourner à <mark>180 °C</mark> pendant <mark>25 minutes</mark> »).",
          },
          duration: { ...nullableInteger, description: 'Durée de cette étape en minutes, ou null.' },
          temperature: { ...nullableInteger, description: 'Température en °C, ou null.' },
          isDeduced: {
            type: 'boolean',
            description: "true si cette étape, sa durée ou sa température a été déduite / complétée par l'IA car absente de la source.",
          },
        },
      },
    },
    equipment: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ustensiles explicitement mentionnés. Tableau vide si aucun.',
    },
    tips: {
      type: 'array',
      items: { type: 'string' },
      description: 'Conseils donnés dans la source. Tableau vide si aucun.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Mots-clés de recherche.',
    },
    confidence: {
      type: 'number',
      description: '0 à 1 : fiabilité de l\'extraction.',
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Une ligne par information manquante ou déduite.',
    },
  },
} as const;

/**
 * Gemini n'accepte pas `additionalProperties` ni les types union `["string","null"]`.
 * Il utilise `nullable: true` et un sous-ensemble d'OpenAPI 3.0.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const source = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (key === 'additionalProperties') continue;

    if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((t) => t !== 'null');
      out['type'] = types[0] ?? 'string';
      if (value.includes('null')) out['nullable'] = true;
      continue;
    }

    if (key === 'enum' && Array.isArray(value)) {
      // Gemini refuse null dans un enum ; la nullabilité est déjà portée
      // par `nullable: true` posé juste au-dessus.
      out['enum'] = value.filter((v) => v !== null);
      continue;
    }

    out[key] = toGeminiSchema(value);
  }

  return out;
}
