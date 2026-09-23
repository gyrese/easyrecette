import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minuteur de cuisine.
 *
 * Deux exigences qui écartent le `setInterval` naïf :
 *
 *  1. Le décompte doit rester juste même quand l'onglet passe en arrière-plan.
 *     Les navigateurs bridant les timers des onglets inactifs, on ne compte
 *     pas les ticks : on mémorise l'heure de fin et on la compare à l'horloge
 *     à chaque rendu. Un onglet endormi 3 minutes retrouve l'heure exacte.
 *
 *  2. L'alarme doit se faire entendre les mains dans la farine : bip audio via
 *     l'API Web Audio (pas de fichier à charger) plus vibration sur mobile.
 */

export type TimerState = 'idle' | 'running' | 'paused' | 'done';

export interface TimerOptions {
  /**
   * Coupe l'alarme de fin — bips ET vibration.
   *
   * Le réglage vit ici et non chez l'appelant parce que c'est le hook qui
   * possède l'alarme : il déclenche `playAlarm()` depuis un `tick`, hors de
   * tout rendu, là où l'appelant n'a aucune prise.
   */
  muted?: boolean;
}

export interface Timer {
  state: TimerState;
  /** Secondes restantes, toujours à jour. */
  remaining: number;
  /** 0 → 1, pour l'anneau de progression. */
  progress: number;
  start: (seconds?: number) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
}

export function useTimer(initialSeconds: number, options: TimerOptions = {}): Timer {
  const [state, setState] = useState<TimerState>('idle');
  const [remaining, setRemaining] = useState(initialSeconds);
  const [total, setTotal] = useState(initialSeconds);

  /** Timestamp absolu de fin ; c'est la seule source de vérité. */
  const endAtRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  /*
   * Le muet passe par une ref : `tick` se déclenche depuis une frame, hors
   * cycle de rendu, et doit rester stable pour ne pas relancer la boucle
   * d'animation à chaque bascule du bouton.
   */
  const mutedRef = useRef(options.muted ?? false);
  mutedRef.current = options.muted ?? false;

  // La durée par défaut change quand on passe à une autre étape.
  useEffect(() => {
    setTotal(initialSeconds);
    setRemaining(initialSeconds);
    setState('idle');
    endAtRef.current = null;
  }, [initialSeconds]);

  const tick = useCallback(() => {
    if (endAtRef.current === null) return;

    const left = Math.max(0, (endAtRef.current - Date.now()) / 1000);
    setRemaining(left);

    if (left <= 0) {
      setState('done');
      endAtRef.current = null;
      if (!mutedRef.current) void playAlarm();
      return;
    }

    frameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (state === 'running') {
      frameRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [state, tick]);

  /**
   * requestAnimationFrame est suspendu quand l'onglet est caché. Au retour,
   * on resynchronise immédiatement plutôt que d'attendre la prochaine frame.
   */
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && endAtRef.current !== null) {
        const left = Math.max(0, (endAtRef.current - Date.now()) / 1000);
        setRemaining(left);
        if (left <= 0) {
          setState('done');
          endAtRef.current = null;
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const start = useCallback(
    (seconds?: number) => {
      const duration = seconds ?? total;
      if (duration <= 0) return;
      setTotal(duration);
      setRemaining(duration);
      endAtRef.current = Date.now() + duration * 1000;
      setState('running');
    },
    [total],
  );

  const pause = useCallback(() => {
    if (endAtRef.current === null) return;
    setRemaining(Math.max(0, (endAtRef.current - Date.now()) / 1000));
    endAtRef.current = null;
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    if (remaining <= 0) return;
    endAtRef.current = Date.now() + remaining * 1000;
    setState('running');
  }, [remaining]);

  const reset = useCallback(() => {
    endAtRef.current = null;
    setRemaining(total);
    setState('idle');
  }, [total]);

  return {
    state,
    remaining: Math.ceil(remaining),
    progress: total > 0 ? 1 - remaining / total : 0,
    start,
    pause,
    resume,
    reset,
  };
}

/**
 * Alarme : trois bips synthétisés + vibration.
 *
 * Web Audio plutôt qu'un <audio src> : aucun fichier à embarquer, et le son
 * part instantanément. Les navigateurs exigent un geste utilisateur préalable
 * pour débloquer l'audio — c'est le cas ici puisque l'utilisateur a appuyé
 * sur « Lancer le minuteur ».
 */
async function playAlarm(): Promise<void> {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    const context = new AudioCtor();
    if (context.state === 'suspended') await context.resume();

    const now = context.currentTime;

    for (let i = 0; i < 3; i += 1) {
      const at = now + i * 0.42;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, at);

      // Enveloppe douce : un créneau brut « claque » désagréablement.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.28, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.32);
    }

    // Libère le contexte une fois la séquence jouée.
    setTimeout(() => void context.close(), 2000);
  } catch {
    // Audio indisponible : la vibration et l'affichage suffisent.
  }

  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }
}
