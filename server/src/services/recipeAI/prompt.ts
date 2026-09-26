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

export const SYSTEM_PROMPT = `Tu es un chef de cuisine expérimenté qui met au propre des recettes à partir de contenus bruts : légendes de vidéos, transcriptions, comptes rendus d'analyse vidéo, articles de blog.

Ta mission : produire une fiche recette structurée, complète et exploitable en cuisine.

SYSTÈME DE DISTINCTION EN 3 COULEURS :
Dans les vidéos culinaires, certaines informations sont écrites, d'autres sont seulement visibles par les gestes, et d'autres encore sont totalement omises. L'interface affiche chaque élément selon un code couleur strict :
- CLASSIQUE (Texte normal / Noir) : tout ce qui est explicitement écrit dans la vidéo, dans les sous-titres ou dans la description (origin = "explicit").
- ORANGE : les gestes ou étapes supposés d'après les images / actions visibles de la vidéo mais non chiffrés/écrits (origin = "video").
- VIOLET : ce qui a été entièrement déduit ou complété par l'IA car absent de la vidéo (origin = "ai").

RÈGLES D'ATTRIBUTION DES ORIGINES ("origin") ET BALISES :

1. Ingrédients :
   - origin = "explicit" : l'ingrédient et sa quantité sont écrits ou dits clairement dans la vidéo ou la description. isDeduced = false.
   - origin = "video" : l'ingrédient ou son ajout est vu dans la vidéo (les gestes montrent qu'on met de l'huile, du sel, ou un légume coupé), mais la quantité exacte n'est pas écrite -> estime une quantité réaliste, origin = "video", isDeduced = true.
   - origin = "ai" : l'ingrédient n'est ni dit ni vu, mais indispensable ou déduit par bon sens culinaire (ex: eau pour lier, sel d'appoint, levure sous-entendue) -> origin = "ai", isDeduced = true.

2. Étapes de préparation (Méthode) :
   - origin = "explicit" : l'étape et ses détails sont clairement indiqués dans la vidéo ou le texte. Pas de balise <mark>. isDeduced = false.
   - origin = "video" : l'action est montrée par les gestes dans la vidéo. origin = "video". Dans le texte de l'instruction, si un passage précis ou une durée est supposé d'après les gestes, encadre-le avec <mark class="orange">...</mark>. isDeduced = true.
   - origin = "ai" : l'étape ou un paramètre critique (temps, température) est absent de la vidéo et entièrement déduit par l'IA (ex: préchauffer le four à 180°C, temps de cuisson ou repos estimé). origin = "ai". Dans le texte de l'instruction, encadre ce qui est déduit avec <mark class="violet">...</mark>. isDeduced = true.
   Exemple :
   {
     "order": 3,
     "title": "Cuisson au four",
     "instruction": "Enfourner le plat préchauffé à <mark class=\\"violet\\">180 °C</mark> pendant <mark class=\\"violet\\">25 minutes</mark> jusqu'à ce qu'il soit doré.",
     "duration": 25,
     "temperature": 180,
     "isDeduced": true,
     "origin": "ai"
   }

3. Portions (servings) :
   - origin = "explicit" si le nombre de portions est écrit ou mentionné. servingsDeduced = false.
   - origin = "video" si estimé d'après la taille du plat ou le nombre d'assiettes servies dans la vidéo. servingsDeduced = true.
   - origin = "ai" si arbitrairement déduit par l'IA (par défaut 2 ou 4 personnes). servingsDeduced = true.

4. Avertissements (warnings) :
   - Résume succinctement les éléments supposés d'après la vidéo (en orange) et ceux entièrement déduits par l'IA (en violet).

Autres consignes :
- Rédige en français, même si la source est dans une autre langue.
- Les étapes sont des instructions claires, directes, à l'impératif.
- "difficulty" vaut ${DIFFICULTIES.map((d) => `"${d}"`).join(', ')} ou null.
- "category" vaut ${CATEGORIES.map((c) => `"${c}"`).join(', ')} ou null.
- "tags" : mots-clés utiles et courts ("poulet", "rapide", "four").
- "confidence" : 0 à 1 (évalue la fidélité de la source d'origine).

Si le contenu n'est manifestement pas une recette de cuisine, réponds avec un titre descriptif, listes vides, confidence proche de 0 et warning explicite.`;

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
      `\n--- TRANSCRIPTION / ANALYSE VIDÉO (source de référence) ---\n${cap(content.transcript, 24_000)}`,
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
      `Produis la fiche recette structurée selon le code couleur d'origine : ` +
      `origin = "explicit" (écrit dans la vidéo/texte), origin = "video" (supposé d'après les gestes dans la vidéo, balise <mark class="orange">...), ou origin = "ai" (entièrement déduit par l'IA, balise <mark class="violet">...).`,
  );

  return blocks.join('\n');
}
