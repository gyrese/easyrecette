import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { groupBySection } from '../components/RecipePreview';
import { ServingsStepper } from '../components/RecipeEditor';
import { RecipeVideo } from '../components/RecipeVideo';
import { RecipePhoto } from '../components/RecipePhoto';
import { RatingPanel, Stars } from '../components/RecipeRating';
import { PublicRecipeBanner, RecipeSharePanel } from '../components/RecipeSharePanel';
import {
  IconArrowLeft,
  IconCart,
  IconEdit,
  IconExternal,
  IconHeart,
  IconTrash,
} from '../components/Icons';
import {
  AiDeducedBadge,
  AiDeducedNotice,
  Badge,
  Button,
  ErrorPanel,
  FormattedInstruction,
  Label,
  RecipeImage,
  SideNote,
  Spinner,
  WarningPanel,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import {
  attributionLine,
  categoryLabel,
  difficultyLabel,
  displayImage,
  formatDate,
  formatDuration,
  formatDurationShort,
  formatTriedAt,
} from '../lib/format';
import { formatQuantity, scaleQuantity } from '../lib/units';
import { PLATFORM_LABELS, RATING_LABELS, type Recipe } from '../lib/types';

/**
 * Fiche recette — le « studio ».
 *
 * La page s'ouvre sur un bandeau cinématique : la photo pleine largeur, le
 * titre composé très grand en bas à gauche, et un tampon rond en haut à
 * droite qui porte la durée. Vient ensuite une barre collante (portions +
 * mode cuisine), puis deux colonnes : les ingrédients à gauche, la méthode
 * à droite. C'est la mise en page d'une double page de revue.
 *
 * Deux mécaniques notables :
 *
 *  - Portions dynamiques (§11) : changer le nombre de convives recalcule les
 *    quantités à la volée, côté client, sans toucher à la base. La recette
 *    enregistrée garde ses portions d'origine ; l'ajustement est une vue.
 *    Une quantité inconnue reste inconnue quel que soit le multiplicateur.
 *
 *  - Cases à cocher sur les ingrédients : état purement local, remis à zéro
 *    au rechargement. C'est un aide-mémoire pendant qu'on rassemble les
 *    ingrédients, pas une donnée à conserver.
 *
 * La page a deux lectures, décidées par `recipe.isOwner` :
 *
 *  - sa propre fiche : tous les gestes d'entretien (modifier, noter, prendre
 *    une photo, supprimer, partager) ;
 *  - la fiche publique d'un autre : la recette et rien d'autre, plus un
 *    bandeau d'attribution et le bouton qui l'enregistre chez soi. Les gestes
 *    du propriétaire sont absents, pas désactivés — un bouton grisé sans
 *    explication est une énigme, une absence est une réponse.
 *
 * Le serveur applique la même règle de son côté (voir getVisibleRecipe) : ce
 * qui suit est du confort d'affichage, pas la barrière.
 */
export function RecipePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [servings, setServings] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [addingToList, setAddingToList] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    setLoading(true);
    api
      .getRecipe(id)
      .then((result) => {
        if (cancelled) return;
        setRecipe(result);
        setServings(result.servings);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Recette introuvable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  /** Ingrédients recalculés pour le nombre de portions affiché. */
  const scaledSections = useMemo(() => {
    if (!recipe) return [];

    const scaled = recipe.ingredients.map((item) => {
      const result = scaleQuantity(item.quantity, item.unit, recipe.servings, servings);
      return { ...item, quantity: result.quantity, unit: result.unit };
    });

    return groupBySection({ ingredients: scaled });
  }, [recipe, servings]);

  const isScaled = Boolean(recipe?.servings && servings && servings !== recipe.servings);
  const ingredientCount = recipe?.ingredients.length ?? 0;

  async function toggleFavorite() {
    if (!recipe) return;
    setRecipe({ ...recipe, isFavorite: !recipe.isFavorite });
    try {
      await api.toggleFavorite(recipe.id);
    } catch {
      setRecipe({ ...recipe, isFavorite: recipe.isFavorite });
    }
  }

  async function addToList() {
    if (!recipe) return;
    setAddingToList(true);
    try {
      await api.addRecipesToList([recipe.id], servings ? { [recipe.id]: servings } : undefined);
      navigate('/shopping-list');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "L'ajout à la liste a échoué.");
      setAddingToList(false);
    }
  }

  /**
   * Notation. La réponse du serveur remplace la recette entière plutôt que de
   * patcher `rating` localement : c'est lui qui décide de `triedAt`, et une
   * note posée puis retirée doit rendre exactement l'état qu'il a en base.
   */
  async function rate(rating: number | null, note: string | null) {
    if (!recipe) return;
    setRecipe(await api.rateRecipe(recipe.id, rating, note));
  }

  async function uploadPhoto(file: File) {
    if (!recipe) return;
    setRecipe(await api.uploadRecipePhoto(recipe.id, file));
  }

  async function removePhoto() {
    if (!recipe) return;
    setRecipe(await api.removeRecipePhoto(recipe.id));
  }

  async function remove() {
    if (!recipe) return;
    try {
      await api.deleteRecipe(recipe.id);
      navigate('/recipes');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La suppression a échoué.');
    }
  }

  function toggleCheck(index: number) {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-8 text-ember" />
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorPanel
          title="Recette introuvable"
          message={error ?? "Cette recette n'existe pas ou a été supprimée."}
          action={
            <Button onClick={() => navigate('/recipes')} icon={<IconArrowLeft />}>
              Retour au fichier
            </Button>
          }
        />
      </div>
    );
  }

  const attribution = attributionLine(recipe.source);
  const checkedCount = checked.size;

  /* La ligne de chapeau du bandeau : provenance et classement, en étiquette. */
  const kicker = [
    PLATFORM_LABELS[recipe.source.platform],
    recipe.source.author &&
      (recipe.source.author.startsWith('@') ? recipe.source.author : `@${recipe.source.author}`),
    recipe.category && categoryLabel(recipe.category),
  ]
    .filter(Boolean)
    .join(' · ');

  let ingredientIndex = 0;

  /* La photo du plat passe devant celle de la source, ici comme partout. */
  const heroImage = displayImage(recipe);
  const triedLabel = formatTriedAt(recipe.triedAt);

  return (
    <article className="mx-auto max-w-[1320px] px-4 pt-7 sm:px-6">
      {/* ================= Bandeau cinématique ================= */}
      <header className="animate-er-in relative min-h-[420px] overflow-hidden rounded-card border-[1.5px] border-rule-strong bg-ink shadow-hero">
        {heroImage && (
          <RecipeImage
            src={heroImage}
            alt={recipe.title}
            priority
            className="absolute inset-0 size-full object-cover"
          />
        )}

        {/* Voile du bas : garantit la lisibilité du titre sur toute photo. */}
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(23_20_15/0.95)_4%,rgb(23_20_15/0.4)_52%,rgb(23_20_15/0.05))]"
          aria-hidden="true"
        />

        {/* Le tampon : durée et difficulté, cerclées de vert acide. */}
        {(recipe.totalTime !== null || recipe.difficulty) && (
          <div className="animate-er-stamp pointer-events-none absolute top-5 right-5 z-3 flex size-27 flex-col items-center justify-center gap-0.5 rounded-full border-[1.5px] border-lime text-center text-lime sm:top-8 sm:right-8">
            {recipe.totalTime !== null && (
              <>
                {/* Sous l'heure, le chiffre seul et l'unité en légende ; au
                    delà, la durée composée tient sur une ligne. */}
                <span className="font-display text-[30px] leading-none">
                  {recipe.totalTime < 60
                    ? recipe.totalTime
                    : formatDurationShort(recipe.totalTime)}
                </span>
                {recipe.totalTime < 60 && (
                  <span className="label-mono-sm text-[8.5px]">minutes</span>
                )}
              </>
            )}
            {recipe.difficulty && (
              <>
                <span className="my-0.5 h-px w-6.5 bg-lime" />
                <span className="label-mono-sm text-[8.5px]">
                  {difficultyLabel(recipe.difficulty)}
                </span>
              </>
            )}
          </div>
        )}

        {/* Retour et favori : les deux seuls contrôles posés sur la photo. */}
        {/* Le retour ramène d'où l'on vient vraiment : son fichier pour sa
            propre fiche, la page Découvrir pour celle d'un autre. */}
        <Link
          to={recipe.isOwner ? '/recipes' : '/discover'}
          aria-label={recipe.isOwner ? 'Retour au fichier' : 'Retour à la découverte'}
          className="absolute top-5 left-5 z-3 grid size-10 place-items-center rounded-control border-[1.5px] border-paper/40 bg-ink/40 text-paper backdrop-blur-sm transition-colors hover:border-lime hover:bg-lime hover:text-ink"
        >
          <IconArrowLeft />
        </Link>

        {/* Le favori n'a de sens que sur sa propre fiche : marquer celle d'un
            autre ne mènerait nulle part, le drapeau vit sur la recette. */}
        {recipe.isOwner && (
          <button
            type="button"
            onClick={toggleFavorite}
            aria-label={recipe.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            aria-pressed={recipe.isFavorite}
            className={`absolute top-17 left-5 z-3 grid size-10 place-items-center rounded-control border-[1.5px] transition-colors ${
              recipe.isFavorite
                ? 'border-ember bg-ember text-ember-ink'
                : 'border-paper/40 bg-ink/40 text-paper backdrop-blur-sm hover:border-ember hover:bg-ember hover:text-ember-ink'
            }`}
          >
            <IconHeart filled={recipe.isFavorite} />
          </button>
        )}

        <div className="relative flex min-h-[420px] flex-col justify-end p-6.5 text-paper sm:p-12">
          {kicker && <Label className="text-paper/55">{kicker}</Label>}

          <h1 className="mt-4 max-w-[760px] text-title text-paper">{recipe.title}</h1>

          {/* Le verdict, juste sous le titre : une recette déjà essayée
              l'annonce avant même qu'on lise ses ingrédients. */}
          {recipe.rating !== null && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Stars value={recipe.rating} />
              <span className="label-mono-sm text-paper/70">
                {RATING_LABELS[recipe.rating]}
                {triedLabel && ` · essayée ${triedLabel}`}
              </span>
            </div>
          )}

          {recipe.description && (
            <p className="mt-4 max-w-[560px] text-[15px] leading-[1.6] text-paper/70">
              {recipe.description}
            </p>
          )}

          <div className="label-mono mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[10.5px] tracking-[0.14em] text-paper/70">
            {recipe.servings !== null && (
              <span className={recipe.servingsDeduced ? 'text-[#c4b5fd] font-medium' : ''}>
                {recipe.servingsDeduced && '✨ '}
                {recipe.servings} {recipe.servings === 1 ? 'personne' : 'personnes'}
                {recipe.servingsDeduced && ' (estimé)'}
              </span>
            )}
            {ingredientCount > 0 && (
              <>
                <span className="text-lime" aria-hidden="true">
                  /
                </span>
                <span>{ingredientCount} ingrédients</span>
              </>
            )}
            {recipe.steps.length > 0 && (
              <>
                <span className="text-lime" aria-hidden="true">
                  /
                </span>
                <span>{recipe.steps.length} étapes</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ================= Barre d'outils collante ================= */}
      <div className="sticky top-[62px] z-20 mt-5.5 flex flex-wrap items-center justify-between gap-4 rounded-card border-[1.5px] border-rule-strong bg-paper-raised/92 px-3.5 py-3 shadow-sticky backdrop-blur-[16px]">
        <div className="flex flex-wrap items-center gap-3.5">
          {recipe.servings !== null && servings !== null && (
            <ServingsStepper value={servings} onChange={setServings} />
          )}
          {isScaled ? (
            <button
              type="button"
              onClick={() => setServings(recipe.servings)}
              className="label-mono text-ember transition-colors hover:text-ink"
            >
              revenir à {recipe.servings}
            </button>
          ) : (
            <Label className="hidden sm:inline">recalcul en direct</Label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Modifier, supprimer, envoyer aux courses : des gestes sur SON
              fichier. Sur la fiche d'un autre, il faut d'abord l'enregistrer
              — c'est ce que propose le bandeau d'attribution. */}
          {recipe.isOwner && (
            <>
              <Button
                variant="ghost"
                icon={<IconEdit />}
                onClick={() => navigate(`/recipe/${recipe.id}/edit`)}
                aria-label="Modifier la fiche"
              />
              <Button
                variant="ghost"
                icon={<IconTrash />}
                onClick={() => setConfirmDelete(true)}
                aria-label="Supprimer la fiche"
              />
              <Button
                variant="primary"
                icon={<IconCart />}
                loading={addingToList}
                onClick={addToList}
                className="max-sm:hidden"
              >
                Aux courses
              </Button>
            </>
          )}
          {/* Le mode cuisine reste ouvert à tous : lire une recette en
              cuisinant ne modifie rien, et c'est précisément l'intérêt de la
              consulter. */}
          <Button variant="lime" onClick={() => navigate(`/recipe/${recipe.id}/cook`)}>
            Mode cuisine ▶
          </Button>
        </div>
      </div>

      {confirmDelete && (
        <ErrorPanel
          className="mt-5"
          title="Supprimer cette fiche ?"
          message="Cette action est définitive."
          action={
            <div className="flex gap-2">
              <Button variant="danger" size="sm" onClick={remove}>
                Supprimer
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Annuler
              </Button>
            </div>
          }
        />
      )}

      {/* ================= Partage ================= */}
      {recipe.isOwner ? (
        <div className="mt-5.5">
          <RecipeSharePanel recipe={recipe} onChange={setRecipe} />
        </div>
      ) : (
        <div className="mt-5.5">
          <PublicRecipeBanner
            recipe={recipe}
            /* La copie remplace la page : l'utilisateur atterrit sur SA
               fiche, celle qu'il peut modifier, et non sur l'originale qu'il
               vient de quitter. */
            onCopied={(copyId) => navigate(`/recipe/${copyId}`, { replace: true })}
          />
        </div>
      )}

      {(recipe.servingsDeduced ||
        recipe.ingredients.some((i) => i.isDeduced) ||
        recipe.steps.some((s) => s.isDeduced)) && (
        <AiDeducedNotice className="mt-5" />
      )}

      <WarningPanel className="mt-5" warnings={recipe.warnings} />

      {/* ================= Deux colonnes : ingrédients / méthode ============ */}
      <div className="mt-6.5 grid items-start gap-6.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr))]">
        {/* ---------------- Ingrédients ---------------- */}
        <section className="surface p-6">
          <div className="flex items-baseline justify-between gap-3 border-b-[1.5px] border-rule-strong pb-3.5">
            <h2 className="text-[34px]">Ingrédients</h2>
            <span className="font-mono text-[10px] font-medium tracking-[0.14em] text-ink/50 tabular-nums">
              {checkedCount}/{ingredientCount}
            </span>
          </div>

          {/* Jauge de préparation : combien d'ingrédients sont rassemblés.
              Terre cuite et non vert acide — c'est la même couleur que les
              croix qui viennent de la remplir. */}
          <div className="mt-3 h-[3px] overflow-hidden bg-ink/10">
            <div
              className="h-full bg-ember transition-[width] duration-[450ms] ease-out-expo"
              style={{
                width: ingredientCount > 0 ? `${(checkedCount / ingredientCount) * 100}%` : '0%',
              }}
            />
          </div>

          {isScaled && (
            <p className="label-mono-sm mt-4 text-ember">
              Quantités ajustées pour {servings} personnes
            </p>
          )}

          {scaledSections.map(({ section, items }) => (
            <div key={section ?? '__default'} className="mt-6">
              {section && (
                <Label as="div" className="mb-1.5 block text-ember">
                  {section}
                </Label>
              )}

              <ul>
                {items.map((item) => {
                  const index = ingredientIndex++;
                  const isChecked = checked.has(index);

                  return (
                    <li key={index}>
                      {/* Toute la ligne est cliquable et se décale de 4 à 9px
                          au survol : la ligne « avance » sous la main, comme
                          si on la sortait du bloc pour la pointer du doigt.
                          `peer` porte la case native, masquée mais bien
                          présente — c'est elle qui tient le clavier, le focus
                          et le lecteur d'écran ; le carré visible n'est qu'un
                          décor piloté par son état. */}
                      <label className={`flex cursor-pointer items-baseline gap-2.5 border-b border-dotted border-ink/28 py-[9px] pl-1 transition-[background-color,padding-left] duration-200 hover:bg-[rgb(216_242_80/0.24)] hover:pl-[9px] ${
                        item.isDeduced ? 'bg-[rgb(109_40_217/0.04)]' : ''
                      }`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCheck(index)}
                          className="peer sr-only"
                        />

                        {/* Le carré et sa croix : le geste du crayon sur une
                            liste de courses, pas la coche d'un formulaire.
                            `er-pop` n'est monté qu'à l'état coché, donc il ne
                            se rejoue qu'au cochage, jamais au décochage. */}
                        <span
                          aria-hidden="true"
                          className={`grid size-[17px] shrink-0 translate-y-px place-items-center border-[1.5px] font-mono text-[10px] font-medium transition-all duration-200 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ember ${
                            isChecked
                              ? 'animate-er-pop border-ember bg-[rgb(214_70_31/0.12)] text-ember'
                              : item.isDeduced
                                ? 'border-[#6d28d9]/50 bg-transparent text-[#5b21b6]'
                                : 'border-ink/32 bg-transparent text-ember'
                          }`}
                        >
                          {isChecked ? '✕' : ''}
                        </span>

                        <span
                          className={`flex-1 text-[14.5px] leading-snug transition-colors duration-200 ${
                            isChecked
                              ? 'text-ink/36 line-through'
                              : item.isDeduced
                                ? 'text-[#5b21b6] font-medium'
                                : 'text-ink/90'
                          }`}
                        >
                          {item.ingredient}
                          {item.preparation && (
                            <span className="text-ink-soft">, {item.preparation}</span>
                          )}
                          {item.isDeduced && <AiDeducedBadge className="ml-2" />}
                          {item.quantity === null && item.note && (
                            <span className={`ml-1.5 text-xs ${item.isDeduced ? 'text-[#6d28d9]' : 'text-amber-warn'}`}>
                              ({item.note})
                            </span>
                          )}
                        </span>

                        {item.quantity !== null && (
                          <span
                            className={`shrink-0 font-mono text-[12px] font-medium tracking-[0.04em] tabular-nums transition-colors duration-200 ${
                              isChecked
                                ? 'text-ink/30'
                                : item.isDeduced
                                  ? 'text-[#5b21b6] font-semibold'
                                  : 'text-ink'
                            }`}
                          >
                            {formatQuantity(item.quantity)}
                            {item.unit ? ` ${item.unit}` : ''}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {recipe.isOwner && (
            <Button
              variant="lime"
              size="lg"
              loading={addingToList}
              onClick={addToList}
              className="mt-6.5 w-full"
            >
              Envoyer aux courses →
            </Button>
          )}

          {recipe.equipment.length > 0 && (
            <div className="mt-6.5 border-t-[1.5px] border-rule-strong pt-4">
              <Label as="div" className="mb-2.5 block text-ember">
                Ustensiles
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {recipe.equipment.map((item) => (
                  <Badge key={item}>{item}</Badge>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ---------------- Méthode ---------------- */}
        <section className="surface overflow-hidden p-0">
          <div className="border-b-[1.5px] border-rule-strong px-6 pt-6 pb-3.5">
            <h2 className="text-[34px]">Méthode</h2>
          </div>

          <ol>
            {recipe.steps.map((step) => (
              <li
                key={step.order}
                className={`flex gap-4.5 border-b border-ink/14 px-6 py-5.5 transition-colors duration-[250ms] last:border-b-0 hover:bg-[rgb(216_242_80/0.16)] ${
                  step.isDeduced ? 'bg-[rgb(109_40_217/0.04)] border-l-2 border-[#6d28d9]' : ''
                }`}
              >
                {/* Le chiffre d'étape, composé très grand et très pâle : il
                    donne le rythme sans concurrencer le texte. Sur deux
                    chiffres toujours, pour que la colonne reste d'aplomb
                    entre l'étape 9 et l'étape 10. */}
                <span className={`w-11 shrink-0 font-display text-[42px] leading-[0.8] tracking-[-0.04em] tabular-nums ${
                  step.isDeduced ? 'text-[#6d28d9]/40' : 'text-ink/26'
                }`}>
                  {String(step.order).padStart(2, '0')}
                </span>

                <div className="min-w-0 flex-1">
                  {step.title && <h3 className="mb-1.5 font-display text-xl">{step.title}</h3>}

                  {/* .86 et non .62 : c'est le seul texte long de la page
                      qu'on lit debout, les mains occupées. */}
                  <p className={`text-[15px] leading-[1.62] ${step.isDeduced ? 'text-ink' : 'text-ink/86'}`}>
                    <FormattedInstruction text={step.instruction} isDeduced={step.isDeduced} />
                  </p>

                  <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                    {step.isDeduced && <AiDeducedBadge>Étape déduite</AiDeducedBadge>}
                    {step.duration !== null && (
                      <Badge tone={step.isDeduced ? 'ai' : 'ember'}>
                        {step.isDeduced && <span className="mr-0.5">✨</span>}
                        {formatDuration(step.duration)}
                      </Badge>
                    )}
                    {step.temperature !== null && (
                      <Badge tone={step.isDeduced ? 'ai' : 'neutral'}>
                        {step.isDeduced && <span className="mr-0.5">✨</span>}
                        {step.temperature} °C
                      </Badge>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* ================= Le carnet d'essai ================= */}
      {/* Placé après la méthode et avant les conseils : on note et on
          photographie une fois la recette faite, pas avant de la lire.

          Réservé au propriétaire, et sur les deux plans : le serveur ne
          transmet pas les annotations d'autrui (voir toDto), donc même
          affiché ici le panneau serait vide — et noter la recette d'un autre
          reviendrait à écrire dans son carnet. Pour tenir son propre journal
          d'essai, il faut d'abord enregistrer la fiche chez soi. */}
      {recipe.isOwner && (
        <>
          <RatingPanel
            rating={recipe.rating}
            ratingNote={recipe.ratingNote}
            triedAt={recipe.triedAt}
            onSubmit={rate}
          />

          <RecipePhoto
            photoUrl={recipe.userPhotoUrl}
            title={recipe.title}
            onUpload={uploadPhoto}
            onRemove={removePhoto}
          />
        </>
      )}

      {/* ================= Conseils ================= */}
      {recipe.tips.length > 0 && (
        <section className="surface mt-6.5 p-6">
          <h2 className="border-b-[1.5px] border-rule-strong pb-3.5 text-[34px]">Conseils</h2>
          <div className="mt-4 flex flex-col gap-3">
            {recipe.tips.map((tip, index) => (
              <SideNote key={index}>{tip}</SideNote>
            ))}
          </div>
        </section>
      )}

      {recipe.videoUrl && (
        <RecipeVideo src={recipe.videoUrl} poster={recipe.posterUrl} title={recipe.title} />
      )}

      {recipe.tags.length > 0 && (
        <div className="mt-6.5 flex flex-wrap gap-1.5">
          {recipe.tags.map((tag) => (
            <Link key={tag} to={`/recipes?tag=${encodeURIComponent(tag)}`}>
              <Badge className="transition-colors hover:bg-lime">{tag}</Badge>
            </Link>
          ))}
        </div>
      )}

      {/* ================= Provenance (§13) ================= */}
      {attribution && (
        <footer className="surface mt-6.5 p-6">
          <Label as="div" className="mb-2.5 block text-ember">
            Provenance
          </Label>

          <p className="text-[15px] leading-[1.6] text-ink-soft">{attribution}</p>

          {recipe.importedAt && (
            <p className="mt-1.5 text-xs text-ink-faint">
              Importée le {formatDate(recipe.importedAt)}
              {recipe.source.originalTitle && ` · « ${recipe.source.originalTitle} »`}
            </p>
          )}

          {recipe.source.url && (
            <a
              href={recipe.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="label-mono-sm mt-4 inline-flex min-h-10 items-center gap-2 rounded-control border-[1.5px] border-rule-strong px-4 text-ink transition-colors hover:bg-ink hover:text-paper"
            >
              Voir la source originale
              <IconExternal className="text-sm" />
            </a>
          )}
        </footer>
      )}
    </article>
  );
}
