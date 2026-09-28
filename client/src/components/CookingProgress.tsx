import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IMPORT_STEP_LABELS, type ImportStep, type ImportStepKey } from '../lib/types';

/**
 * Progression de l'import, mise en scène comme une recette qui mijote.
 *
 * Un seul objet, la marmite, pour que l'œil sache où se poser. Elle suit
 * l'état réel du pipeline, reçu du serveur en flux :
 *  - récupération : le couvercle frémit sur un feu doux ;
 *  - analyse et génération : le couvercle saute, les ingrédients tombent
 *    un à un, le feu, les bulles et la vapeur montent avec l'avancée ;
 *  - recette prête : la marmite s'efface, l'assiette arrive sous sa cloche,
 *    et la cloche se soulève.
 *
 * La jauge avance d'un cran par étape franchie. Entre deux crans, elle
 * glisse lentement vers le suivant sans jamais l'atteindre : l'utilisateur
 * voit que ça travaille, sans qu'on annonce une étape qui n'est pas faite.
 */

const ORDER: ImportStepKey[] = [
  'source-detected',
  'content-fetched',
  'media-analyzed',
  'transcript-ready',
  'ingredients-found',
  'steps-generated',
  'recipe-ready',
];

/** Constante de temps (s) de la glissade à l'intérieur de chaque étape. */
const CREEP_SECONDS: Record<ImportStepKey, number> = {
  'source-detected': 1.5,
  'content-fetched': 5,
  'media-analyzed': 14,
  'transcript-ready': 16,
  'ingredients-found': 16,
  'steps-generated': 3,
  'recipe-ready': 2,
};

/** Le vocabulaire de cuisine, étape par étape. L'index 7 = terminé. */
const STAGES: Array<{ title: string; line: string }> = [
  { title: 'On lit l’étiquette', line: 'Repérage de la source' },
  { title: 'Au marché', line: 'On récupère la page et sa description' },
  { title: 'On regarde le chef', line: 'Visionnage de la vidéo' },
  { title: 'Prise de notes', line: 'Gestes et textes à l’écran deviennent des mots' },
  { title: 'Mise en place', line: 'Pesée des ingrédients et découpe des étapes' },
  { title: 'À feu doux', line: 'Les étapes mijotent' },
  { title: 'Dressage', line: 'Un coup de torchon sur le bord de l’assiette' },
  { title: 'C’est prêt !', line: 'Envoi en salle' },
];

/** Petites phrases qui tournent quand une étape s'éternise. */
const TIPS = [
  'Les meilleures sauces réduisent lentement.',
  'Une vidéo muette ? On lit les gestes, image par image.',
  'Les quantités « à l’œil » sont converties en grammes.',
  'Les portions seront ajustables sur la fiche.',
];

const SETTLED = new Set<ImportStep['status']>(['done', 'skipped']);

interface Props {
  steps: ImportStep[];
  /** L'import a échoué : le feu s'éteint, la scène se fige. */
  failed?: boolean;
}

