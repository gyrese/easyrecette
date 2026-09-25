import type {
  AuthState,
  AuthUser,
  DetectResult,
  DiscoverFilters,
  Facets,
  GeneratedRecipe,
  ImportResult,
  Recipe,
  RecipeFilters,
  RecipeListResponse,
  ShoppingList,
} from './types';

/**
 * Client HTTP de l'API.
 *
 * Toutes les requêtes passent par `request()`, qui normalise la gestion
 * d'erreur : une réponse non-OK devient une ApiError portant le code et le
 * message français du serveur, directement affichable.
 *
 * L'URL de base est relative (/api) : en développement Vite proxifie vers le
 * serveur, en production le front est servi par le même hôte. Aucune adresse
 * de backend ni clé ne se retrouve dans le bundle.
 */

const BASE = '/api';

export class ApiError extends Error {
  readonly code: string;
  readonly canRetryManually: boolean;
  readonly status: number;

  constructor(
    message: string,
    options: { code?: string; canRetryManually?: boolean; status?: number } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code ?? 'UNKNOWN';
    this.canRetryManually = options.canRetryManually ?? false;
    this.status = options.status ?? 0;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      /*
       * Le cookie de session doit accompagner chaque requête. `same-origin`
       * suffirait en production (le front et l'API partagent l'hôte) mais pas
       * en développement, où Vite proxifie : `include` couvre les deux cas.
       */
      credentials: 'include',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    // Serveur éteint, réseau coupé : distinguer ce cas d'une erreur métier.
    throw new ApiError(
      "Impossible de joindre le serveur. Vérifie qu'il est bien démarré.",
      { code: 'NETWORK', status: 0 },
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; canRetryManually?: boolean } })
      ?.error;
    throw new ApiError(error?.message ?? `Erreur ${response.status}`, {
      code: error?.code,
      canRetryManually: error?.canRetryManually,
      status: response.status,
    });
  }

  return payload as T;
}

// --- Import ---

