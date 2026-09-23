import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IconCheck, IconClose, IconReset } from '../components/Icons';
import { Button, ErrorPanel, Spinner } from '../components/ui';
import { useTimer } from '../hooks/useTimer';
import { ApiError, api } from '../lib/api';
import { formatTimer } from '../lib/format';
import { formatIngredientLine } from '../lib/units';
import type { Recipe } from '../lib/types';

/**
 * Mode cuisine (§10).
 *
 * Seul écran de l'application qui bascule sur fond d'encre en permanence,
 * quel que soit le thème : de nuit comme de jour, un plan de travail est
 * mieux servi par du texte clair sur fond sombre — moins de lumière projetée
 * dans la pièce, et un contraste qui tient à trois mètres.
 *
 * Contraintes de contexte : téléphone posé sur le plan de travail, à 50 cm,
 * lu de biais, éventuellement avec les mains sales. D'où :
 *  - une étape à la fois, composée en serif d'affiche très large ;
 *  - un numéro d'étape en énorme, qui sert de repère visuel ;
 *  - le minuteur en grand disque, lisible d'un coup d'œil ;
 *  - l'écran maintenu allumé via Wake Lock tant qu'on cuisine.
 */

/** Rayon du disque de minuterie, en unités du viewBox SVG. */
const TIMER_RADIUS = 132;
const TIMER_CIRCUMFERENCE = 2 * Math.PI * TIMER_RADIUS;

/* Le mode cuisine impose l'encre : ses couleurs sont écrites en dur plutôt
   qu'en jetons, sinon le thème sombre donnerait du crème sur crème. */
const RULE = 'rgb(242 237 227 / 0.22)';
/** L'étiquette mono du mode cuisine : plus large et plus pâle qu'ailleurs. */
const META = "font-mono text-[10.5px] font-medium tracking-[0.2em] uppercase text-[#f2ede3]/50";

