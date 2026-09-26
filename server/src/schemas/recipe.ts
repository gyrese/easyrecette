import { z } from 'zod';

/**
 * Contrat unique de la recette.
 *
 * Ce module est la source de vérité : l'IA doit produire exactement cette
 * structure, l'API la renvoie au client, et le formulaire d'édition la valide
 * avant enregistrement. Toute évolution se fait ici en premier.
 *
 * Règle centrale : `null` signifie « l'information n'est pas dans la source ».
 * Aucun défaut n'est inventé à la place (pas de 180 °C par confort, pas de
 * 4 personnes par défaut). Ce qui manque part dans `warnings`.
 */

export const DIFFICULTIES = ['facile', 'moyen', 'difficile'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const CATEGORIES = [
  'apero',
  'entree',
  'plat',
  'dessert',
  'sauce',
  'boisson',
  'accompagnement',
  'petit-dejeuner',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  apero: 'Apéritif',
  entree: 'Entrée',
  plat: 'Plat',
  dessert: 'Dessert',
  sauce: 'Sauce',
  boisson: 'Boisson',
  accompagnement: 'Accompagnement',
  'petit-dejeuner': 'Petit-déjeuner',
};

export const PLATFORMS = [
  'tiktok',
  'instagram',
  'facebook',
  'youtube',
  'web',
  'manual',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  web: 'Web',
  manual: 'Saisie manuelle',
};

/** Minutes. Borne haute large mais finie, pour rejeter les valeurs absurdes. */
const minutes = z.number().int().min(0).max(60 * 24 * 7);

/**
 * Liste de chaînes plafonnée par troncature plutôt que par rejet.
 *
 * Règle appliquée à tous les champs accessoires (équipement, conseils, tags,
 * avertissements) : un dépassement de limite est un problème d'affichage, pas
 * un problème de donnée. Le rejeter ferait perdre une recette entière pour
 * une raison cosmétique. Les entrées vides sont écartées au passage, les
 * entrées trop longues coupées.
 */
function cappedList(maxItems: number, maxLength: number) {
  return z
    .array(z.unknown())
    .default([])
    .transform((items) =>
      items
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, maxLength))
        .filter(Boolean)
        .slice(0, maxItems),
    );
}

export const ingredientSchema = z.object({
  /** null = quantité non précisée. */
  quantity: z.number().positive().max(100_000).nullable(),
  /** Unité libre mais normalisée par normalizeUnit() : "g", "c. à soupe"… */
  unit: z.string().trim().max(32).nullable(),
  /** Le nom de l'ingrédient, sans quantité ni préparation. */
  ingredient: z.string().trim().min(1).max(200),
  /** "émincé", "à température ambiante"… */
  preparation: z.string().trim().max(200).nullable().default(null),
  /** Note libre, typiquement "quantité non précisée" ou note d'estimation. */
  note: z.string().trim().max(200).nullable().default(null),
  /** Regroupement d'affichage : "Poulet", "Sauce". */
  section: z.string().trim().max(80).nullable().default(null),
  /** true si la quantité, l'unité ou cet ingrédient a été déduit par l'IA. */
  isDeduced: z.boolean().default(false),
});
export type RecipeIngredientInput = z.infer<typeof ingredientSchema>;

export const stepSchema = z.object({
  order: z.number().int().min(1).max(200),
  /** Titre court facultatif, affiché en gras en Mode Cuisine. */
  title: z.string().trim().max(120).nullable().default(null),
  instruction: z.string().trim().min(1).max(4000),
  /** Minutes — déclenche le minuteur en Mode Cuisine. */
  duration: minutes.nullable().default(null),
  /** Degrés Celsius. */
  temperature: z.number().int().min(0).max(500).nullable().default(null),
  /** true si cette étape, sa durée ou sa température a été déduite par l'IA. */
  isDeduced: z.boolean().default(false),
  /**
   * Instant de la vidéo d'origine, en secondes, et image extraite à cet
   * instant. Jamais produits par la génération : renseignés en tâche de fond
   * après l'enregistrement (voir services/media/stepFrames.ts). Présents ici
   * pour que le formulaire d'édition les renvoie tels quels.
   */
  videoTime: z.number().min(0).max(3600).nullable().default(null),
  imageUrl: z.string().max(300).nullable().default(null),
});
export type RecipeStepInput = z.infer<typeof stepSchema>;

export const sourceSchema = z.object({
  platform: z.enum(PLATFORMS),
  url: z.string().url().nullable().default(null),
  // Ces deux champs sont purement informatifs (attribution affichée en bas de
  // fiche). Ils sont TRONQUÉS plutôt que refusés : certaines plateformes
  // mettent toute la légende dans <title> (Facebook préfixe même par
  // « 112 K vues · 3,2 K réactions | … »), et rejeter la recette entière pour
  // un libellé trop long serait absurde — l'utilisateur perdrait une recette
  // correctement extraite à cause d'une métadonnée décorative.
  author: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .transform((value) => (value ? value.slice(0, 200) : value)),
  originalTitle: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .transform((value) => (value ? value.slice(0, 400) : value)),
});

/**
 * Structure que l'IA doit rendre, et que le formulaire de prévisualisation
 * édite. Volontairement permissive sur les champs facultatifs (tout ce qui
 * est inconnu vaut null / []) et stricte sur le minimum vital : un titre,
 * au moins un ingrédient, au moins une étape.
 */
