import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconClose, IconFilter, IconGlobe, IconSearch } from '../components/Icons';
import { RecipeCard } from '../components/RecipeCard';
import { Button, EmptyState, ErrorPanel, Label, Pill, Select, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DIFFICULTIES,
  type Category,
  type Difficulty,
  type DiscoverFilters,
  type Facets,
  type Recipe,
} from '../lib/types';

/**
 * Page Découvrir : les recettes que les autres ont choisi de partager.
 *
 * Ouverte aux visiteurs sans compte — c'est la vitrine du produit, et exiger
 * une inscription pour simplement regarder une recette serait un mur inutile.
 * Les gestes qui demandent un compte (enregistrer une fiche) mènent à la page
 * de connexion avec la page de retour en mémoire, plutôt que d'être grisés
 * sans explication.
 *
 * Mêmes filtres et même grille que la bibliothèque, moins ce qui n'a de sens
 * que sur son propre fichier : favoris, notes, « déjà essayée ». On ne juge
 * pas la recette d'un autre depuis sa vitrine.
 */

const SORTS = [
  { value: 'recent', label: 'Derniers partages' },
  { value: 'popular', label: 'Les plus reprises' },
  { value: 'title', label: 'Ordre alphabétique' },
  { value: 'time', label: 'Plus rapides' },
] as const;

const TIME_FILTERS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
] as const;

export function DiscoverPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  /** Recette en cours d'enregistrement, pour n'animer que sa carte. */
  const [copying, setCopying] = useState<string | null>(null);
  /** Titre de la dernière recette reprise, confirmé à l'écran. */
  const [copied, setCopied] = useState<{ id: string; title: string } | null>(null);

  const [searchDraft, setSearchDraft] = useState(params.get('q') ?? '');

  const filters = useMemo<DiscoverFilters>(
    () => ({
      q: params.get('q') ?? undefined,
      category: (params.get('category') as Category) ?? undefined,
      difficulty: (params.get('difficulty') as Difficulty) ?? undefined,
      cuisine: params.get('cuisine') ?? undefined,
      tag: params.get('tag') ?? undefined,
      maxTime: params.get('maxTime') ? Number(params.get('maxTime')) : undefined,
      sort: (params.get('sort') as DiscoverFilters['sort']) ?? 'recent',
    }),
    [params],
  );

  const activeFilterCount = [
    filters.category,
    filters.difficulty,
    filters.cuisine,
    filters.tag,
    filters.maxTime,
  ].filter((value) => value !== undefined && value !== null).length;

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

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchDraft !== (params.get('q') ?? '')) setFilter('q', searchDraft || null);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params, setFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .discover(filters)
      .then((result) => {
        if (cancelled) return;
        setRecipes(result.recipes);
        setTotal(result.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : 'Impossible de charger les recettes partagées.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters]);

  useEffect(() => {
    api
      .discoverFacets()
      .then(setFacets)
      // Les facettes sont un confort de filtrage : leur absence ne doit pas
      // masquer la grille, qui est le contenu réel de la page.
      .catch(() => undefined);
  }, []);

  /**
   * Enregistre une copie de la fiche dans son propre fichier.
   *
   * Sans compte, on part sur /login en gardant la page de retour : la
   * recette convoitée est toujours là au retour, filtres compris.
   */
  async function copyRecipe(recipe: Recipe) {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return;
    }

    setCopying(recipe.id);
    setError(null);

    try {
      const copy = await api.copyRecipe(recipe.id);
      setCopied({ id: copy.id, title: copy.title });
      // Le compteur de reprises monte : la carte doit le refléter sans
      // recharger toute la grille.
      setRecipes((previous) =>
        previous.map((item) =>
          item.id === recipe.id ? { ...item, copyCount: item.copyCount + 1 } : item,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "L'enregistrement a échoué.");
    } finally {
      setCopying(null);
    }
  }

  function clearFilters() {
    setSearchDraft('');
    setParams(new URLSearchParams(), { replace: true });
  }

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-11 sm:px-6">
      <header className="animate-er-in flex flex-wrap items-end justify-between gap-5 border-b-[1.5px] border-rule-strong pb-4.5">
        <div>
          <Label>
            {loading
              ? 'Partagées · chargement…'
              : total === 0
                ? 'Partagées · aucune pour l’instant'
                : `Partagées · ${total} fiche${total > 1 ? 's' : ''}`}
          </Label>
          <h1 className="mt-2.5 text-title">Découvrir</h1>
        </div>

        {!user && (
          <Button variant="lime" onClick={() => navigate('/login')}>
            Créer mon fichier
          </Button>
        )}
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
            aria-label="Rechercher dans les recettes partagées"
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
          aria-label="Trier les recettes partagées"
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
              </FilterRow>

              {facets && facets.cuisines.length > 0 && (
                <FilterRow label="Cuisine">
                  {facets.cuisines.slice(0, 14).map((cuisine) => (
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
                      {cuisine.value} · {cuisine.count}
                    </Pill>
                  ))}
                </FilterRow>
              )}

              {facets && facets.tags.length > 0 && (
                <FilterRow label="Étiquettes">
                  {facets.tags.slice(0, 18).map((tag) => (
                    <Pill
                      key={tag.slug}
                      active={filters.tag === tag.value}
                      onClick={() => setFilter('tag', filters.tag === tag.value ? null : tag.value)}
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
          icon={<IconGlobe />}
          title={
            activeFilterCount > 0 || filters.q
              ? 'Aucune fiche partagée ne correspond'
              : 'Rien de partagé pour le moment'
          }
          description={
            activeFilterCount > 0 || filters.q
              ? 'Essaie avec moins de filtres, ou un autre mot-clé.'
              : "Personne n'a encore rendu de recette publique. Sois le premier : ouvre une de tes fiches et partage-la."
          }
          action={
            activeFilterCount > 0 || filters.q ? (
              <Button variant="secondary" onClick={clearFilters}>
                Effacer les filtres
              </Button>
            ) : user ? (
              <Button variant="primary" onClick={() => navigate('/recipes')}>
                Voir mes recettes →
              </Button>
            ) : (
              <Button variant="primary" onClick={() => navigate('/login')}>
                Créer mon fichier →
              </Button>
            )
          }
        />
      ) : (
        <div className="mt-9 grid grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))] gap-6.5">
          {recipes.map((recipe, index) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              index={index}
              showAuthor
              onCopy={copyRecipe}
              copying={copying === recipe.id}
            />
          ))}
        </div>
      )}

      {/* ---------------- Confirmation de reprise ---------------- */}
      <AnimatePresence>
        {copied && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="safe-bottom fixed inset-x-0 bottom-16 z-40 px-4 sm:bottom-6"
          >
            <div className="mx-auto flex max-w-lg flex-wrap items-center gap-3 rounded-card border-[1.5px] border-rule-strong bg-paper-raised p-3 shadow-hero">
              <Label className="min-w-0 flex-1 text-ink">
                « {copied.title} » est dans ton fichier
              </Label>

              <Button size="sm" variant="ghost" onClick={() => setCopied(null)}>
                Fermer
              </Button>

              {/* Lien vers la copie, pas vers l'originale : c'est la fiche
                  que l'utilisateur peut désormais modifier et noter. */}
              <Link
                to={`/recipe/${copied.id}`}
                className="press inline-flex min-h-9 items-center rounded-control border-[1.5px] border-rule-strong bg-lime px-[15px] font-mono text-[10px] font-medium tracking-[0.16em] text-ink uppercase"
              >
                Ouvrir ma copie
              </Link>
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
