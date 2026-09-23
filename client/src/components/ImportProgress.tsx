import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { IMPORT_STEP_LABELS, type ImportStep, type ImportStepKey } from '../lib/types';
import { IconWarning } from './Icons';

/**
 * Journal de progression de l'import.
 *
 * Point clé du cahier des charges (§2) : ce composant n'anime PAS une
 * progression décorative. Il affiche l'état réel renvoyé par le backend.
 *
 * Quatre états visuellement distincts, et la distinction compte :
 *  - done    : l'étape a réussi (carré vert acide plein) ;
 *  - skipped : l'étape ne s'appliquait pas ou n'a pas pu se faire, sans que
 *              ce soit un échec (carré creux + raison). Ce n'est jamais
 *              présenté comme une réussite ;
 *  - failed  : l'étape a échoué (carré terre cuite) ;
 *  - running / pending : en cours (carré terre cuite qui clignote), à venir.
 *
 * Le rendu prend la forme d'un relevé de console : numéro d'étape, pastille,
 * libellé en mono. Il sert aussi bien sur le panneau sombre de l'accueil
 * (`onDark`) que sur une fiche crème.
 */

interface Props {
  steps: ImportStep[];
  /** Pendant la requête, on affiche une progression optimiste mesurée. */
  pending?: boolean;
  /** Rendu sur le panneau d'import sombre plutôt que sur le papier crème. */
  onDark?: boolean;
}

/** Ordre d'affichage fixe, même si le backend renvoie autre chose. */
const ORDER: ImportStepKey[] = [
  'source-detected',
  'content-fetched',
  'media-analyzed',
  'transcript-ready',
  'ingredients-found',
  'steps-generated',
  'recipe-ready',
];

/**
 * La pastille d'état : un carré plein de 7px, pas un rond.
 *
 * Le carré n'est pas un détail gratuit — c'est le seul glyphe de l'interface
 * qui n'est ni une lettre ni un filet, et il doit se lire comme un voyant de
 * machine, pas comme une puce de liste.
 *
 * Quatre états et non trois : la maquette n'en montre que trois (à venir /
 * en cours / faite) parce qu'elle simule un import qui réussit toujours.
 * L'application réelle doit aussi pouvoir dire « ça a échoué » et « ça n'a
 * pas pu se faire », d'où la terre cuite pleine et le carré creux.
 */
function StepDot({ status, onDark }: { status: ImportStep['status']; onDark: boolean }) {
  const base = 'block size-[7px] shrink-0';
  // Le creux des états non atteints : pas de filet, juste un aplat très pâle.
  const idle = onDark ? 'bg-paper/22' : 'bg-ink/22';

  switch (status) {
    case 'done':
      return <span className={`${base} bg-lime`} />;
    case 'failed':
      return <span className={`${base} bg-ember`} />;
    case 'skipped':
      // Sautée : le filet seul, sans remplissage. Une étape sautée n'est pas
      // une réussite et ne doit jamais emprunter le vert acide.
      return (
        <span
          className={`${base} border-[1.5px] bg-transparent ${
            onDark ? 'border-paper/45' : 'border-ink/45'
          }`}
        />
      );
    case 'running':
      return <span className={`${base} animate-er-blink-fast bg-ember`} />;
    default:
      return <span className={`${base} ${idle}`} />;
  }
}

export function ImportProgress({ steps, pending = false, onDark = false }: Props) {
  const reduce = useReducedMotion();
  const byKey = new Map(steps.map((step) => [step.key, step]));

  const doneCount = ORDER.filter((key) => byKey.get(key)?.status === 'done').length;
  const ratio = pending && doneCount === 0 ? 0.08 : doneCount / ORDER.length;

  const mutedText = onDark ? 'text-paper/45' : 'text-ink-faint';

  /**
   * La couleur du libellé porte l'état à elle seule, pastille masquée : le
   * vert acide pour l'acquis, l'encre pleine pour ce qui se joue maintenant,
   * un gris très effacé pour ce qui n'est pas encore arrivé. Sur crème le
   * vert ne passe pas en texte (contraste), on prend l'olive à la place.
   */
  function textTone(status: ImportStep['status']) {
    switch (status) {
      case 'done':
        return onDark ? 'text-lime' : 'text-olive';
      case 'failed':
        return 'text-ember';
      case 'running':
        return onDark ? 'text-paper' : 'text-ink';
      default:
        // « à venir » et « sautée » partagent l'effacement : ni l'une ni
        // l'autre n'est un acquis. La raison, elle, reste affichée dessous.
        return onDark ? 'text-paper/35' : 'text-ink/35';
    }
  }

  return (
    <div>
      <ol className="flex flex-col gap-2.5">
        {ORDER.map((key, index) => {
          const step = byKey.get(key);
          const status = step?.status ?? 'pending';

          return (
            <motion.li
              key={key}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduce ? 0 : index * 0.04, duration: 0.25 }}
              className="flex items-start gap-2.5"
            >
              <span className="pt-[5px]">
                <StepDot status={status} onDark={onDark} />
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={`font-mono text-[11px] leading-normal tracking-[0.1em] uppercase transition-colors duration-[400ms] ${textTone(
                    status,
                  )}`}
                >
                  {/* Le numéro d'étape, comme dans un relevé machine. */}
                  {String(index + 1).padStart(2, '0')} · {IMPORT_STEP_LABELS[key]}
                </p>

                <AnimatePresence>
                  {step?.detail && (
                    <motion.p
                      initial={reduce ? false : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className={`mt-1 text-xs leading-relaxed ${
                        status === 'failed' ? 'text-ember' : mutedText
                      }`}
                    >
                      {step.detail}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ol>

      {/* Jauge : un filet de 2px qui avance, pas une barre arrondie. Elle
          reprend le vert acide des pastilles faites — c'est la même
          information, cumulée. */}
      <div
        className={`mt-3.5 h-0.5 overflow-hidden ${onDark ? 'bg-paper/14' : 'bg-ink/14'}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={ORDER.length}
        aria-valuenow={doneCount}
        aria-label="Progression de l'import"
      >
        <div
          className={`h-full transition-[width] duration-700 ease-out-expo ${
            onDark ? 'bg-lime' : 'bg-olive'
          }`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Récapitulatif des limites rencontrées par l'importer.
 * Exemple : « TikTok ne donne pas accès à l'audio ». L'utilisateur doit savoir
 * sur quelle base la recette a été produite.
 */
export function ImportNotes({ notes, onDark = false }: { notes: string[]; onDark?: boolean }) {
  if (notes.length === 0) return null;

  return (
    <div
      className={`mt-4 border-l-[3px] px-3.5 py-3 ${
        onDark ? 'border-paper/30 bg-paper/5' : 'border-rule-strong bg-paper-sunk/60'
      }`}
    >
      <p
        className={`label-mono-sm flex items-center gap-1.5 ${
          onDark ? 'text-paper/60' : 'text-ink-soft'
        }`}
      >
        <IconWarning className="text-sm" />
        Comment cette recette a été obtenue
      </p>
      <ul className="mt-2 space-y-1">
        {notes.map((note, index) => (
          <li
            key={index}
            className={`text-xs leading-relaxed ${onDark ? 'text-paper/45' : 'text-ink-faint'}`}
          >
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}