export function CookingProgress({ steps, failed = false }: Props) {
  const reduce = useReducedMotion() ?? false;
  const byKey = useMemo(() => new Map(steps.map((step) => [step.key, step])), [steps]);

  // Première étape non franchie : c'est elle que la cuisine met en scène.
  const firstOpen = ORDER.findIndex((key) => !SETTLED.has(byKey.get(key)?.status ?? 'pending'));
  const active = firstOpen === -1 ? ORDER.length : firstOpen;
  const activeKey = ORDER[Math.min(active, ORDER.length - 1)]!;
  const activeStep = byKey.get(activeKey);
  const done = active === ORDER.length;
  const live = !reduce && !failed;

  // --- Jauge : crans réels + glissade bornée ---------------------------
  const target = useMotionValue(0);
  const smooth = useSpring(target, { stiffness: 50, damping: 18, mass: 0.8 });
  const width = useTransform(smooth, (value) => `${value}%`);
  const shownPercent = useTransform(smooth, (value) => `${Math.round(value)}`);
  // Valeur pour les lecteurs d'écran : la cible, pas chaque image du ressort.
  const [percent, setPercent] = useState(0);

  const stepStartedAt = useRef(Date.now());
  const highWater = useRef(0);

  useEffect(() => {
    stepStartedAt.current = Date.now();
  }, [active]);

  useEffect(() => {
    const tick = () => {
      const base = (active / ORDER.length) * 100;
      let next = base;
      if (!done && !failed) {
        const elapsed = (Date.now() - stepStartedAt.current) / 1000;
        const creep = 1 - Math.exp(-elapsed / CREEP_SECONDS[activeKey]);
        next = base + (100 / ORDER.length) * 0.88 * creep;
      }
      // La jauge ne recule jamais, même si le serveur rouvre une étape.
      highWater.current = Math.max(highWater.current, next);
      target.set(highWater.current);
      setPercent(Math.round(highWater.current));
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [active, activeKey, done, failed, target]);

  // --- Minuteur et astuces ----------------------------------------------
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (done || failed) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [done, failed]);

  const tip = elapsed >= 8 ? TIPS[Math.floor(elapsed / 7) % TIPS.length] : null;
  const stage = STAGES[active]!;
  const detail = activeStep?.status === 'running' ? activeStep.detail : null;
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');

  return (
    <div>
      {/* ---- Ce qui se passe, et où on en est ---- */}
      <div className="flex items-end justify-between gap-4" aria-live="polite">
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.h3
              key={failed ? 'failed' : active}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="text-[34px] leading-none text-paper"
            >
              {failed ? 'Le feu s’est éteint' : stage.title}
            </motion.h3>
          </AnimatePresence>
          <p className="mt-2 truncate text-[15px] text-paper/70">
            {failed ? 'Voici où ça a coincé :' : (detail ?? stage.line)}
          </p>
        </div>
        <p className="shrink-0 font-display text-[44px] leading-none text-paper tabular-nums">
          <motion.span>{shownPercent}</motion.span>
          <span className="text-[24px] text-paper/50">%</span>
        </p>
      </div>

      {/* ---- La marmite ---- */}
      <PotScene active={active} live={live} done={done} failed={failed} />

      {/* ---- La jauge : une sauce qui monte ---- */}
      <div
        className="relative"
        role="progressbar"
        aria-label="Progression de l'import"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} %, ${IMPORT_STEP_LABELS[activeKey]}`}
      >
        <div className="relative h-2.5 overflow-hidden rounded-[2px] bg-paper/10">
          <motion.div
            className={`er-sauce absolute inset-y-0 left-0 ${failed ? 'grayscale' : ''}`}
            style={{ width }}
          />
        </div>

        {/* La cuillère en bois qui remue au bout de la sauce. */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -top-5.5 -translate-x-1/2"
          style={{ left: width }}
        >
          <motion.svg
            width="18"
            height="26"
            viewBox="0 0 18 26"
            animate={live ? { rotate: [-12, 12, -12] } : { rotate: 0 }}
            transition={{ duration: 1.6, repeat: live ? Infinity : 0, ease: 'easeInOut' }}
            style={{ originX: 0.5, originY: 1 }}
          >
            <rect x="7.5" y="0" width="3" height="15" rx="1.5" fill="#c08a52" stroke="#17140f" strokeWidth="1" />
            <ellipse cx="9" cy="20" rx="5" ry="5.5" fill="#c08a52" stroke="#17140f" strokeWidth="1.4" />
          </motion.svg>
        </motion.div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 font-mono text-[11px] tracking-[0.1em] text-paper/55 uppercase">
        <span className="truncate">
          {done
            ? 'Recette prête'
            : `Étape ${Math.min(active + 1, ORDER.length)}/${ORDER.length} · ${IMPORT_STEP_LABELS[activeKey]}`}
        </span>
        <span className="shrink-0 tabular-nums">
          {minutes}:{seconds}
        </span>
      </div>

      <div className="mt-3 min-h-5">
        <AnimatePresence mode="wait">
          {tip && !done && !failed && (
            <motion.p
              key={tip}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[13px] text-paper/50 italic"
            >
              {tip}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// La scène
// ---------------------------------------------------------------------------

const PAPER = '#f2ede3';
const INK = '#17140f';
const EMBER = '#d6461f';
const LIME = '#d8f250';
const CARROT = '#f08a24';
const HERB = '#8fb024';
const FLAME_CORE = '#f7c948';

/** Sprites dessinés à la main (public/sprites), détourés et recadrés. */
const SPRITE = (name: string) => `/sprites/${name}.webp`;

/** Géométrie de la scène (viewBox 320 × 190). */
const POT = { x: 95, y: 58, width: 130, height: 110 };
const MOUTH = { x: 160, y: POT.y + POT.height * 0.13 };
const BURNER_Y = 182;

/**
 * Les ingrédients, dessinés dans le style des sprites : contour sombre
 * épais, aplats, une bande d'ombre franche. Chacun est centré sur (0, 0).
 */
function Carrot() {
  return (
    <g>
      <path d="M-13 -5.5 Q-15 0 -13 5.5 L14 0.8 Q15 0 14 -0.8 Z" fill={CARROT} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M-13 1.8 Q-2 3 13 0.8 L-13 5.5 Z" fill="#c9661a" />
      <path d="M-13 -5.5 Q-15 0 -13 5.5 L14 0.8 Q15 0 14 -0.8 Z" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M-5 -4 L-4 -1 M1 -3 L2 -0.5" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M-14 -2 Q-20 -8 -19 -11 Q-15 -8 -13 -3 Z M-14 1 Q-21 0 -23 -3 Q-17 -3 -13 0 Z" fill={HERB} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
    </g>
  );
}

function Garlic() {
  return (
    <g>
      <path d="M0 -11 Q2 -8 4 -7 Q11 -3 10 4 Q8 10 0 10 Q-8 10 -10 4 Q-11 -3 -4 -7 Q-2 -8 0 -11 Z" fill={PAPER} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M-10 4 Q-8 10 0 10 Q-6 6 -6 -2 Q-8 0 -10 4 Z" fill="#d9c9a8" />
      <path d="M0 -6 Q-3 2 0 10 M0 -6 Q4 2 3 9" fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M0 -11 Q2 -8 4 -7 Q11 -3 10 4 Q8 10 0 10 Q-8 10 -10 4 Q-11 -3 -4 -7 Q-2 -8 0 -11 Z" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
    </g>
  );
}

function Basil() {
  return (
    <g>
      <path d="M-11 6 Q-10 -9 10 -8 Q10 8 -11 6 Z" fill={HERB} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M-11 6 Q2 6 10 -8 Q7 5 -11 6 Z" fill="#6a8a1a" />
      <path d="M-11 6 Q-10 -9 10 -8 Q10 8 -11 6 Z" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M-9 4 Q0 -1 8 -6" fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
    </g>
  );
}

function Tomato() {
  return <image href={SPRITE('tomato')} x="-13" y="-13" width="26" height="25" />;
}

/** Ordre de chute, et léger décalage horizontal pour ne pas viser le même point. */
const DROPS = [
  { key: 'tomato', Shape: Tomato, dx: -10 },
  { key: 'carrot', Shape: Carrot, dx: 8 },
  { key: 'garlic', Shape: Garlic, dx: -3 },
  { key: 'basil', Shape: Basil, dx: 12 },
] as const;

/** Une chute toutes les 1,1 s ; chaque ingrédient revient toutes les 4,4 s. */
const DROP_EVERY = 1.1;
const DROP_DURATION = 0.85;

/** Les étincelles autour de l'assiette servie. */
const SPARKLES: ReadonlyArray<readonly [number, number]> = [
  [92, 70],
  [236, 112],
  [118, 44],
  [214, 150],
];

function PotScene({
  active,
  live,
  done,
  failed,
}: {
  active: number;
  live: boolean;
  done: boolean;
  failed: boolean;
}) {
  // Couvercle posé pendant la récupération, ôté dès qu'on cuisine.
  const cooking = active >= 2 && !done;
  // Le feu monte avec l'avancée : doux, moyen, vif.
  const heat = failed ? 0 : done ? 0 : active >= 4 ? 1 : active >= 2 ? 0.75 : 0.45;
  const loop = live ? Infinity : 0;
  const period = DROPS.length * DROP_EVERY;

  return (
    <svg
      viewBox="0 0 320 190"
      className="mx-auto my-3 block h-auto w-full max-w-[420px]"
      role="img"
      aria-label={done ? 'Le plat est servi' : 'Une marmite mijote sur le feu'}
    >
      <defs>
        <radialGradient id="er-fire-glow" cx="50%" cy="85%" r="60%">
          <stop offset="0%" stopColor={EMBER} stopOpacity="0.45" />
          <stop offset="55%" stopColor={EMBER} stopOpacity="0.08" />
          <stop offset="100%" stopColor={EMBER} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="er-serve-glow" cx="50%" cy="60%" r="55%">
          <stop offset="0%" stopColor={LIME} stopOpacity="0.28" />
          <stop offset="100%" stopColor={LIME} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* La lueur du feu, qui monte avec la chaleur */}
      <motion.rect
        width="320"
        height="190"
        fill="url(#er-fire-glow)"
        initial={false}
        animate={{ opacity: heat }}
        transition={{ duration: 0.8 }}
      />
      <motion.rect
        width="320"
        height="190"
        fill="url(#er-serve-glow)"
        initial={false}
        animate={{ opacity: done ? 1 : 0 }}
        transition={{ duration: 0.6 }}
      />

      {/* Pas d'`initial={false}` ici : il se propagerait à toutes les boucles
          de la scène, qui s'afficheraient figées sur leur dernière image. */}
      <AnimatePresence>
        {!done ? (
          <motion.g
            key="pot"
            exit={live ? { opacity: 0, y: 14 } : { opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Le brûleur et ses flammes, derrière la marmite */}
            <ellipse cx="160" cy={BURNER_Y} rx="52" ry="4" fill={INK} stroke={PAPER} strokeOpacity="0.25" />
            {[118, 139, 160, 181, 202].map((x, index) => (
              <g key={x} transform={`translate(${x} ${BURNER_Y})`}>
                <motion.g
                  initial={false}
                  animate={
                    heat > 0 && live
                      ? { scaleY: [heat, heat * 0.7, heat * 1.1, heat], scaleX: [1, 0.88, 1.06, 1] }
                      : { scaleY: heat, scaleX: 1 }
                  }
                  transition={{ duration: 0.45 + index * 0.08, repeat: heat > 0 ? loop : 0 }}
                  style={{ originX: 0.5, originY: 1 }}
                >
                  <path d="M0 0 C -11 -5 -10 -18 0 -29 C 10 -18 11 -5 0 0 Z" fill={EMBER} stroke={INK} strokeWidth="1.4" />
                  <path d="M0 -1 C -5 -4 -4.5 -10 0 -16 C 4.5 -10 5 -4 0 -1 Z" fill={FLAME_CORE} />
                </motion.g>
              </g>
            ))}

            {/* La marmite */}
            <image href={SPRITE('pot')} x={POT.x} y={POT.y} width={POT.width} height={POT.height} />

            {/* Les bulles de la sauce */}
            {cooking &&
              live &&
              [-22, -8, 6, 20].map((dx, index) => (
                <motion.circle
                  key={dx}
                  cx={MOUTH.x + dx}
                  cy={MOUTH.y}
                  r="3"
                  fill={EMBER}
                  stroke={INK}
                  strokeWidth="1"
                  // Transformées plutôt que `cy`/`r` : framer-motion lit mal la
                  // valeur de départ de ces attributs et envoie `undefined`.
                  animate={{ y: [1, -8], scale: [0.45, 1.2], opacity: [1, 0] }}
                  transition={{ duration: 1 - heat * 0.35, repeat: Infinity, delay: index * 0.27 }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                />
              ))}

            {/* Les ingrédients qui plongent, avec leur éclaboussure */}
            {cooking &&
              live &&
              DROPS.map(({ key, Shape, dx }, index) => (
                <g key={key}>
                  <motion.g
                    initial={{ x: MOUTH.x + dx, y: -20, opacity: 0 }}
                    animate={{
                      y: [-20, MOUTH.y - 4, MOUTH.y + 6],
                      rotate: [0, 200, 260],
                      scale: [1, 1, 0.55],
                      opacity: [1, 1, 0],
                    }}
                    transition={{
                      duration: DROP_DURATION,
                      times: [0, 0.82, 1],
                      ease: ['easeIn', 'linear'],
                      repeat: Infinity,
                      repeatDelay: period - DROP_DURATION,
                      delay: index * DROP_EVERY,
                    }}
                  >
                    <Shape />
                  </motion.g>
                  <motion.ellipse
                    cx={MOUTH.x + dx}
                    cy={MOUTH.y}
                    rx="14"
                    ry="3"
                    fill="none"
                    stroke={FLAME_CORE}
                    strokeWidth="1.6"
                    initial={{ opacity: 0 }}
                    animate={{ scale: [0.3, 0.3, 1.7], opacity: [0, 1, 0] }}
                    transition={{
                      duration: period,
                      times: [0, (DROP_DURATION * 0.82) / period, (DROP_DURATION + 0.35) / period],
                      repeat: Infinity,
                      delay: index * DROP_EVERY,
                    }}
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  />
                </g>
              ))}

            {/* Le couvercle : il frémit sur le feu, puis saute quand on cuisine */}
            <AnimatePresence>
              {!cooking && (
                <motion.g
                  key="lid"
                  exit={live ? { x: 70, y: -70, rotate: 35, opacity: 0 } : { opacity: 0 }}
                  transition={{ duration: 0.45, ease: 'easeOut' }}
                >
                  <motion.image
                    href={SPRITE('lid')}
                    x="108"
                    y="18"
                    width="104"
                    height="71"
                    animate={live ? { y: [18, 15, 18], rotate: [-1.5, 1.5, -1.5] } : { y: 18 }}
                    transition={{ duration: 0.4, repeat: loop }}
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  />
                </motion.g>
              )}
            </AnimatePresence>

            {/* La vapeur */}
            {heat > 0.4 &&
              live &&
              [138, 160, 182].map((x, index) => (
                <motion.path
                  key={x}
                  d={`M${x} 52 C ${x - 9} 42, ${x + 9} 32, ${x} 22 C ${x - 9} 12, ${x + 9} 2, ${x} -8`}
                  fill="none"
                  stroke={PAPER}
                  strokeWidth="3"
                  strokeLinecap="round"
                  animate={{ y: [10, -12], opacity: [0, 0.4 * heat, 0] }}
                  transition={{ duration: 2.6, repeat: Infinity, delay: index * 0.8, ease: 'easeOut' }}
                />
              ))}
          </motion.g>
        ) : (
          // ---- Le service : l'assiette arrive, la cloche se soulève ----
          <motion.g
            key="served"
            initial={live ? { opacity: 0, y: 24 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <image href={SPRITE('plate')} x="84" y="98" width="152" height="82" />
            <motion.image
              href={SPRITE('cloche')}
              x="102"
              y="36"
              width="116"
              height="95"
              initial={live ? { x: 0, y: 0, rotate: 0 } : false}
              animate={{ x: 58, y: -44, rotate: 20 }}
              transition={
                live
                  ? { delay: 0.55, type: 'spring', stiffness: 110, damping: 12 }
                  : { duration: 0 }
              }
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            />
            {live &&
              SPARKLES.map(([x, y], index) => (
                <motion.path
                  key={index}
                  d={`M${x} ${y - 8} L${x + 2} ${y - 2} L${x + 8} ${y} L${x + 2} ${y + 2} L${x} ${y + 8} L${x - 2} ${y + 2} L${x - 8} ${y} L${x - 2} ${y - 2} Z`}
                  fill={LIME}
                  stroke={INK}
                  strokeWidth="1"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: [0, 1.15, 0], opacity: [0, 1, 0] }}
                  transition={{ duration: 1.1, repeat: Infinity, delay: 0.8 + index * 0.22 }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                />
              ))}
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  );
}
