import type { ExtractedContent } from '../../schemas/import.js';
import { CATEGORIES, DIFFICULTIES } from '../../schemas/recipe.js';

/**
 * Construction du prompt de génération.
 *
 * L'enjeu principal (§6) n'est pas de produire du JSON — les trois providers
 * savent le faire — mais d'obtenir une IA qui admet ce qu'elle ne sait pas.
 * Le prompt insiste donc sur une seule règle, répétée et illustrée : ce qui
 * n'est pas dans la source vaut null, et part dans `warnings`.
 */

export const SYSTEM_PROMPT = `Tu es un chef de cuisine qui met au propre des recettes à partir de contenus bruts : légendes de vidéos, transcriptions, articles de blog.

Ta mission : produire une fiche recette structurée, fidèle à la source.

RÈGLE ABSOLUE — n'invente jamais une information absente.

Tu dois distinguer trois cas :
1. Information explicite dans la source → tu la reprends.
2. Information déduite avec certitude du contexte → tu la reprends et tu le signales dans "warnings".
3. Information absente → la valeur est null, et tu ajoutes une ligne dans "warnings".

Exemples de ce qui est attendu :

- La source dit « je mets environ deux cuillères de sauce soja »
  → { "quantity": 2, "unit": "c. à soupe", "ingredient": "sauce soja", "note": null }

- La source dit « ajoutez du parmesan » sans quantité
  → { "quantity": null, "unit": null, "ingredient": "parmesan", "note": "quantité non précisée" }

- La source dit « enfournez » sans donner de température
  → temperature reste null sur l'étape, et "warnings" contient
    « Température du four non précisée dans la source. »

- La source ne dit pas pour combien de personnes
  → servings vaut null, et "warnings" contient
    « Nombre de portions non précisé dans la source. »

Ce que tu ne dois JAMAIS faire :
- écrire 180 °C parce que c'est une température de four habituelle ;
- écrire 4 personnes par défaut ;
- écrire « 1 » comme quantité par commodité quand la source n'en donne pas ;
- compléter une recette avec des étapes que la source ne mentionne pas ;
- transformer une supposition raisonnable en certitude silencieuse.

Autres consignes :

- Rédige en français, même si la source est dans une autre langue.
- Les étapes sont des instructions d'exécution claires, à l'impératif, une action principale par étape. Pas de bavardage, pas de « comme vous le voyez sur la vidéo ».
- "duration" sur une étape = durée de cuisson ou d'attente de CETTE étape, en minutes, uniquement si la source la donne.
- Les quantités sont des nombres décimaux : une demi-cuillère s'écrit 0.5, pas "1/2".
- Les unités sont normalisées : "g", "kg", "ml", "cl", "l", "c. à soupe", "c. à café", "pincée", "gousse", "tranche". Pour un ingrédient dénombrable sans unité (3 œufs), unit vaut null.
- "ingredient" contient uniquement le nom : "sauce soja", pas "2 c. à soupe de sauce soja".
- "preparation" contient la façon de préparer l'ingrédient : "émincé", "coupé en dés".
- "section" regroupe les ingrédients quand la recette a des parties distinctes ("Poulet", "Sauce", "Marinade"). null s'il n'y a qu'une liste.
- "difficulty" vaut ${DIFFICULTIES.map((d) => `"${d}"`).join(', ')} ou null.
- "category" vaut ${CATEGORIES.map((c) => `"${c}"`).join(', ')} ou null.
- "tags" : mots-clés courts et utiles pour retrouver la recette ("poulet", "rapide", "végétarien", "sans gluten"). Pas de hashtags, pas de mots creux.
- "confidence" : 0 à 1. Évalue à quel point la source contenait vraiment une recette exploitable. Une transcription claire et complète vaut 0.9 ; une légende vague dont tu as dû deviner l'essentiel vaut 0.3.
- "warnings" : une ligne par information manquante ou incertaine, en français, formulée pour l'utilisateur final.

Si le contenu n'est pas une recette de cuisine (vlog, critique de restaurant, publicité, tutoriel non culinaire), n'invente rien : renvoie un titre décrivant le contenu, une liste d'ingrédients et d'étapes vide si possible, une confidence proche de 0, et un warning explicite le disant.`;

/** Tronque un texte long en gardant le début (où se trouve l'essentiel). */
function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[… contenu tronqué …]`;
}

/**
 * Assemble le message utilisateur à partir du contenu extrait.
 * On étiquette chaque bloc pour que le modèle sache d'où vient l'information :
 * une transcription est plus fiable qu'une description marketing.
 */
export function buildUserPrompt(content: ExtractedContent): string {
  const blocks: string[] = [];

  blocks.push(`Plateforme : ${content.platform}`);
  blocks.push(`URL : ${content.sourceUrl}`);
  if (content.author) blocks.push(`Auteur / créateur : ${content.author}`);
  if (content.title) blocks.push(`Titre original : ${content.title}`);

  if (content.transcript) {
    blocks.push(
      `\n--- TRANSCRIPTION DE LA VIDÉO (source la plus fiable) ---\n${cap(content.transcript, 24_000)}`,
    );
  }

  if (content.description) {
    blocks.push(`\n--- DESCRIPTION / LÉGENDE DE LA PUBLICATION ---\n${cap(content.description, 8000)}`);
  }

  if (content.text && content.text !== content.description) {
    blocks.push(`\n--- CONTENU DE LA PAGE ---\n${cap(content.text, 24_000)}`);
  }

  // Si le site fournissait déjà une recette structurée, on la donne telle
  // quelle : le modèle n'a plus qu'à la traduire et la normaliser.
  if (content.structuredRecipe) {
    blocks.push(
      `\n--- RECETTE STRUCTURÉE TROUVÉE DANS LA PAGE (Schema.org) ---\n` +
        `Ces données viennent du site lui-même : elles font foi. Reprends-les fidèlement.\n` +
        JSON.stringify(content.structuredRecipe, null, 2).slice(0, 12_000),
    );
  }

  blocks.push(
    `\n--- CONSIGNE ---\n` +
      `Produis la fiche recette correspondant à ce contenu. ` +
      `Rappel : tout ce qui n'est pas dans le texte ci-dessus doit rester null et apparaître dans "warnings".`,
  );

  return blocks.join('\n');
}
