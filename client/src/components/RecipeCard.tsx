import { useReducedMotion } from 'framer-motion';
import type { CSSProperties } from 'react';
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
import { IconCheck, IconHeart } from './Icons';
import { Stars } from './RecipeRating';
import { RecipeImage } from './ui';

/**
 * Fiche de recette.
 *
 * Ce n'est plus une carte d'application mais une fiche cartonnée : posée de
 * travers sur la page, coin supérieur droit coupé au massicot, bord inférieur
 * perforé comme un talon détachable. L'angle de rotation est dérivé de
 * l'identifiant — deux fiches voisines ne penchent jamais pareil, et une même
 * fiche garde son angle d'une visite à l'autre.
 *
 * L'image occupe les deux tiers : c'est le parti pris du §16,
 * « photographies culinaires mises en avant ». Le texte se contente de trois
 * informations (titre, durée, provenance) — une fiche n'a pas à tout dire.
 *
 * L'état de sélection sert à la liste de courses : on peut cocher plusieurs
 * recettes depuis la bibliothèque puis les envoyer d'un coup.
 *
 * Une recette déjà essayée porte un cachet en travers de sa photo, comme un
 * tampon apposé sur une fiche d'archive : c'est le seul élément de la grille
 * qui sorte de l'aplomb, et il se repère donc d'un coup d'œil dans un
 * fichier de cinquante fiches.
 */

interface Props {
  recipe: Recipe;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  index?: number;
}

/**
 * Angle stable tiré de l'identifiant, dans [-1.6°, +1.4°]. Assez pour que la
 * grille respire, assez peu pour rester lisible.
 */
function rotationFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1000;
  }
  return Math.round((-1.6 + (hash / 1000) * 3) * 10) / 10;
}

export function RecipeCard({
  recipe,
  selectable = false,
  selected = false,
  onToggleSelect,
  onToggleFavorite,
  index = 0,
}: Props) {
  const reduce = useReducedMotion();
  const source = recipe.source.platform !== 'manual' ? recipe.source : null;
  const rotation = reduce ? 0 : rotationFor(recipe.id);

  return (
    <article
      // Révélation en cascade : 70 ms par fiche, plafonnés pour que la 40ᵉ
      // n'attende pas deux secondes. On passe par l'animation CSS et non par
      // framer-motion, car celui-ci poserait un `transform` en style inline
      // qui écraserait le redressement au survol.
      style={
        {
          '--er-rot': `${rotation}deg`,
          animationDelay: `${Math.min(index * 70, 420)}ms`,
        } as CSSProperties
      }
      className={`fiche clip-corner group relative rounded-card border-[1.5px] bg-paper-raised shadow-card hover:z-10 hover:shadow-raised ${
        reduce ? '' : 'animate-er-in-fiche'
      } ${selected ? 'border-ember' : 'border-rule-strong'}`}
    >
      {/* La perforation d'archivage, en haut à gauche de toute fiche. */}
      <span
        className="pointer-events-none absolute top-[11px] left-[13px] z-3 size-[9px] rounded-full border-[1.5px] border-rule-strong bg-paper"
        aria-hidden="true"
      />

      <Link to={`/recipe/${recipe.id}`} className="block text-ink hover:text-ink">
        <div className="relative mx-[13px] mt-[26px] aspect-4/3 overflow-hidden border-[1.5px] border-rule-strong bg-paper-sunk">
          {/* Le zoom vit sur un calque intermédiaire : l'image elle-même peut
              disparaître si l'URL casse, la transformée doit survivre. */}
          <div className="er-reveal absolute inset-0">
            <RecipeImage
              src={displayImage(recipe)}
              alt={recipe.title}
              priority={index < 4}
              className="size-full object-cover"
            />
          </div>

          {/* Le cachet « Essayée ».
              Posé de biais en bas à gauche de la photo, il fait ce que fait un
              tampon sur une fiche d'archive : il informe sans se confondre avec
              le reste de la composition. Sa rotation compense celle de la
              fiche, de sorte qu'il reste presque droit à l'écran quelle que
              soit l'inclinaison tirée de l'identifiant. */}
          {recipe.rating !== null && (
            <div
              className="absolute bottom-2 left-2 z-3 flex flex-col gap-[3px] border-[1.5px] border-rule-strong bg-paper px-[9px] py-[6px] shadow-card"
              style={{ rotate: `${-rotation - 2}deg` }}
            >
              <span className="font-mono text-[9px] font-medium tracking-[0.16em] uppercase text-ember">
                Essayée · {RATING_LABELS[recipe.rating]}
              </span>
              <Stars value={recipe.rating} size="sm" />
            </div>
          )}

          {/* La durée en pastille cernée, posée sur la photo : terre cuite
              quand c'est rapide, crème sinon. */}
          {recipe.totalTime !== null && (
            <span
              className={`absolute top-2 right-2 border-[1.5px] border-rule-strong px-[9px] py-[5px] font-mono text-[9px] font-medium tracking-[0.16em] uppercase ${
                recipe.totalTime <= 30 ? 'bg-ember text-ember-ink' : 'bg-paper text-ink'
              }`}
            >
              {formatDurationShort(recipe.totalTime)}
            </span>
          )}
        </div>

        <div className="px-[15px] pt-4">
          <div className="flex items-baseline justify-between gap-2.5">
            <span className="label-mono-sm text-ink-faint">
              {[recipe.category && categoryLabel(recipe.category), recipe.difficulty && difficultyLabel(recipe.difficulty)]
                .filter(Boolean)
                .join(' · ') || 'Fiche'}
            </span>
            {recipe.servings !== null && (
              <span className="font-display text-[26px] leading-none text-ink/24">
                {recipe.servings}
              </span>
            )}
          </div>

          <h3 className="clamp-2 mt-2 font-display text-card leading-[1.02] tracking-[-0.025em]">
            {recipe.title}
          </h3>

          {/* Provenance : jamais masquée (§13). */}
          <div className="mt-3 flex items-center justify-between gap-2.5 border-t border-dashed border-rule pt-[11px] font-mono text-[10px] tracking-[0.12em] uppercase text-ink/55">
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

        {/* Le talon détachable qui ferme la fiche. */}
        <div className="edge-punched mt-1.5" aria-hidden="true" />
      </Link>

      {/* --- Contrôles superposés ---
          Ils occupent l'emplacement du badge de la maquette (top 7px,
          right 30px, à gauche du coin coupé). Le carré visible fait 32px pour
          ne pas écraser la photo, mais `before:` étend la cible tactile à
          44px au-delà du tracé — le doigt vise plus large que l'œil. */}
      <div className="absolute top-[7px] right-[30px] z-3 flex gap-1.5">
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
            className={`relative grid size-8 place-items-center rounded-control border-[1.5px] border-rule-strong transition-colors before:absolute before:-inset-1.5 before:content-[''] ${
              recipe.isFavorite ? 'bg-ember text-ember-ink' : 'bg-paper text-ink hover:bg-ember hover:text-ember-ink'
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
            className={`relative grid size-8 place-items-center rounded-control border-[1.5px] border-rule-strong transition-colors before:absolute before:-inset-1.5 before:content-[''] ${
              selected ? 'bg-lime text-ink' : 'bg-paper text-ink hover:bg-lime'
            }`}
          >
            <IconCheck />
          </button>
        )}
      </div>
    </article>
  );
}
