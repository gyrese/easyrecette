/**
 * File unique des traitements média faits en tâche de fond : images des
 * étapes, conversion en WebP, recompression des vidéos.
 *
 * Une seule tâche à la fois, toutes sortes confondues : ffmpeg et les envois
 * de vidéo à Gemini sont gourmands, et un petit VPS n'a pas à en lancer
 * plusieurs de front parce qu'on a importé trois recettes d'affilée ou que
 * le démarrage reprend d'anciennes fiches.
 *
 * Une tâche porte une clé : la même clé mise en file deux fois ne tourne
 * qu'une fois. L'ordre d'arrivée est respecté, ce qui permet d'enchaîner
 * « images des étapes » puis « recompression » sur la même vidéo.
 */

const queue: { key: string; task: () => Promise<void> }[] = [];
let running = false;

export function enqueueMediaTask(key: string, task: () => Promise<void>): void {
  if (queue.some((item) => item.key === key)) return;
  queue.push({ key, task });
  void drain();
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const { key, task } = queue.shift()!;
      try {
        await task();
      } catch (error) {
        console.warn(`[media] tâche ${key} en échec :`, error);
      }
    }
  } finally {
    running = false;
  }
}
