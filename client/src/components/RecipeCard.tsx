import { useState } from 'react';
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
import { IconCheck, IconClose, IconHeart, IconTrash } from './Icons';
import { Stars } from './RecipeRating';
import { RecipeImage } from './ui';

/**
 * Carte de recette.
 *
 * Vocabulaire Tailwind standard : carte droite, arrondie, ombre douce qui se
 * creuse au survol, image qui zoome légèrement en `scale`. L'image occupe
 * les deux tiers de la carte (§16, « photographies culinaires mises en
 * avant ») — c'est le seul héritage direct de la maquette précédente.
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
  index?: number;
}

export function RecipeCard({
  recipe,
  selectable = false,
  selected = false,
  onToggleSelect,
  onToggleFavorite,
  onDelete,
  index = 0,
}: Props) {
  const source = recipe.source.platform !== 'manual' ? recipe.source : null;

  /* La confirmation vit dans la carte et non dans la page : deux cartes ne
     peuvent pas demander confirmation en même temps, et quitter la grille
     (filtre, recherche) démonte le composant et annule la demande. */
  const [confirming, setConfirming] = useState(false);

  return (
    <article
      style={{ animationDelay: `${Math.min(index * 60, 360)}ms` }}
      className={`group relative animate-er-in overflow-hidden rounded-2xl border bg-paper-raised shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl ${
        selected ? 'border-ember ring-2 ring-ember/40' : 'border-rule hover:border-rule-strong'
      }`}
    >
      <Link to={`/recipe/${recipe.id}`} className="block text-ink hover:text-ink">
        <div className="relative aspect-4/3 overflow-hidden bg-paper-sunk">
          <RecipeImage
            src={displayImage(recipe)}
            alt={recipe.title}
            priority={index < 4}
            className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
          />

          {/* Voile dégradé en pied d'image : garantit la lisibilité de la
              pastille de durée quelle que soit la photo. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/35 to-transparent" />

          {recipe.rating !== null && (
            <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-paper/95 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
              <Stars value={recipe.rating} size="sm" />
              <span className="label-mono-sm text-ink-soft">{RATING_LABELS[recipe.rating]}</span>
            </div>
          )}

          {recipe.totalTime !== null && (
            <span
              className={`absolute top-2.5 right-2.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase shadow-sm ${
                recipe.totalTime <= 30 ? 'bg-ember text-ember-ink' : 'bg-paper/95 text-ink backdrop-blur-sm'
              }`}
            >
              {formatDurationShort(recipe.totalTime)}
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
              <span className="rounded-full bg-paper-sunk px-2 py-0.5 font-mono text-[11px] font-medium text-ink-soft">
                {recipe.servings} pers.
              </span>
            )}
          </div>

          <h3 className="clamp-2 mt-1.5 font-display text-card leading-[1.05] tracking-[-0.02em] transition-colors group-hover:text-ember">
            {recipe.title}
          </h3>

          <div className="mt-3 flex items-center justify-between gap-2.5 border-t border-rule pt-2.5 font-mono text-[10px] tracking-[0.1em] uppercase text-ink-faint">
            <span>{PLATFORM_LABELS[recipe.source.platform]}</span>
            <span className="truncate">
              {source?.author
                ? source.author.startsWith('@')
                  ? source.author
                  : `@${source.author}`
                : (source && hostOf(source.url)) ?? '—'}
            </span>
          </div>
        </div>
      </Link>

      {/* --- Contrôles superposés ---
          `focus-within` en plus du survol : sans lui, la poubelle et le cœur
          resteraient invisibles à la tabulation. Un bouton qu'on peut activer
          sans le voir est un bouton qu'on active par accident — a fortiori
          celui qui supprime. */}
      <div className="absolute top-2.5 left-2.5 z-10 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100 has-[[aria-pressed=true]]:opacity-100">
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
            className={`grid size-9 place-items-center rounded-full shadow-sm backdrop-blur-sm transition-colors ${
              recipe.isFavorite
                ? 'bg-ember text-ember-ink'
                : 'bg-paper/90 text-ink hover:bg-ember hover:text-ember-ink'
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
            className={`grid size-9 place-items-center rounded-full shadow-sm backdrop-blur-sm transition-colors ${
              selected ? 'bg-lime text-ink' : 'bg-paper/90 text-ink hover:bg-lime'
            }`}
          >
            <IconCheck />
          </button>
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
            className="ml-0.5 grid size-9 place-items-center rounded-full bg-paper/90 text-ink shadow-sm backdrop-blur-sm transition-colors hover:bg-danger hover:text-paper"
          >
            <IconTrash />
          </button>
        )}
      </div>

      {/* --- Confirmation de suppression --- */}
      {confirming && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-paper/95 px-4 text-center backdrop-blur-sm">
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
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-danger px-3.5 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-paper transition-opacity hover:opacity-85"
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
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rule-strong px-3.5 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-ink transition-colors hover:bg-paper-sunk"
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
