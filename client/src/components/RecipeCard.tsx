import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  categoryLabel,
  difficultyLabel,
  displayImage,
  formatDurationShort,
  hostOf,
} from '../lib/format';
import type { Recipe } from '../lib/types';
import { PLATFORM_LABELS, RATING_LABELS } from '../lib/types';
import { IconCheck, IconClose, IconCopy, IconEdit, IconGlobe, IconHeart, IconTrash } from './Icons';
import { Stars } from './RecipeRating';
import { RecipeImage, Spinner } from './ui';

/**
 * Carte de recette.
 *
 * Une fiche cartonnée de la maquette : filet noir, coins au massicot, ombre
 * dure décalée. Chaque fiche repose légèrement de travers dans le fichier
 * (`--er-rot`, dérivé de l'identifiant pour rester stable d'un rendu à
 * l'autre) et se redresse au survol en se soulevant — le geste `.fiche` de
 * index.css, qui pilote aussi le zoom lent de la photo (`.er-reveal`).
 * L'image occupe les deux tiers de la carte (§16, « photographies
 * culinaires mises en avant »).
 *
 * L'état de sélection sert à la liste de courses : on peut cocher plusieurs
 * recettes depuis la bibliothèque puis les envoyer d'un coup.
 *
 * La suppression demande une confirmation sur la carte elle-même plutôt que
 * dans une boîte de dialogue : le geste est définitif, et la grille est
 * précisément l'endroit où l'on clique vite. Le voile qui la porte couvre
 * toute la carte, ce qui rend impossible d'effacer une recette en visant mal
 * la vignette voisine.
 */

interface Props {
  recipe: Recipe;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  /** Absent = pas de poubelle : c'est le cas sur l'accueil (§lecture seule). */
  onDelete?: (id: string) => void;
  /**
   * Affiche l'auteur en pied de carte à la place de la provenance.
   * Utilisé par la page Découvrir : devant la fiche d'un inconnu, savoir qui
   * l'a partagée compte davantage que savoir de quel blog elle vient.
   */
  showAuthor?: boolean;
  /**
   * Reprise de la fiche dans son propre fichier. Absent = pas de bouton :
   * c'est le cas partout sauf sur Découvrir.
   */
  onCopy?: (recipe: Recipe) => void;
  copying?: boolean;
  index?: number;
}

/**
 * Angle de repos de la fiche, entre -1.2° et +1.2°. Dérivé de l'identifiant
 * et non du hasard : la grille ne doit pas se réagencer à chaque rendu.
 */
function restingTilt(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `${((Math.abs(hash) % 25) - 12) / 10}deg`;
}

/** Pastille posée sur la photo : une étiquette découpée, pas une gélule. */
const TAG =
  'rounded-control border-[1.5px] border-rule-strong px-2 py-1 font-mono text-[10px] font-medium tracking-[0.12em] uppercase';

/** Bouton carré superposé à la photo, qui s'enfonce sous le doigt. */
const OVERLAY_BUTTON =
  'grid size-9 place-items-center rounded-control border-[1.5px] border-rule-strong shadow-[2px_2px_0_#17140f] transition-[background-color,color,transform,box-shadow] duration-150 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none';