export function CookModePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [muted, setMuted] = useState(false);

  const step = recipe?.steps[index] ?? null;
  const timer = useTimer((step?.duration ?? 0) * 60, { muted });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    api
      .getRecipe(id)
      .then((result) => !cancelled && setRecipe(result))
      .catch((err) =>
        !cancelled && setError(err instanceof ApiError ? err.message : 'Recette introuvable.'),
      )
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * Empêche l'écran de s'éteindre pendant la cuisine.
   * Le verrou saute quand l'onglet passe en arrière-plan : on le reprend au
   * retour, sinon l'écran s'éteindrait au premier coup d'œil ailleurs.
   */
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let released = false;

    async function acquire() {
      try {
        if ('wakeLock' in navigator) {
          lock = await navigator.wakeLock.request('screen');
        }
      } catch {
        // Batterie faible ou API refusée : sans conséquence fonctionnelle.
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible' && !released) void acquire();
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  const total = recipe?.steps.length ?? 0;

  const goTo = useMemo(
    () => (next: number) => {
      if (!recipe || next < 0 || next >= recipe.steps.length) return;
      setDirection(next > index ? 1 : -1);
      setIndex(next);
    },
    [recipe, index],
  );

  // Navigation au clavier : utile sur tablette avec clavier, et en test.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') goTo(index + 1);
      else if (event.key === 'ArrowLeft') goTo(index - 1);
      else if (event.key === 'Escape') navigate(`/recipe/${id}`);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, navigate, id]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#17140f]">
        <Spinner className="size-8 text-[#d8f250]" />
      </div>
    );
  }

  if (error || !recipe || !step) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#17140f] px-4">
        <div className="max-w-md">
          <ErrorPanel
            title="Impossible de démarrer"
            message={error ?? "Cette recette n'a pas d'étapes."}
            className="border-[#f2603a] bg-[#f2603a]/10 [&_p]:text-[#f2ede3]/70"
            action={
              <Button
                onClick={() => navigate('/recipes')}
                className="border-[#f2ede3] text-[#f2ede3] hover:bg-[#f2ede3] hover:text-[#17140f]"
              >
                Retour
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const isLast = index === total - 1;
  const hasTimer = step.duration !== null && step.duration > 0;
  const running = timer.state === 'running';

  return (
    <div className="relative z-10 flex min-h-dvh flex-col overflow-x-hidden bg-[#17140f] text-[#f2ede3]">
      {/* Halo d'ambiance : la même dérive lente que sur le reste du site. */}
      <div
        className="animate-er-drift pointer-events-none absolute top-[-28%] right-[-18%] aspect-square w-[64vw] rounded-full bg-[radial-gradient(circle,rgb(214_70_31/0.2),transparent_66%)] blur-[20px]"
        aria-hidden="true"
      />

      {/* ---------------- En-tête ---------------- */}
      <header
        className="relative flex flex-wrap items-center justify-between gap-4 border-b-[1.5px] px-4 pt-6 pb-3.5 sm:px-8.5"
        style={{ borderColor: RULE }}
      >
        <span className={`${META} min-w-0 flex-1 truncate`}>
          Étape {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')} ·{' '}
          {recipe.title}
        </span>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setShowIngredients(true)}
            className="rounded-control border-[1.5px] px-3.5 py-2.5 font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-[#f2ede3]/50 transition-colors duration-200 hover:border-[#d8f250] hover:bg-[#d8f250] hover:text-[#17140f]"
            style={{ borderColor: RULE }}
          >
            Ingrédients
          </button>

          {/* Le bouton de la maquette, rendu réel : il coupe l'alarme de fin
              de minuteur (bips ET vibration), pas seulement son icône. */}
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-pressed={muted}
            aria-label={muted ? "Réactiver l'alarme du minuteur" : "Couper l'alarme du minuteur"}
            className="rounded-control border-[1.5px] px-3.5 py-2.5 font-mono text-[10px] font-medium tracking-[0.16em] uppercase text-[#f2ede3]/50 transition-colors duration-200 hover:border-[#f2ede3] hover:text-[#f2ede3]"
            style={{ borderColor: RULE }}
          >
            {muted ? 'Son ✕' : 'Son ▮▮▮'}
          </button>

          <button
            type="button"
            onClick={() => navigate(`/recipe/${recipe.id}`)}
            aria-label="Quitter le mode cuisine"
            className="rounded-control border-[1.5px] border-[#f2ede3] bg-[#f2ede3] px-3.5 py-2.5 font-mono text-[10px] font-medium tracking-[0.16em] text-[#17140f] uppercase transition-colors duration-200 hover:bg-transparent hover:text-[#f2ede3]"
          >
            Quitter ✕
          </button>
        </div>
      </header>

      {/* ---------------- Progression ----------------
          Absente de la maquette, conservée comme exigence produit : elle
          donne le repère « où j'en suis » et permet de sauter une étape. */}
      <div className="relative flex gap-1 px-4 pt-3 sm:px-8.5">
        {recipe.steps.map((_, stepIndex) => (
          <button
            key={stepIndex}
            type="button"
            onClick={() => goTo(stepIndex)}
            aria-label={`Aller à l'étape ${stepIndex + 1}`}
            className="h-1 flex-1 overflow-hidden bg-[#f2ede3]/15"
          >
            <span
              className={`block size-full transition-colors ${
                stepIndex <= index ? 'bg-[#d6461f]' : ''
              }`}
            />
          </button>
        ))}
      </div>

      {/* ---------------- Étape ---------------- */}
      <main className="relative flex flex-1 items-center overflow-y-auto px-4 py-10 sm:px-8.5">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={index}
            custom={direction}
            initial={reduce ? false : { opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto grid w-full max-w-[1180px] items-center gap-13 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]"
          >
            {/* --- Colonne texte --- */}
            <div>
              {/* Le numéro d'étape en très grand : le repère qu'on retrouve
                  d'un coup d'œil en revenant au plan de travail. */}
              <div className="font-display text-[clamp(70px,10vw,130px)] leading-[0.8] tracking-[-0.05em] text-[#f2ede3]/18 tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </div>

              {step.title && (
                <h1 className="mt-4.5 font-display text-[clamp(22px,2.6vw,32px)] leading-[1.05] tracking-[-0.03em] text-[#f2ede3]/70">
                  {step.title}
                </h1>
              )}

              {/* La serif d'affiche, à la taille de l'écran : c'est le texte
                  que l'on lit debout, à un bras du plan de travail. */}
              <p className="mt-4.5 font-display text-[clamp(30px,4.4vw,56px)] leading-[1.08] tracking-[-0.032em] text-[#f2ede3] text-pretty">
                {step.instruction}
              </p>

              {step.temperature !== null && (
                <p className="mt-6 inline-flex items-center gap-2 rounded-control border-[1.5px] border-[#d8f250] px-4 py-2.5 font-mono text-[10px] font-medium tracking-[0.16em] text-[#d8f250] uppercase">
                  {step.temperature} °C
                </p>
              )}
            </div>

            {/* --- Colonne minuteur --- */}
            {hasTimer && (
              <div className="flex flex-col items-center gap-5.5">
                <div className="relative size-[290px] max-w-[66vw]">
                  <svg viewBox="0 0 290 290" className="size-full -rotate-90">
                    <circle
                      cx="145"
                      cy="145"
                      r={TIMER_RADIUS}
                      fill="none"
                      stroke={RULE}
                      strokeWidth="1.5"
                    />
                    <circle
                      cx="145"
                      cy="145"
                      r={TIMER_RADIUS}
                      fill="none"
                      stroke={timer.state === 'done' ? '#d8f250' : '#d6461f'}
                      strokeWidth="7"
                      strokeLinecap="butt"
                      strokeDasharray={TIMER_CIRCUMFERENCE}
                      strokeDashoffset={TIMER_CIRCUMFERENCE * (1 - timer.progress)}
                      style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                    />
                  </svg>

                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    {timer.state === 'done' ? (
                      <>
                        <IconCheck className="text-6xl text-[#d8f250]" />
                        <span className={`${META} !text-[#d8f250]`}>C'est prêt</span>
                      </>
                    ) : (
                      <>
                        <span className="font-display text-[72px] leading-none tracking-[-0.03em] text-[#f2ede3] tabular-nums">
                          {formatTimer(
                            timer.state === 'idle' ? step.duration! * 60 : timer.remaining,
                          )}
                        </span>
                        <span className={META}>
                          {timer.state === 'paused'
                            ? 'en pause'
                            : running
                              ? 'en cours'
                              : 'minuteur'}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  {/* Un seul bouton bascule, comme dans la maquette : le
                      libellé dit l'action, pas l'état. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (running) timer.pause();
                      else if (timer.state === 'paused') timer.resume();
                      // Après la sonnerie, le même bouton relance : on
                      // repasse souvent deux minutes sur la même étape.
                      else timer.start(step.duration! * 60);
                    }}
                    className={`min-w-[180px] rounded-control border-[1.5px] px-8.5 py-3.75 font-mono text-[11px] font-medium tracking-[0.2em] uppercase transition-colors duration-200 ${
                      running
                        ? 'bg-transparent text-[#f2ede3]'
                        : 'border-[#d6461f] bg-[#d6461f] text-[#f7f2e8]'
                    }`}
                    style={running ? { borderColor: RULE } : undefined}
                  >
                    {running ? 'Pause ▮▮' : timer.state === 'done' ? 'Relancer ▶' : 'Démarrer ▶'}
                  </button>

                  {timer.state !== 'idle' && (
                    <button
                      type="button"
                      onClick={timer.reset}
                      aria-label="Réinitialiser le minuteur"
                      className="grid size-12 place-items-center rounded-control border-[1.5px] text-[#f2ede3]/50 transition-colors duration-200 hover:border-[#f2ede3] hover:text-[#f2ede3]"
                      style={{ borderColor: RULE }}
                    >
                      <IconReset />
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ---------------- Navigation ---------------- */}
      <nav
        className="safe-bottom sticky bottom-0 z-20 border-t-[1.5px] bg-[#17140f]/95 px-4 pt-3.5 backdrop-blur-lg sm:px-8.5"
        style={{ borderColor: RULE }}
      >
        <div className="mx-auto flex max-w-[1180px] justify-center gap-3.5">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="max-w-[300px] flex-1 rounded-control border-[1.5px] bg-transparent p-5.5 font-mono text-[12px] font-medium tracking-[0.16em] text-[#f2ede3] uppercase transition-colors duration-200 hover:border-[#f2ede3] disabled:opacity-25"
            style={{ borderColor: RULE }}
          >
            ← Précédent
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={() => navigate(`/recipe/${recipe.id}`)}
              className="inline-flex max-w-[300px] flex-1 items-center justify-center gap-2.5 rounded-control border-[1.5px] border-[#d8f250] bg-[#d8f250] p-5.5 font-mono text-[12px] font-medium tracking-[0.16em] text-[#17140f] uppercase transition-colors duration-200 hover:bg-transparent hover:text-[#d8f250]"
            >
              <IconCheck /> Terminé
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="max-w-[300px] flex-1 rounded-control border-[1.5px] border-[#d8f250] bg-[#d8f250] p-5.5 font-mono text-[12px] font-medium tracking-[0.16em] text-[#17140f] uppercase transition-colors duration-200 hover:bg-transparent hover:text-[#d8f250]"
            >
              Suivant →
            </button>
          )}
        </div>
      </nav>

      {/* ---------------- Panneau ingrédients ---------------- */}
      <AnimatePresence>
        {showIngredients && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowIngredients(false)}
              className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm"
            />

            <motion.aside
              initial={reduce ? { opacity: 0 } : { y: '100%' }}
              animate={reduce ? { opacity: 1 } : { y: 0 }}
              exit={reduce ? { opacity: 0 } : { y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="safe-bottom fixed inset-x-0 bottom-0 z-50 max-h-[75dvh] overflow-y-auto border-t-[1.5px] border-[#d8f250] bg-[#221d17] p-5 sm:p-7"
              role="dialog"
              aria-label="Liste des ingrédients"
            >
              <div className="mx-auto mb-5 h-1 w-10 bg-[#f2ede3]/30" />

              <div className="mx-auto max-w-2xl">
                <div
                  className="flex items-center justify-between border-b-[1.5px] pb-3.5"
                  style={{ borderColor: RULE }}
                >
                  <h2 className="font-display text-[34px] leading-none tracking-[-0.03em] text-[#f2ede3]">
                    Ingrédients
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowIngredients(false)}
                    aria-label="Fermer"
                    className="grid size-10 place-items-center rounded-control border-[1.5px] text-[#f2ede3]/50 transition-colors duration-200 hover:border-[#f2ede3] hover:text-[#f2ede3]"
                    style={{ borderColor: RULE }}
                  >
                    <IconClose />
                  </button>
                </div>

                <ul className="mt-2">
                  {recipe.ingredients.map((item, itemIndex) => (
                    <li
                      key={itemIndex}
                      className="border-b border-dotted border-[#f2ede3]/20 py-3 text-lg text-[#f2ede3]/88 last:border-0"
                    >
                      {formatIngredientLine({
                        quantity: item.quantity,
                        unit: item.unit,
                        label: item.ingredient,
                        preparation: item.preparation,
                      })}
                      {item.quantity === null && item.note && (
                        <span className="ml-2 text-sm text-[#e0a83c]">({item.note})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