export const generatedRecipeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),

  servings: z.number().int().min(1).max(100).nullable().default(null),
  servingsDeduced: z.boolean().default(false),

  prepTime: minutes.nullable().default(null),
  cookingTime: minutes.nullable().default(null),
  totalTime: minutes.nullable().default(null),

  difficulty: z.enum(DIFFICULTIES).nullable().default(null),
  category: z.enum(CATEGORIES).nullable().default(null),
  cuisine: z.string().trim().max(80).nullable().default(null),

  ingredients: z.array(ingredientSchema).min(1).max(100),
  steps: z.array(stepSchema).min(1).max(100),

  // Ces listes sont informatives : elles enrichissent la fiche mais ne la
  // définissent pas. Elles sont donc TRONQUÉES, jamais rejetées — cf. le
  // commentaire sur `warnings` plus bas, qui explique pourquoi c'est important.
  equipment: cappedList(30, 120),
  tips: cappedList(20, 600),
  tags: cappedList(20, 60),

  imageUrl: z.string().url().nullable().default(null),

  source: sourceSchema,

  /** 0..1 — à quel point la source contenait vraiment une recette exploitable. */
  confidence: z.number().min(0).max(1).default(0.5),

  /**
   * Ce que l'IA n'a pas trouvé et n'a pas inventé.
   * Affiché tel quel à l'utilisateur au-dessus de la prévisualisation.
   *
   * TRONQUÉE, jamais rejetée. Le point est important : le prompt demande au
   * modèle de signaler chaque information absente, donc une recette riche en
   * ingrédients sans quantité précise en génère mécaniquement beaucoup. Avec
   * un `.max()` bloquant, une recette parfaitement extraite était refusée
   * parce qu'elle était trop honnête — observé à 50 % des tentatives sur une
   * vraie publication. Une limite de confort d'affichage ne doit jamais
   * invalider la donnée qu'elle accompagne.
   */
  warnings: cappedList(20, 400),
});
export type GeneratedRecipe = z.infer<typeof generatedRecipeSchema>;

/** Payload d'enregistrement : une recette générée/éditée + le lien d'import. */
export const saveRecipeSchema = generatedRecipeSchema.extend({
  importId: z.string().cuid().nullable().default(null),
});
export type SaveRecipeInput = z.infer<typeof saveRecipeSchema>;

/** Mise à jour partielle depuis la fiche recette. */
export const updateRecipeSchema = generatedRecipeSchema
  .omit({ source: true, confidence: true, warnings: true })
  .partial()
  .extend({
    isFavorite: z.boolean().optional(),
  });
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;

/**
 * Publication d'une recette.
 *
 * Endpoint dédié plutôt qu'un champ de `updateRecipeSchema` : publier n'est
 * pas corriger une faute de frappe. C'est un geste qui rend une fiche
 * visible par des inconnus, et il doit être impossible de le déclencher par
 * inadvertance en enregistrant un formulaire d'édition.
 */
export const visibilitySchema = z.object({
  isPublic: z.boolean(),
  /**
   * Nom d'auteur à afficher, posé au moment de la première publication.
   * Enregistré sur le compte, pas sur la recette : on ne publie pas sous
   * trois pseudos différents selon la fiche.
   */
  displayName: z.string().trim().max(60).nullable().optional(),
});
export type VisibilityInput = z.infer<typeof visibilitySchema>;

/**
 * Notation d'une recette essayée.
 *
 * `rating` à null n'est pas « zéro étoile » mais « je retire ma note » : la
 * recette redevient non essayée, et le badge disparaît du fichier. C'est la
 * seule façon d'annuler une notation faite par erreur, d'où le nullable
 * explicite plutôt qu'un simple optionnel.
 *
 * `triedAt` n'est pas dans le payload : c'est le serveur qui horodate. Le
 * client n'a pas à décider quand la recette a été cuisinée, et une horloge
 * de navigateur déréglée ne doit pas pouvoir dater un essai en 2041.
 */
export const rateRecipeSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable(),
  /** Le commentaire d'essai. Tronqué, jamais rejeté : cf. cappedList. */
  note: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .default(null)
    .transform((value) => (value ? value : null)),
});
export type RateRecipeInput = z.infer<typeof rateRecipeSchema>;

export const recipeQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.enum(CATEGORIES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  cuisine: z.string().trim().max(80).optional(),
  tag: z.string().trim().max(60).optional(),
  favorite: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .transform((v) => v === '1' || v === 'true')
    .optional(),
  /** '1' = uniquement les recettes déjà essayées, '0' = uniquement celles à tester. */
  tried: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .transform((v) => v === '1' || v === 'true')
    .optional(),
  /** Note plancher : 4 pour « mes valeurs sûres ». */
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  maxTime: z.coerce.number().int().min(1).max(10_000).optional(),
  sort: z
    .enum(['recent', 'title', 'time', 'favorite', 'rating'])
    .default('recent'),
  take: z.coerce.number().int().min(1).max(100).default(60),
  skip: z.coerce.number().int().min(0).default(0),
});
export type RecipeQuery = z.infer<typeof recipeQuerySchema>;

/**
 * Requête de la page Découvrir.
 *
 * Volontairement plus pauvre que `recipeQuerySchema` : pas de favori, de note
 * ni de « déjà essayée », qui n'ont de sens que sur son propre fichier. On ne
 * partage pas ses notes personnelles en publiant une recette.
 */
export const discoverQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.enum(CATEGORIES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  cuisine: z.string().trim().max(80).optional(),
  tag: z.string().trim().max(60).optional(),
  maxTime: z.coerce.number().int().min(1).max(10_000).optional(),
  /** 'recent' = dernières publiées, 'popular' = les plus copiées. */
  sort: z.enum(['recent', 'title', 'time', 'popular']).default('recent'),
  take: z.coerce.number().int().min(1).max(100).default(60),
  skip: z.coerce.number().int().min(0).default(0),
});
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