export function RecipeCard({
  recipe,
  selectable = false,
  selected = false,
  onToggleSelect,
  onToggleFavorite,
  onDelete,
  showAuthor = false,
  onCopy,
  copying = false,
  index = 0,
}: Props) {
  const source = recipe.source.platform !== 'manual' ? recipe.source : null;

  /* La confirmation vit dans la carte et non dans la page : deux cartes ne
     peuvent pas demander confirmation en même temps, et quitter la grille
     (filtre, recherche) démonte le composant et annule la demande. */
  const [confirming, setConfirming] = useState(false);

  return (
    <article
      style={
        {
          '--er-rot': restingTilt(recipe.id),
          animationDelay: `${Math.min(index * 60, 360)}ms`,
        } as CSSProperties
      }
      className={`fiche animate-er-in-fiche group relative overflow-hidden rounded-card border-[1.5px] border-rule-strong bg-paper-raised shadow-card hover:shadow-raised focus-within:shadow-raised ${
        selected ? 'outline-[3px] outline-offset-2 outline-ember' : ''
      }`}
    >
      <Link to={`/recipe/${recipe.id}`} className="block text-ink hover:text-ink">
        <div className="relative aspect-4/3 overflow-hidden border-b-[1.5px] border-rule-strong bg-paper-sunk">
          <RecipeImage
            src={displayImage(recipe)}
            alt={recipe.title}
            priority={index < 4}
            className="er-reveal size-full object-cover"
          />

          {/* Voile dégradé en pied d'image : garantit la lisibilité de la
              pastille de durée quelle que soit la photo. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/35 to-transparent" />

          {recipe.rating !== null && (
            <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-control border-[1.5px] border-rule-strong bg-paper-raised px-2 py-1">
              <Stars value={recipe.rating} size="sm" />
              <span className="label-mono-sm text-ink-soft">{RATING_LABELS[recipe.rating]}</span>
            </div>
          )}

          {recipe.totalTime !== null && (
            <span
              className={`absolute top-2.5 right-2.5 ${TAG} ${
                recipe.totalTime <= 30 ? 'bg-ember text-ember-ink' : 'bg-paper-raised text-ink'
              }`}
            >
              {formatDurationShort(recipe.totalTime)}
            </span>
          )}

          {/* Pastille « partagée », uniquement sur ses propres fiches : sur
              la page Découvrir tout est public, la répéter cinquante fois
              n'apprendrait rien. Elle occupe le coin bas droit, libre de
              toute autre information. */}
          {recipe.isPublic && recipe.isOwner && (
            <span className={`absolute right-2.5 bottom-2.5 flex items-center gap-1.5 bg-lime text-ink ${TAG}`}>
              <IconGlobe className="text-xs" />
              Partagée
            </span>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-baseline justify-between gap-2.5">
            <span className="label-mono-sm text-ink-faint">
              {[recipe.category && categoryLabel(recipe.category), recipe.difficulty && difficultyLabel(recipe.difficulty)]
                .filter(Boolean)
                .join(' · ') || 'Fiche'}
            </span>
            {recipe.servings !== null && (
              <span className="rounded-control border border-rule px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink-soft">
                {recipe.servings} pers.
              </span>
            )}
          </div>

          <h3 className="clamp-2 mt-1.5 font-display text-card leading-[1.05] tracking-[-0.02em] transition-colors group-hover:text-ember">
            {recipe.title}
          </h3>

          <div className="mt-3 flex items-center justify-between gap-2.5 border-t border-rule pt-2.5 font-mono text-[10px] tracking-[0.1em] uppercase text-ink-faint">
            {showAuthor ? (
              <>
                {/* « Par X » plutôt que la plateforme d'origine : c'est la
                    personne qui a fait le travail de mise en fiche. La
                    provenance reste visible en entier sur la fiche même. */}
                <span className="truncate text-ink-soft">Par {recipe.author.name}</span>
                {recipe.copyCount > 0 && (
                  <span className="shrink-0">
                    {recipe.copyCount} reprise{recipe.copyCount > 1 ? 's' : ''}
                  </span>
                )}
              </>
            ) : (
              <>
                <span>{PLATFORM_LABELS[recipe.source.platform]}</span>
                <span className="truncate">
                  {source?.author
                    ? source.author.startsWith('@')
                      ? source.author
                      : `@${source.author}`
                    : (source && hostOf(source.url)) ?? '—'}
                </span>
              </>
            )}
          </div>
        </div>
      </Link>

      {/* --- Contrôles superposés ---
          `focus-within` en plus du survol : sans lui, la poubelle, l'édition
          et le cœur resteraient invisibles à la tabulation. Un bouton qu'on
          peut activer sans le voir est un bouton qu'on active par accident —
          a fortiori celui qui supprime. Sur mobile (tactile), les boutons
          restent légèrement visibles pour pouvoir être touchés sans survol. */}
      <div className="absolute top-2.5 left-2.5 z-10 flex gap-1.5 opacity-90 sm:opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100 has-[[aria-pressed=true]]:opacity-100">
        {onToggleFavorite && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onToggleFavorite(recipe.id);
            }}
            aria-label={
              recipe.isFavorite
                ? `Retirer ${recipe.title} des favoris`
                : `Ajouter ${recipe.title} aux favoris`
            }
            aria-pressed={recipe.isFavorite}
            className={`${OVERLAY_BUTTON} ${
              recipe.isFavorite
                ? 'bg-ember text-ember-ink'
                : 'bg-paper-raised text-ink hover:bg-ember hover:text-ember-ink'
            }`}
          >
            <IconHeart filled={recipe.isFavorite} />
          </button>
        )}

        {selectable && onToggleSelect && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onToggleSelect(recipe.id);
            }}
            aria-label={
              selected
                ? `Retirer ${recipe.title} de la sélection`
                : `Sélectionner ${recipe.title}`
            }
            aria-pressed={selected}
            className={`${OVERLAY_BUTTON} ${
              selected ? 'bg-lime text-ink' : 'bg-paper-raised text-ink hover:bg-lime'
            }`}
          >
            <IconCheck />
          </button>
        )}

        {/* Bouton pour modifier la fiche directement depuis la carte */}
        {recipe.isOwner && (
          <Link
            to={`/recipe/${recipe.id}/edit`}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Modifier ${recipe.title}`}
            title="Modifier la recette"
            className={`${OVERLAY_BUTTON} bg-paper-raised text-ink hover:bg-lime hover:text-ink`}
          >
            <IconEdit />
          </Link>
        )}

        {/* La poubelle ferme la barre, séparée du reste : c'est la seule
            action irréversible de la carte, elle ne doit pas se trouver sous
            le doigt qui visait le cœur. Elle ne vire au rouge qu'au survol,
            pour ne pas crier dans une grille de cinquante vignettes. */}
        {onDelete && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              setConfirming(true);
            }}
            aria-label={`Supprimer ${recipe.title}`}
            className={`${OVERLAY_BUTTON} ml-0.5 bg-paper-raised text-ink hover:bg-danger hover:text-paper`}
          >
            <IconTrash />
          </button>
        )}
      </div>

      {/* --- Reprise dans son fichier ---
          Toujours visible, contrairement aux contrôles du coin haut gauche :
          c'est l'action principale de la page Découvrir, pas un geste
          d'entretien. Elle ne s'affiche pas sur sa propre fiche — on ne se
          copie pas soi-même. */}
      {onCopy && !recipe.isOwner && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            onCopy(recipe);
          }}
          disabled={copying}
          aria-label={`Enregistrer ${recipe.title} dans mes recettes`}
          className="press absolute top-2.5 left-2.5 z-10 inline-flex min-h-9 items-center gap-1.5 rounded-control border-[1.5px] border-rule-strong bg-paper-raised px-3 font-mono text-[10px] font-semibold tracking-[0.12em] text-ink uppercase hover:bg-lime disabled:cursor-not-allowed disabled:opacity-60"
        >
          {copying ? <Spinner className="size-3" /> : <IconCopy />}
          {copying ? 'Copie…' : 'Enregistrer'}
        </button>
      )}

      {/* --- Confirmation de suppression --- */}
      {confirming && (
        <div className="animate-er-in absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-paper/95 [animation-duration:.35s] px-4 text-center backdrop-blur-sm">
          <p className="font-display text-xl leading-tight text-ink">Supprimer&nbsp;?</p>
          <p className="clamp-2 text-[13px] leading-snug text-ink-soft">{recipe.title}</p>
          <p className="label-mono-sm text-ink-faint">Cette action est définitive</p>

          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDelete?.(recipe.id);
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-control border-[1.5px] border-rule-strong bg-danger px-3.5 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-paper transition-opacity hover:opacity-85"
            >
              <IconTrash />
              Supprimer
            </button>

            <button
              type="button"
              /* `autoFocus` : la touche Échap n'existe pas au doigt, et
                 l'annulation doit être ce qu'on atteint en premier au
                 clavier — jamais la suppression. */
              autoFocus
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-control border-[1.5px] border-rule-strong px-3.5 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-ink transition-colors hover:bg-paper-sunk"
            >
              <IconClose />
              Annuler
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
