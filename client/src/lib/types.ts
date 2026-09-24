/**
 * Types de l'API, miroir de server/src/schemas/.
 *
 * Dupliqués volontairement plutôt que partagés via un package commun : le
 * projet a deux workspaces, et introduire un troisième package juste pour
 * ces types ajouterait une étape de build à chaque modification. Le contrat
 * est stable et vérifié par Zod côté serveur ; si les deux divergent, c'est
 * le typecheck du client qui le signale à la première utilisation.
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

export type Platform = 'tiktok' | 'instagram' | 'facebook' | 'youtube' | 'web' | 'manual';

export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  web: 'Web',
  manual: 'Saisie manuelle',
};

export interface RecipeIngredient {
  quantity: number | null;
  unit: string | null;
  ingredient: string;
  preparation: string | null;
  note: string | null;
  section: string | null;
}

export interface RecipeStep {
  order: number;
  title: string | null;
  instruction: string;
  duration: number | null;
  temperature: number | null;
}

export interface RecipeSource {
  platform: Platform;
  url: string | null;
  author: string | null;
  originalTitle: string | null;
}

/** Recette telle que produite par l'IA ou éditée, avant enregistrement. */
export interface GeneratedRecipe {
  title: string;
  description: string;
  servings: number | null;
  prepTime: number | null;
  cookingTime: number | null;
  totalTime: number | null;
  difficulty: Difficulty | null;
  category: Category | null;
  cuisine: string | null;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  equipment: string[];
  tips: string[];
  tags: string[];
  imageUrl: string | null;
  source: RecipeSource;
  confidence: number;
  warnings: string[];
}

/** Recette enregistrée, avec ses métadonnées de persistance. */
export interface Recipe extends GeneratedRecipe {
  id: string;
  /** Vidéo d'origine conservée par le serveur, servie sous /media. */
  videoUrl: string | null;
  /** Image extraite de cette vidéo. */
  posterUrl: string | null;
  /**
   * Photo du plat prise par l'utilisateur. Prime sur `imageUrl` partout où la
   * recette est illustrée — voir `displayImage()`.
   */
  userPhotoUrl: string | null;
  isFavorite: boolean;
  /**
   * Note d'essai, 1..5. `null` = recette pas encore essayée : c'est cette
   * distinction, et non la valeur, qui décide du badge dans le fichier.
   */
  rating: number | null;
  /** Commentaire laissé au moment de la notation. */
  ratingNote: string | null;
  /** Date du premier essai. Ne bouge plus si la note est révisée ensuite. */
  triedAt: string | null;
  createdAt: string;
  updatedAt: string;
  importedAt: string | null;

  /** Partagée avec tout le monde, connecté ou non. */
  isPublic: boolean;
  /** Date de la première publication. Sert de tri sur la page Découvrir. */
  publishedAt: string | null;
  /** Nombre de fois que la fiche a été enregistrée par d'autres. */
  copyCount: number;
  /** Auteur, affiché sur les fiches partagées. */
  author: RecipeAuthor;
  /** Renseigné quand la fiche est une copie d'une recette publique. */
  copiedFromId: string | null;
  /**
   * false quand on consulte la fiche publique de quelqu'un d'autre. Le
   * serveur neutralise alors ses annotations privées (note, favori,
   * commentaire d'essai) : ce sont ses jugements, pas du contenu partagé.
   */
  isOwner: boolean;
}

export interface RecipeAuthor {
  id: string;
  /** Nom d'affichage choisi, à défaut le nom du compte, à défaut « Anonyme ». */
  name: string;
  avatarUrl: string | null;
}

/** Nombre maximal d'étoiles. Le barème tient en une main. */
export const MAX_RATING = 5;

/**
 * Libellés du barème, affichés à côté des étoiles au survol et lus par les
 * lecteurs d'écran. Noter, c'est porter un jugement : autant le dire en mots
 * plutôt que de laisser cinq étoiles muettes.
 */
export const RATING_LABELS: Record<number, string> = {
  1: 'Raté',
  2: 'Bof',
  3: 'Correct',
  4: 'Très bon',
  5: 'À refaire',
};

// --- Import ---

export const IMPORT_STEP_KEYS = [
  'source-detected',
  'content-fetched',
  'media-analyzed',
  'transcript-ready',
  'ingredients-found',
  'steps-generated',
  'recipe-ready',
] as const;
export type ImportStepKey = (typeof IMPORT_STEP_KEYS)[number];

export const IMPORT_STEP_LABELS: Record<ImportStepKey, string> = {
  'source-detected': 'Source détectée',
  'content-fetched': 'Contenu récupéré',
  'media-analyzed': 'Vidéo analysée',
  'transcript-ready': 'Transcription terminée',
  'ingredients-found': 'Ingrédients identifiés',
  'steps-generated': 'Étapes générées',
  'recipe-ready': 'Recette prête',
};

export type ImportStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface ImportStep {
  key: ImportStepKey;
  status: ImportStepStatus;
  detail: string | null;
  at: string | null;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  canRetryManually: boolean;
  detail?: string;
}

export interface ImportResult {
  importId: string;
  status: 'ready' | 'failed';
  platform: Platform;
  steps: ImportStep[];
  recipe: GeneratedRecipe | null;
  error: ApiErrorPayload | null;
  notes: string[];
}

export interface DetectResult {
  platform: Platform | null;
  label: string | null;
  valid: boolean;
  aiConfigured?: boolean;
}

// --- Bibliothèque ---

export interface RecipeListResponse {
  recipes: Recipe[];
  total: number;
}

export interface Facets {
  categories: Array<{ value: string; count: number }>;
  cuisines: Array<{ value: string; count: number }>;
  tags: Array<{ value: string; slug: string; count: number }>;
}

export interface RecipeFilters {
  q?: string;
  category?: Category;
  difficulty?: Difficulty;
  cuisine?: string;
  tag?: string;
  favorite?: boolean;
  /** true = déjà essayées, false = encore à tester, undefined = les deux. */
  tried?: boolean;
  /** Note plancher : 4 pour ne garder que les valeurs sûres. */
  minRating?: number;
  maxTime?: number;
  sort?: 'recent' | 'title' | 'time' | 'favorite' | 'rating';
}

// --- Compte ---

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  /** Nom d'auteur choisi pour les recettes publiées. */
  displayName: string | null;
  avatarUrl: string | null;
}

export interface AuthState {
  /** null = visiteur non connecté. Ce n'est pas une erreur. */
  user: AuthUser | null;
  /** false = le serveur n'a pas de clés Google : la connexion est indisponible. */
  googleConfigured: boolean;
}

// --- Découvrir ---

/**
 * Filtres de la page Découvrir.
 *
 * Volontairement plus pauvres que `RecipeFilters` : favori, note et « déjà
 * essayée » n'ont de sens que sur son propre fichier.
 */
export interface DiscoverFilters {
  q?: string;
  category?: Category;
  difficulty?: Difficulty;
  cuisine?: string;
  tag?: string;
  maxTime?: number;
  sort?: 'recent' | 'title' | 'time' | 'popular';
}

// --- Liste de courses ---

export interface ShoppingItem {
  id: string;
  quantity: number | null;
  unit: string | null;
  label: string;
  note: string | null;
  checked: boolean;
  isManual: boolean;
  recipeId: string | null;
  recipeTitle: string | null;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingItem[];
  recipes: Array<{ id: string; title: string }>;
}