export const api = {
  health: () => request<{ status: string; aiConfigured: boolean }>('/health'),

  detect: (url: string) =>
    request<DetectResult>(`/import/detect?url=${encodeURIComponent(url)}`),

  /**
   * Lance un import. Renvoie toujours un ImportResult, y compris en cas
   * d'échec : le journal d'étapes fait partie de la réponse utile.
   */
  import: (url: string) =>
    request<ImportResult>('/import', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  /** Reprise manuelle quand la source est inaccessible. */
  importManual: (input: {
    text: string;
    url?: string;
    title?: string;
    author?: string;
    importId?: string;
  }) =>
    request<ImportResult>('/import/manual', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getImport: (id: string) => request<ImportResult & { rawText: string | null }>(`/import/${id}`),

  // --- Compte ---

  /**
   * État de connexion. Répond toujours 200, avec `user: null` si personne
   * n'est connecté : c'est un état normal, pas une erreur.
   */
  me: () => request<AuthState>('/auth/me'),

  /**
   * Départ vers Google.
   *
   * Une navigation complète, pas un fetch : le flux OAuth passe par des
   * redirections que seul le navigateur peut suivre. `next` est la page où
   * revenir après connexion ; le serveur la vérifie (chemin interne
   * uniquement) avant de l'utiliser.
   */
  loginUrl: (next = '/') => `${BASE}/auth/google?next=${encodeURIComponent(next)}`,

  /** Inscription par e-mail. Ouvre la session dans la foulée. */
  signup: (email: string, password: string, name: string | null) =>
    request<AuthState>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  loginWithPassword: (email: string, password: string) =>
    request<AuthState>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  /**
   * Change le mot de passe, ou en définit un sur un compte Google.
   * `currentPassword` est exigé dès qu'un mot de passe existe déjà.
   */
  changePassword: (currentPassword: string | null, newPassword: string) =>
    request<{ user: AuthUser }>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  /** Ferme la session sur tous les appareils. */
  logoutEverywhere: () => request<{ sessions: number }>('/auth/logout-all', { method: 'POST' }),

  /** Change le nom d'auteur affiché sur les recettes publiées. */
  updateProfile: (displayName: string | null) =>
    request<{ user: AuthUser }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    }),

  deleteAccount: () => request<void>('/auth/account', { method: 'DELETE' }),

  // --- Découvrir ---

  discover: (filters: DiscoverFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.category) params.set('category', filters.category);
    if (filters.difficulty) params.set('difficulty', filters.difficulty);
    if (filters.cuisine) params.set('cuisine', filters.cuisine);
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.maxTime) params.set('maxTime', String(filters.maxTime));
    if (filters.sort) params.set('sort', filters.sort);

    const query = params.toString();
    return request<RecipeListResponse>(`/discover${query ? `?${query}` : ''}`);
  },

  discoverFacets: () => request<Facets>('/discover/facets'),

  // --- Recettes ---

  listRecipes: (filters: RecipeFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.category) params.set('category', filters.category);
    if (filters.difficulty) params.set('difficulty', filters.difficulty);
    if (filters.cuisine) params.set('cuisine', filters.cuisine);
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.favorite) params.set('favorite', '1');
    if (filters.tried !== undefined) params.set('tried', filters.tried ? '1' : '0');
    if (filters.minRating) params.set('minRating', String(filters.minRating));
    if (filters.maxTime) params.set('maxTime', String(filters.maxTime));
    if (filters.sort) params.set('sort', filters.sort);

    const query = params.toString();
    return request<RecipeListResponse>(`/recipes${query ? `?${query}` : ''}`);
  },

  facets: () => request<Facets>('/recipes/facets'),

  getRecipe: (id: string) => request<Recipe>(`/recipes/${id}`),

  createRecipe: (recipe: GeneratedRecipe & { importId?: string | null }) =>
    request<Recipe>('/recipes', {
      method: 'POST',
      body: JSON.stringify(recipe),
    }),

  updateRecipe: (id: string, patch: Partial<GeneratedRecipe> & { isFavorite?: boolean }) =>
    request<Recipe>(`/recipes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteRecipe: (id: string) => request<void>(`/recipes/${id}`, { method: 'DELETE' }),

  toggleFavorite: (id: string) => request<Recipe>(`/recipes/${id}/favorite`, { method: 'POST' }),

  /**
   * Note une recette essayée. `rating: null` retire la note et remet la
   * recette dans les « à tester ».
   */
  rateRecipe: (id: string, rating: number | null, note: string | null = null) =>
    request<Recipe>(`/recipes/${id}/rating`, {
      method: 'POST',
      body: JSON.stringify({ rating, note }),
    }),

  /**
   * Dépose la photo du plat.
   *
   * Le fichier part tel quel, avec son propre type MIME en en-tête — pas de
   * FormData. `request()` ne pose `Content-Type: application/json` que
   * lorsqu'aucun n'est fourni, et celui donné ici a la priorité.
   */
  uploadRecipePhoto: (id: string, file: File) =>
    request<Recipe>(`/recipes/${id}/photo`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    }),

  removeRecipePhoto: (id: string) =>
    request<Recipe>(`/recipes/${id}/photo`, { method: 'DELETE' }),

  /**
   * Publie une recette, ou la repasse en privé.
   *
   * `displayName` n'est envoyé qu'à la première publication, quand
   * l'utilisateur choisit sous quel nom il partage.
   */
  setRecipeVisibility: (id: string, isPublic: boolean, displayName?: string | null) =>
    request<Recipe>(`/recipes/${id}/visibility`, {
      method: 'POST',
      body: JSON.stringify(
        displayName === undefined ? { isPublic } : { isPublic, displayName },
      ),
    }),

  /** Enregistre une copie d'une recette partagée dans son propre fichier. */
  copyRecipe: (id: string) => request<Recipe>(`/recipes/${id}/copy`, { method: 'POST' }),

  // --- Liste de courses ---

  getShoppingList: () => request<ShoppingList>('/shopping-list'),

  addRecipesToList: (recipeIds: string[], servings?: Record<string, number>) =>
    request<ShoppingList>('/shopping-list/recipes', {
      method: 'POST',
      body: JSON.stringify({ recipeIds, servings }),
    }),

  addShoppingItem: (label: string, quantity: number | null, unit: string | null) =>
    request<ShoppingList>('/shopping-list/items', {
      method: 'POST',
      body: JSON.stringify({ label, quantity, unit }),
    }),

  toggleShoppingItem: (itemId: string) =>
    request<ShoppingList>(`/shopping-list/items/${itemId}/toggle`, { method: 'POST' }),

  removeShoppingItem: (itemId: string) =>
    request<ShoppingList>(`/shopping-list/items/${itemId}`, { method: 'DELETE' }),

  removeRecipeFromList: (recipeId: string) =>
    request<ShoppingList>(`/shopping-list/recipes/${recipeId}`, { method: 'DELETE' }),

  clearShoppingList: (onlyChecked = false) =>
    request<ShoppingList>(`/shopping-list${onlyChecked ? '?checked=1' : ''}`, {
      method: 'DELETE',
    }),
};
