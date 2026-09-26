import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { IconPause, IconPlay } from './Icons';

/**
 * Lecteur de la vidéo d'origine, conservée avec la recette.
 *
 * Deux raisons de l'afficher plutôt que de renvoyer vers la publication :
 *  - une publication peut être supprimée, la recette la survit ;
 *  - certains gestes (aplatir, émincer à la mandoline, dresser) se
 *    comprennent mieux en trois secondes de vidéo qu'en trois lignes de
 *    texte — d'autant plus quand la recette a justement été reconstituée
 *    à partir de ces gestes.
 *
 * `preload="none"` est délibéré : la vidéo pèse quelques mégaoctets et la
 * plupart des consultations n'en ont pas besoin. Elle ne se charge qu'au
 * premier clic.
 *
 * La fiche peut aussi la piloter via `ref.seek()` : un clic sur l'image d'une
 * étape amène la vidéo à l'écran et la lance à l'instant du geste.
 */
export interface RecipeVideoHandle {
  seek(seconds: number): void;
}

export function RecipeVideo({
  src,
  poster,
  title,
  ref,
}: {
  src: string;
  poster: string | null;
  title: string;
  ref?: Ref<RecipeVideoHandle>;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      const video = videoRef.current;
      if (!video) return;

      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Avec `preload="none"`, rien n'est chargé : fixer l'instant suffit,
      // le navigateur ira le chercher au lancement de la lecture.
      video.currentTime = seconds;
      void video.play().catch(() => setFailed(true));
      setStarted(true);
    },
  }));

  function toggle() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().catch(() => setFailed(true));
      setStarted(true);
    } else {
      video.pause();
    }
  }

  if (failed) return null;

  return (
    <section ref={sectionRef} className="mt-9 scroll-mt-28">
      <h2 className="mb-3.5 border-b-[1.5px] border-rule-strong pb-3.5 text-[34px] leading-none tracking-[-0.03em]">
        La vidéo d'origine
      </h2>

      <div className="relative overflow-hidden rounded-card border-[1.5px] border-rule-strong bg-black">
        <video
          ref={videoRef}
          src={src}
          poster={poster ?? undefined}
          preload="none"
          playsInline
          controls={started}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
          aria-label={`Vidéo de la recette ${title}`}
          // Vidéo verticale de réseau social : on limite la hauteur pour
          // qu'elle ne mange pas tout l'écran sur mobile.
          className="max-h-[70vh] w-full bg-black object-contain"
        />

        {/* Bouton de lecture initial, tant que la vidéo n'a pas démarré. */}
        {!started && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Lire la vidéo"
            className="group absolute inset-0 grid place-items-center bg-black/25 transition-colors hover:bg-black/15"
          >
            {/* Le pavé pressable de l'édition plutôt que le rond blanc des
                lecteurs : c'est le même geste que « Mode cuisine ». Le relief
                répond au survol du cadre entier, qui est la vraie cible. */}
            <span className="inline-flex items-center gap-2.5 rounded-control border-[1.5px] border-rule-strong bg-ember px-6 py-3.5 font-mono text-[11px] font-medium tracking-[0.18em] text-ember-ink uppercase shadow-press transition-[transform,box-shadow] duration-200 group-hover:translate-x-[-1.5px] group-hover:translate-y-[-1.5px] group-hover:shadow-press-lift group-active:translate-x-0.5 group-active:translate-y-0.5 group-active:shadow-none">
              <IconPlay />
              Lire la vidéo
            </span>
          </button>
        )}
      </div>

      {started && (
        <button
          type="button"
          onClick={toggle}
          className="label-mono-sm mt-2.5 inline-flex items-center gap-1.5 text-ink-soft transition-colors hover:text-ember"
        >
          {playing ? <IconPause /> : <IconPlay />}
          {playing ? 'Mettre en pause' : 'Reprendre'}
        </button>
      )}
    </section>
  );
}
