import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IconBook, IconCart, IconClose, IconFilter, IconSearch } from '../components/Icons';
import { RecipeCard } from '../components/RecipeCard';
import { Button, EmptyState, ErrorPanel, Label, Pill, Select, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DIFFICULTIES,
  type Category,
  type Difficulty,
  type Facets,
  type Recipe,
  type RecipeFilters,
} from '../lib/types';

/**
 * Bibliothèque de recettes (§8).
 *
 * Les filtres vivent dans l'URL (useSearchParams) plutôt que dans un état
 * local : une recherche filtrée reste partageable, et le retour arrière du
 * navigateur fait ce qu'on attend.
 *
 * Le mode sélection sert à envoyer plusieurs recettes vers la liste de
 * courses en une fois (§12).
 */

const SORTS = [
  { value: 'recent', label: 'Plus récentes' },
  { value: 'title', label: 'Ordre alphabétique' },
  { value: 'time', label: 'Plus rapides' },
  { value: 'favorite', label: 'Favoris d\'abord' },
] as const;

const TIME_FILTERS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
] as const;

export function LibraryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [addingToList, setAddingToList] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Champ de recherche : état local pour rester réactif, synchronisé vers
  // l'URL après un délai (sinon chaque frappe crée une entrée d'historique).
  const [searchDraft, setSearchDraft] = useState(params.get('q') ?? '');

  const filters = useMemo<RecipeFilters>(
    () => ({
      q: params.get('q') ?? undefined,
      category: (params.get('category') as Category) ?? undefined,
      difficulty: (params.get('difficulty') as Difficulty) ?? undefined,
      cuisine: params.get('cuisine') ?? undefined,
      tag: params.get('tag') ?? undefined,
      favorite: params.get('favorite') === '1',
      /* Trois états et non deux : absent = tout le fichier, '1' = déjà
         essayées, '0' = encore à tester. D'où le undefined explicite, qu'un
         simple `=== '1'` écraserait en « non essayées ». */
      tried: params.has('tried') ? params.get('tried') === '1' : undefined,
      maxTime: params.get('maxTime') ? Number(params.get('maxTime')) : undefined,
      sort: (params.get('sort') as RecipeFilters['sort']) ?? 'recent',
    }),
    [params],
  );

  const activeFilterCount = [
    filters.category,
    filters.difficulty,
    filters.cuisine,
    filters.tag,
    filters.favorite || undefined,
    filters.tried,
    filters.maxTime,
  ].filter((value) => value !== undefined && value !== null && value !== false).length;

  /** Écrit un filtre dans l'URL ; `null` le retire. */
  const setFilter = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // --- Synchronisation du champ de recherche vers l'URL ---
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchDraft !== (params.get('q') ?? '')) {
        setFilter('q', searchDraft || null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params, setFilter]);

  // --- Chargement ---
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .listRecipes(filters)
      .then((result) => {
        if (cancelled) return;
        setRecipes(result.recipes);
        setTotal(result.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Impossible de charger les recettes.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters]);

  useEffect(() => {
    api.facets().then(setFacets).catch(() => undefined);
  }, [recipes.length]);

  // --- Actions ---

  async function toggleFavorite(id: string) {
    // Mise à jour optimiste : le cœur réagit immédiatement.
    setRecipes((previous) =>
      previous.map((recipe) =>
        recipe.id === id ? { ...recipe, isFavorite: !recipe.isFavorite } : recipe,
      ),
    );

    try {
      await api.toggleFavorite(id);
    } catch {
      // Échec : on remet l'état d'avant.
      setRecipes((previous) =>
        previous.map((recipe) =>
          recipe.id === id ? { ...recipe, isFavorite: !recipe.isFavorite } : recipe,
        ),
      );
    }
  }

  function toggleSelect(id: string) {
    setSelection((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addSelectionToList() {
    if (selection.size === 0) return;
    setAddingToList(true);
    try {
      await api.addRecipesToList([...selection]);
      setSelection(new Set());
      navigate('/shopping-list');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "L'ajout à la liste a échoué.");
      setAddingToList(false);
    }
  }

  function clearFilters() {
    setSearchDraft('');
    setParams(new URLSearchParams(), { replace: true });
  }

  const selectionMode = selection.size > 0;

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-11 sm:px-6">
      {/* L'en-tête d'un chemise de classement : le décompte en étiquette,
          le nom de la section en très grand serif. */}
      <header className="animate-er-in flex flex-wrap items-end justify-between gap-5 border-b-[1.5px] border-rule-strong pb-4.5">
        <div>
          <Label>
            {loading
              ? 'Fichier · chargement…'
              : total === 0
                ? 'Fichier · vide'
                : `Fichier · ${total} fiche${total > 1 ? 's' : ''}`}
          </Label>
          <h1 className="mt-2.5 text-title">Bibliothèque</h1>
        </div>
      </header>

      {/* ---------------- Recherche et tri ---------------- */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-0 flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-lg text-ink-faint" />
          <input
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Rechercher un plat, un ingrédient…"
            aria-label="Rechercher dans mes recettes"
            className="min-h-11 w-full rounded-control border-[1.5px] border-rule-strong bg-paper-raised py-2.5 pr-3 pl-11 font-mono text-[13px] text-ink placeholder:text-ink-faint focus:border-ember focus:outline-none"
          />
        </div>

        <Button
          variant={showFilters || activeFilterCount > 0 ? 'lime' : 'secondary'}
          icon={<IconFilter />}
          onClick={() => setShowFilters((value) => !value)}
        >
          Filtres
          {activeFilterCount > 0 && (
            <span className="ml-1 grid size-4.5 place-items-center border-[1.5px] border-current text-[9px]">
              {activeFilterCount}
            </span>
          )}
        </Button>

        <Select
          value={filters.sort ?? 'recent'}
          onChange={(event) => setFilter('sort', event.target.value)}
          aria-label="Trier les recettes"
          className="w-auto"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {/* ---------------- Panneau de filtres ---------------- */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="surface mt-4 space-y-5 p-5">
              <FilterRow label="Catégorie">
                {CATEGORIES.map((category) => (
                  <Pill
                    key={category}
                    active={filters.category === category}
                    onClick={() =>
                      setFilter('category', filters.category === category ? null : category)
                    }
                  >
                    {CATEGORY_LABELS[category]}
                  </Pill>
                ))}
              </FilterRow>

              <FilterRow label="Difficulté">
                {DIFFICULTIES.map((difficulty) => (
                  <Pill
                    key={difficulty}
                    active={filters.difficulty === difficulty}
                    onClick={() =>
                      setFilter('difficulty', filters.difficulty === difficulty ? null : difficulty)
                    }
                  >
                    {difficulty}
                  </Pill>
                ))}
              </FilterRow>

              <FilterRow label="Temps maximum">
                {TIME_FILTERS.map((option) => (
                  <Pill
                    key={option.value}
                    active={filters.maxTime === option.value}
                    onClick={() =>
                      setFilter(
                        'maxTime',
                        filters.maxTime === option.value ? null : String(option.value),
                      )
                    }
                  >
                    {option.label}
                  </Pill>
                ))}
                <Pill
                  active={Boolean(filters.favorite)}
                  onClick={() => setFilter('favorite', filters.favorite ? null : '1')}
                >
                  Favoris
                </Pill>

                {/* Les deux faces du carnet d'essai : ce qui a déjà été
                    cuisiné, et ce qui attend encore son tour. */}
                <Pill
                  active={filters.tried === true}
                  onClick={() => setFilter('tried', filters.tried === true ? null : '1')}
                >
                  Essayées
                </Pill>
                <Pill
                  active={filters.tried === false}
                  onClick={() => setFilter('tried', filters.tried === false ? null : '0')}
                >
                  À tester
                </Pill>
              </FilterRow>

              {facets && facets.cuisines.length > 0 && (
                <FilterRow label="Cuisine">
                  {facets.cuisines.map((cuisine) => (
                    <Pill
                      key={cuisine.value}
                      active={filters.cuisine === cuisine.value}
                      onClick={() =>
                        setFilter(
                          'cuisine',
                          filters.cuisine === cuisine.value ? null : cuisine.value,
                        )
                      }
                    >
                      {cuisine.value}
                      <span className="ml-1 text-xs opacity-60">{cuisine.count}</span>
                    </Pill>
                  ))}
                </FilterRow>
              )}

              {facets && facets.tags.length > 0 && (
                <FilterRow label="Tags">
                  {facets.tags.slice(0, 24).map((tag) => (
                    <Pill
                      key={tag.slug}
                      active={filters.tag === tag.value}
                      onClick={() =>
                        setFilter('tag', filters.tag === tag.value ? null : tag.value)
                      }
                    >
                      {tag.value}
                    </Pill>
                  ))}
                </FilterRow>
              )}

              {activeFilterCount > 0 && (
                <Button size="sm" variant="ghost" icon={<IconClose />} onClick={clearFilters}>
                  Tout effacer
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <ErrorPanel className="mt-6" message={error} />}

      {/* ---------------- Grille ---------------- */}
      {loading && recipes.length === 0 ? (
        <div className="flex justify-center py-24">
          <Spinner className="size-8 text-ember" />
        </div>
      ) : recipes.length === 0 ? (
        <EmptyState
          icon={<IconBook />}
          title={
            activeFilterCount > 0 || filters.q
              ? 'Aucune fiche ne correspond'
              : 'Le fichier est vide'
          }
          description={
            activeFilterCount > 0 || filters.q
              ? 'Essayez avec moins de filtres, ou un autre mot-clé.'
              : 'Collez un lien TikTok, YouTube ou un article de blog pour créer votre première fiche.'
          }
          action={
            activeFilterCount > 0 || filters.q ? (
              <Button variant="secondary" onClick={clearFilters}>Effacer les filtres</Button>
            ) : (
              <Button variant="primary" onClick={() => navigate('/')}>
                Importer une fiche →
              </Button>
            )
          }
        />
      ) : (
        <div className="mt-9 grid gap-6.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr))]">
          {recipes.map((recipe, index) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              index={index}
              selectable
              selected={selection.has(recipe.id)}
              onToggleSelect={toggleSelect}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      )}

      {/* ---------------- Barre de sélection ---------------- */}
      <AnimatePresence>
        {selectionMode && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="safe-bottom fixed inset-x-0 bottom-16 z-40 px-4 sm:bottom-6"
          >
            <div className="mx-auto flex max-w-lg items-center gap-3 rounded-card border-[1.5px] border-rule-strong bg-paper-raised p-3 shadow-hero">
              <Label className="flex-1 text-ink">
                {selection.size} fiche{selection.size > 1 ? 's' : ''} retenue
                {selection.size > 1 ? 's' : ''}
              </Label>

              <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())}>
                Annuler
              </Button>

              <Button
                size="sm"
                variant="lime"
                icon={<IconCart />}
                loading={addingToList}
                onClick={addSelectionToList}
              >
                Ajouter aux courses
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label as="p" className="mb-2.5 block text-ember">
        {label}
      </Label>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

