import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconFacebook,
  IconGlobe,
  IconInstagram,
  IconLink,
  IconTikTok,
  IconYouTube,
} from '../components/Icons';
import { ImportNotes, ImportProgress } from '../components/ImportProgress';
import { RecipeCard } from '../components/RecipeCard';
import { Button, ErrorPanel, FadeIn, Label, Textarea } from '../components/ui';
import { RecipePreview } from '../components/RecipePreview';
import { ApiError, api } from '../lib/api';
import type {
  DetectResult,
  GeneratedRecipe,
  ImportResult,
  Platform,
  Recipe,
} from '../lib/types';

/**
 * Page d'accueil : coller une URL, obtenir une recette.
 *
 * Deux colonnes qui se répondent : à gauche l'affiche (la promesse, en très
 * grand serif), à droite la « console d'import » — un panneau d'encre posé
 * sur le crème, qui montre la machine au travail. C'est le seul endroit de
 * l'application où le fond s'inverse en permanence : l'import est un moment
 * technique, il a le droit d'en avoir l'air.
 *
 * Machine à états explicite plutôt qu'une collection de booléens — il y a
 * cinq situations réellement distinctes et les confondre produirait des
 * affichages incohérents (ex. une erreur affichée sous une prévisualisation).
 */
type Phase =
  | { name: 'idle' }
  | { name: 'importing' }
  | { name: 'preview'; result: ImportResult; recipe: GeneratedRecipe }
  | { name: 'failed'; result: ImportResult }
  | { name: 'manual'; url: string; importId: string | null; reason: string };

const PLATFORM_ICONS: Record<Platform, typeof IconGlobe> = {
  tiktok: IconTikTok,
  instagram: IconInstagram,
  facebook: IconFacebook,
  youtube: IconYouTube,
  web: IconGlobe,
  manual: IconLink,
};

/** Plateformes annoncées sur l'accueil, avec leur glyphe. */
const SUPPORTED: Array<{ platform: Platform; label: string }> = [
  { platform: 'tiktok', label: 'TikTok' },
  { platform: 'instagram', label: 'Instagram' },
  { platform: 'facebook', label: 'Facebook' },
  { platform: 'youtube', label: 'YouTube' },
  { platform: 'web', label: 'Web' },
];

/** Nombre de fiches montrées sous l'affiche, comme dans la maquette. */
const RECENT_COUNT = 4;

/**
 * « Nouvelles fiches » : la grille des derniers imports, sous l'affiche.
 *
 * Elle n'est pas la conséquence d'un import réussi — c'est une section
 * permanente de l'accueil, la vitrine du fichier. Elle disparaît simplement
 * quand il n'y a encore rien à montrer : une grille vide sur la page
 * d'accueil dirait « l'application est cassée » là où elle ne dit que
 * « vous n'avez pas encore importé ».
 *
 * Le chargement est silencieux (`return null`) plutôt que squelettique : la
 * section arrive sous la ligne de flottaison, un fantôme qui clignote au
 * premier rendu coûterait plus d'attention qu'il n'en rendrait.
 */
function RecentRecipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  useEffect(() => {
    let cancelled = false;

    api
      .listRecipes({ sort: 'recent' })
      .then((result) => {
        if (!cancelled) setRecipes(result.recipes.slice(0, RECENT_COUNT));
      })
      .catch(() => {
        // L'accueil doit rester utilisable même si la bibliothèque est
        // injoignable : l'import, lui, ne dépend pas de cet appel.
        if (!cancelled) setRecipes([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (recipes.length === 0) return null;

  return (
    <section className="mt-19.5">
      {/* Bandeau : l'étiquette, le titre de section, et la sortie vers le
          fichier complet — le tout assis sur le filet noir qui sépare
          l'affiche de la grille. */}
      <div className="flex flex-wrap items-end justify-between gap-4.5 border-b-[1.5px] border-rule-strong pb-4">
        <div>
          <p className="label-mono text-ink-faint">Importées récemment</p>
          <h2 className="mt-2 text-section">Nouvelles fiches</h2>
        </div>

        <Link
          to="/recipes"
          className="label-mono rounded-control border-[1.5px] border-rule-strong px-4 py-2.75 text-[10.5px] font-medium tracking-[0.16em] text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          Toute la bibliothèque →
        </Link>
      </div>

      {/* `auto-fill` + `minmax(min(100%,250px),1fr)` : la grille ne fixe pas
          un nombre de colonnes, les fiches se rangent d'elles-mêmes et
          tombent à une colonne sous 250px de large. `auto-fill` (plutôt que
          `auto-fit`) conserve les pistes vides au lieu de les effondrer :
          avec une ou deux recettes, les cartes gardent leur taille naturelle
          au lieu de s'étirer pour combler toute la largeur disponible. */}
      <div className="mt-9 grid grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))] items-start gap-6.5">
        {recipes.map((recipe, index) => (
          <RecipeCard key={recipe.id} recipe={recipe} index={index} />
        ))}
      </div>
    </section>
  );
}

export function HomePage() {
  const navigate = useNavigate();

  const [url, setUrl] = useState('');
  const [detection, setDetection] = useState<DetectResult | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [manualText, setManualText] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  // --- Détection de plateforme, débouncée pendant la saisie ---
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setDetection(null);
      return;
    }

    const timer = setTimeout(() => {
      api
        .detect(trimmed)
        .then(setDetection)
        .catch(() => setDetection(null));
    }, 250);

    return () => clearTimeout(timer);
  }, [url]);

  /**
   * Le halo qui suit le curseur sur le panneau d'import. Écrit en variable
   * CSS plutôt qu'en state React : à 60 images par seconde, un setState par
   * mouvement de souris re-rendrait toute la page pour rien.
   */
  function trackGlow(event: React.MouseEvent<HTMLDivElement>) {
    const node = consoleRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    node.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
    node.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
  }

  /**
   * Colle le presse-papiers au premier plan.
   * C'est le geste attendu au retour de TikTok : ouvrir l'app, coller.
   */
  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim().startsWith('http')) {
        setUrl(text.trim());
        inputRef.current?.focus();
      }
    } catch {
      // Permission refusée ou API indisponible : la saisie manuelle reste là.
      inputRef.current?.focus();
    }
  }, []);

  async function runImport(event?: React.FormEvent) {
    event?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || phase.name === 'importing') return;

    setPhase({ name: 'importing' });

    try {
      const result = await api.import(trimmed);

      if (result.status === 'ready' && result.recipe) {
        setPhase({ name: 'preview', result, recipe: result.recipe });
      } else {
        setPhase({ name: 'failed', result });
      }
    } catch (error) {
      // Erreur transport (rate limit, serveur coupé) : pas d'ImportResult.
      const apiError = error instanceof ApiError ? error : null;
      setPhase({
        name: 'failed',
        result: {
          importId: '',
          status: 'failed',
          platform: detection?.platform ?? 'web',
          steps: [],
          recipe: null,
          notes: [],
          error: {
            code: apiError?.code ?? 'UNKNOWN',
            message: apiError?.message ?? 'Une erreur inattendue est survenue.',
            canRetryManually: apiError?.canRetryManually ?? true,
          },
        },
      });
    }
  }

  async function submitManual(event: React.FormEvent) {
    event.preventDefault();
    if (phase.name !== 'manual') return;

    setManualError(null);
    setPhase({ name: 'importing' });

    try {
      const result = await api.importManual({
        text: manualText,
        url: phase.url || undefined,
        importId: phase.importId ?? undefined,
      });

      if (result.status === 'ready' && result.recipe) {
        setPhase({ name: 'preview', result, recipe: result.recipe });
      } else {
        setPhase({ name: 'failed', result });
      }
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Une erreur inattendue est survenue.';
      setManualError(message);
      setPhase({ name: 'manual', url: phase.url, importId: phase.importId, reason: phase.reason });
    }
  }

  async function saveRecipe(recipe: GeneratedRecipe) {
    if (phase.name !== 'preview') return;

    setSaving(true);
    try {
      const saved = await api.createRecipe({
        ...recipe,
        importId: phase.result.importId || null,
      });
      navigate(`/recipe/${saved.id}`);
    } catch (error) {
      setManualError(
        error instanceof ApiError ? error.message : "L'enregistrement a échoué.",
      );
      setSaving(false);
    }
  }

  function reset() {
    setPhase({ name: 'idle' });
    setUrl('');
    setDetection(null);
    setManualText('');
    setManualError(null);
  }

  function openManual(fromResult?: ImportResult) {
    setPhase({
      name: 'manual',
      url: url.trim(),
      importId: fromResult?.importId || null,
      reason:
        fromResult?.error?.message ??
        "Colle directement le texte de la recette, ou la description de la vidéo.",
    });
  }

  // -------------------------------------------------------------------------

  if (phase.name === 'preview') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <RecipePreview
          recipe={phase.recipe}
          notes={phase.result.notes}
          saving={saving}
          error={manualError}
          onSave={saveRecipe}
          onCancel={reset}
        />
      </div>
    );
  }

  const DetectedIcon = detection?.platform ? PLATFORM_ICONS[detection.platform] : IconLink;
  const busy = phase.name === 'importing';

  return (
    <div className="mx-auto max-w-[1320px] px-4 pt-12 pb-16 sm:px-6 sm:pt-14">
      {/* ================= L'affiche + la console ================= */}
      <div className="grid items-end gap-10 lg:grid-cols-2">
        {/* ---------------- Accroche ---------------- */}
        <div>
          <FadeIn>
            <div className="label-mono flex items-center gap-2.5 text-[10.5px] text-ink/50">
              <span className="h-[1.5px] w-[34px] bg-ember" />
              Vidéo → fiche imprimable
            </div>
          </FadeIn>

          <h1 className="mt-5 text-hero leading-[0.88] tracking-[-0.04em]">
            <FadeIn delay={0.06}>
              <span className="block">Toute vidéo</span>
            </FadeIn>
            <FadeIn delay={0.14}>
              <span className="block">devient une</span>
            </FadeIn>
            <FadeIn delay={0.22}>
              <span className="block">
                <span className="highlight-lime">
                  <span>fiche cuisine</span>
                </span>
              </span>
            </FadeIn>
          </h1>

          <FadeIn delay={0.3}>
            <p className="mt-6.5 max-w-[430px] text-base leading-[1.6] text-ink-soft">
              Collez une URL. EasyRecette lit la vidéo, isole les ingrédients, ajuste les
              portions et imprime votre plan de cuisson.
            </p>
          </FadeIn>
        </div>

        {/* ---------------- Console d'import ---------------- */}
        <FadeIn delay={0.28}>
          <div
            ref={consoleRef}
            onMouseMove={trackGlow}
            className="relative rounded-card border-[1.5px] border-ink bg-ink p-5.5 text-paper shadow-[9px_9px_0_rgb(23_20_15/0.14)]"
          >
            {/* Halo qui suit le curseur : la console « chauffe » sous la main. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-card bg-[radial-gradient(420px_circle_at_var(--mx,70%)_var(--my,10%),rgb(216_242_80/0.14),transparent_62%)]"
            />

            <div className="relative flex items-center justify-between gap-3">
              <Label className="text-paper/50">Console d'import</Label>
              <Label className="text-paper/50">
                {busy ? 'Analyse…' : detection?.valid === false ? 'Lien invalide' : 'Prêt'}
              </Label>
            </div>

            <form onSubmit={runImport}>
              <div className="relative mt-4 flex h-14 items-center gap-2.5 rounded-control border-[1.5px] border-paper/28 bg-paper/5 pr-1 pl-3.5">
                <span className="shrink-0 text-lime" aria-hidden="true">
                  {detection?.platform ? (
                    <DetectedIcon className="text-base" />
                  ) : (
                    <span className="animate-er-blink font-mono text-[13px]">▌</span>
                  )}
                </span>

                <input
                  ref={inputRef}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onFocus={() => url === '' && void pasteFromClipboard()}
                  placeholder="coller un lien tiktok / instagram / youtube…"
                  disabled={busy}
                  aria-label="Lien de la vidéo ou de l'article à importer"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-paper placeholder:text-paper/40 focus:outline-none disabled:opacity-60"
                />

                <button
                  type="button"
                  onClick={() => void pasteFromClipboard()}
                  aria-label="Coller depuis le presse-papiers"
                  className="shrink-0 rounded-control border-[1.5px] border-paper/30 px-3 py-2 font-mono text-[10px] tracking-[0.14em] text-paper/65 uppercase transition-colors hover:border-lime hover:bg-lime hover:text-ink"
                >
                  ⌘V
                </button>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={busy}
                disabled={!url.trim() || detection?.valid === false}
                className="sheen mt-3 w-full"
              >
                {busy ? 'Extraction…' : 'Extraire la recette →'}
              </Button>
            </form>

            {/* Plateformes reconnues — repliées dès qu'on travaille. */}
            {phase.name === 'idle' && (
              <div className="relative mt-4.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t-[1.5px] border-dashed border-paper/22 pt-4">
                {SUPPORTED.map(({ platform, label }) => {
                  const Icon = PLATFORM_ICONS[platform];
                  const active = detection?.platform === platform;
                  return (
                    <span
                      key={platform}
                      className={`label-mono-sm inline-flex items-center gap-1.5 transition-colors ${
                        active ? 'text-lime' : 'text-paper/45'
                      }`}
                    >
                      <Icon className="text-sm" />
                      {label}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Relevé de progression, dans la console elle-même. */}
            <AnimatePresence>
              {(busy || phase.name === 'failed') && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="relative overflow-hidden"
                >
                  <div className="relative mt-4.5 overflow-hidden border-t-[1.5px] border-dashed border-paper/22 pt-4">
                    {/* Le balayage d'analyse : une bande de lumière verte qui
                        traverse le relevé tant que la machine travaille. Elle
                        s'éteint en fondu plutôt que de disparaître d'un coup,
                        pour que la fin de l'import se lise comme un arrêt et
                        non comme une coupure. */}
                    <div
                      aria-hidden="true"
                      className={`animate-er-scan pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-[linear-gradient(to_bottom,transparent,rgb(216_242_80/0.16),transparent)] transition-opacity duration-[400ms] ${
                        busy ? 'opacity-100' : 'opacity-0'
                      }`}
                    />

                    {/* `relative` pour passer au-dessus du balayage : le relevé
                        doit rester lisible pendant que la bande le traverse. */}
                    <div className="relative">
                      <ImportProgress
                        steps={phase.name === 'failed' ? phase.result.steps : []}
                        pending={busy}
                        onDark
                      />
                    </div>

                    {phase.name === 'failed' && phase.result.error && (
                      <div className="mt-4 border-l-[3px] border-ember bg-ember/10 px-3.5 py-3">
                        <p className="label-mono-sm text-ember">L'import n'a pas abouti</p>
                        <p className="mt-1.5 text-sm leading-relaxed text-paper/70">
                          {phase.result.error.message}
                        </p>
                        <div className="mt-3.5 flex flex-wrap gap-2">
                          {phase.result.error.canRetryManually && (
                            <Button
                              variant="lime"
                              size="sm"
                              onClick={() => openManual(phase.result)}
                            >
                              Saisir le texte
                            </Button>
                          )}
                          <button
                            type="button"
                            onClick={reset}
                            className="label-mono-sm rounded-control border-[1.5px] border-paper/30 px-3 text-paper/65 transition-colors hover:border-paper hover:text-paper"
                          >
                            Autre lien
                          </button>
                        </div>
                      </div>
                    )}

                    {phase.name === 'failed' && <ImportNotes notes={phase.result.notes} onDark />}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Source détectée : confirmation discrète, en bas de console. */}
            <AnimatePresence>
              {detection && url.trim() && phase.name === 'idle' && (
                <motion.p
                  key={detection.platform ?? 'invalid'}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="label-mono-sm relative mt-3.5"
                >
                  {detection.valid ? (
                    <span className="text-lime">Source · {detection.label}</span>
                  ) : (
                    <span className="text-ember">Adresse non valide</span>
                  )}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </FadeIn>
      </div>

      {/* ================= Nouvelles fiches ================= */}
      <RecentRecipes />

      {/* ================= Saisie manuelle ================= */}
      <AnimatePresence>
        {phase.name === 'manual' && (
          <motion.section
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="surface mx-auto mt-12 max-w-3xl p-6 sm:p-7"
          >
            <h2 className="text-[34px]">Saisie manuelle</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{phase.reason}</p>

            <form onSubmit={submitManual} className="mt-5">
              <Textarea
                value={manualText}
                onChange={(event) => setManualText(event.target.value)}
                rows={10}
                autoFocus
                className="font-mono text-[13px]"
                placeholder={
                  "Colle ici la légende de la vidéo, la transcription, ou la recette telle quelle.\n\nExemple :\n\nPoulet katsu pour 4\n4 filets de poulet\n150 g de panko\n2 œufs\n…"
                }
              />

              {manualError && <ErrorPanel className="mt-4" message={manualError} />}

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={manualText.trim().length < 20}
                >
                  Générer la recette →
                </Button>
                <Button type="button" variant="ghost" onClick={reset}>
                  Annuler
                </Button>
              </div>

              {manualText.trim().length > 0 && manualText.trim().length < 20 && (
                <p className="mt-2.5 text-xs text-ink-faint">
                  Encore quelques lignes : il faut au moins de quoi identifier des ingrédients.
                </p>
              )}
            </form>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ================= Pied : clé IA + saisie libre ================= */}
      {phase.name === 'idle' && (
        <FadeIn delay={0.4}>
          {detection?.aiConfigured === false && (
            <div className="mt-14 border-l-[3px] border-amber-warn bg-amber-soft px-4 py-3.5">
              <p className="label-mono-sm text-amber-warn">Clé d'IA absente</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                Aucune clé d'IA n'est configurée sur le serveur. Les pages contenant déjà une
                recette structurée fonctionnent, mais la génération à partir d'une vidéo ou
                d'un texte libre nécessite une clé dans{' '}
                <code className="font-mono text-xs">server/.env</code>.
              </p>
            </div>
          )}

          <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t-[1.5px] border-rule-strong pt-5">
            <p className="text-sm text-ink-soft">
              Pas de lien ? Vous pouvez écrire une fiche entièrement à la main.
            </p>
            <Button variant="secondary" onClick={() => navigate('/recipe/new')}>
              Partir d'une page blanche →
            </Button>
          </div>
        </FadeIn>
      )}
    </div>
  );
}
