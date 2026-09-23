import { useEffect, useRef, useState } from 'react';
import { IconStar } from './Icons';
import { Button, Label, Textarea } from './ui';
import { MAX_RATING, RATING_LABELS } from '../lib/types';
import { formatTriedAt } from '../lib/format';

/**
 * Notation d'une recette essayée.
 *
 * Le parti pris : on ne note pas une recette qu'on a lue, on note un plat
 * qu'on a cuisiné. D'où le vocabulaire — « Je l'ai essayée » plutôt que
 * « Noter » — et la date d'essai affichée à côté de la note. Le fichier
 * devient un journal : ce qui a été fait, et ce que ça a donné.
 *
 * Trois pièces :
 *
 *  - `Stars`, l'affichage seul, réutilisé sur la fiche cartonnée ;
 *  - `StarPicker`, la rangée cliquable avec prévisualisation au survol ;
 *  - `RatingPanel`, le bloc complet de la page recette (étoiles, commentaire,
 *    date d'essai, retrait de la note).
 */

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

/**
 * Les étoiles en lecture seule.
 *
 * Les cinq étoiles sont toujours dessinées, les non acquises en creux : une
 * note de 2 doit se lire « 2 sur 5 » d'un coup d'œil, ce que trois étoiles
 * absentes ne diraient pas. Le libellé textuel part dans l'aria-label, car
 * une rangée de formes n'est rien pour un lecteur d'écran.
 */
export function Stars({
  value,
  size = 'md',
  className = '',
}: {
  value: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const scale = size === 'sm' ? 'text-[12px]' : 'text-base';

  return (
    <span
      className={`inline-flex items-center gap-[3px] text-ember ${scale} ${className}`}
      role="img"
      aria-label={`${value} sur ${MAX_RATING} — ${RATING_LABELS[value] ?? ''}`}
    >
      {Array.from({ length: MAX_RATING }, (_, index) => (
        <IconStar
          key={index}
          filled={index < value}
          className={index < value ? '' : 'text-ink-faint'}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Saisie
// ---------------------------------------------------------------------------

/**
 * La rangée cliquable.
 *
 * Le survol prévisualise la note sans l'appliquer, et le libellé
 * (« Correct », « À refaire ») suit le curseur : on sait ce qu'on va dire
 * avant de le dire. Chaque étoile est un vrai bouton — donc atteignable au
 * clavier et annoncée individuellement, contrairement à un widget à base de
 * `div` et de coordonnées de souris.
 */
export function StarPicker({
  value,
  onRate,
  disabled = false,
}: {
  value: number | null;
  onRate: (rating: number) => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Ce qu'on montre : la prévisualisation si le curseur est sur la rangée,
  // la note enregistrée sinon.
  const shown = hovered ?? value ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        className="flex items-center gap-1"
        onMouseLeave={() => setHovered(null)}
      >
        {Array.from({ length: MAX_RATING }, (_, index) => {
          const rating = index + 1;
          const active = rating <= shown;

          return (
            <button
              key={rating}
              type="button"
              disabled={disabled}
              onClick={() => onRate(rating)}
              onMouseEnter={() => setHovered(rating)}
              onFocus={() => setHovered(rating)}
              onBlur={() => setHovered(null)}
              aria-label={`${rating} étoile${rating > 1 ? 's' : ''} — ${RATING_LABELS[rating]}`}
              aria-pressed={value === rating}
              className={`grid size-11 place-items-center rounded-control border-[1.5px] text-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? 'border-rule-strong bg-ember text-ember-ink'
                  : 'border-ink/30 text-ink/40 hover:border-rule-strong hover:text-ember'
              }`}
            >
              <IconStar filled={active} />
            </button>
          );
        })}
      </div>

      {/* Réservé en hauteur : sans ça, la ligne apparaîtrait au premier
          survol et pousserait tout le bloc vers le bas. */}
      <span className="label-mono-sm min-h-4 text-ember">
        {shown > 0 ? RATING_LABELS[shown] : ''}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloc complet — page recette
// ---------------------------------------------------------------------------

interface PanelProps {
  rating: number | null;
  ratingNote: string | null;
  triedAt: string | null;
  /** `null` retire la note et remet la recette dans les « à tester ». */
  onSubmit: (rating: number | null, note: string | null) => Promise<void>;
}

export function RatingPanel({ rating, ratingNote, triedAt, onSubmit }: PanelProps) {
  const [note, setNote] = useState(ratingNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Le champ suit la recette rechargée, sauf s'il est en cours d'édition :
     réécrire par-dessus ce que l'utilisateur est en train de taper serait le
     pire des comportements. */
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setNote(ratingNote ?? '');
  }, [ratingNote]);

  const tried = rating !== null;
  const triedLabel = formatTriedAt(triedAt);

  async function submit(nextRating: number | null, nextNote: string | null) {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(nextRating, nextNote);
      dirty.current = false;
    } catch {
      setError("La note n'a pas pu être enregistrée.");
    } finally {
      setSaving(false);
    }
  }

  /* Cliquer une étoile enregistre immédiatement, en emportant le commentaire
     déjà saisi : on ne demande pas de valider deux fois un geste aussi
     simple. Le commentaire garde son propre bouton, lui. */
  const handleRate = (next: number) => submit(next, note.trim() || null);

  return (
    <section className="surface mt-6.5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-[1.5px] border-rule-strong pb-3.5">
        <div>
          <Label className="text-ember">{tried ? 'Essayée' : 'Pas encore essayée'}</Label>
          <h2 className="mt-2 text-[34px]">
            {tried ? 'Ton verdict' : "Tu l'as cuisinée ?"}
          </h2>
        </div>

        {tried && triedLabel && (
          <span className="label-mono-sm text-ink-faint">Essayée {triedLabel}</span>
        )}
      </div>

      <p className="mt-4 max-w-prose text-[15px] leading-[1.6] text-ink-soft">
        {tried
          ? 'Ta note apparaît sur la fiche dans le fichier. Tu peux la revoir à tout moment.'
          : "Note-la une fois le plat goûté : elle portera un cachet dans le fichier, et tu retrouveras d'un coup d'œil ce qui valait le coup."}
      </p>

      <div className="mt-5">
        <StarPicker value={rating} onRate={handleRate} disabled={saving} />
      </div>

      <div className="mt-6">
        <Label as="div" className="mb-2 block text-ink-soft">
          Commentaire
        </Label>
        <Textarea
          rows={3}
          value={note}
          disabled={saving}
          onChange={(event) => {
            dirty.current = true;
            setNote(event.target.value);
          }}
          placeholder="Trop salé, refaire avec moitié moins de crème…"
          maxLength={1000}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          /* Sans note, le commentaire seul n'a nulle part où vivre : le
             serveur l'effacerait aussitôt. On demande donc l'étoile d'abord. */
          disabled={!tried}
          onClick={() => submit(rating, note.trim() || null)}
        >
          Enregistrer le commentaire
        </Button>

        {tried && (
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setNote('');
              dirty.current = false;
              void submit(null, null);
            }}
          >
            Retirer la note
          </Button>
        )}

        {!tried && (
          <span className="label-mono-sm text-ink-faint">Choisis d'abord une note</span>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}
