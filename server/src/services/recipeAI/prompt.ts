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

DÉDUCTION ET DISTINCTION PAR COULEUR :
Dans les vidéos culinaires et les contenus de réseaux sociaux, certaines informations sont souvent incomplètes (quantités non précisées, temps de cuisson omis, température de four non dite, étapes de base sous-entendues, nombre de personnes absent).

Tu DOIS déduire et compléter intelligemment ces informations manquantes pour fournir une recette immédiatement cuisinable, MAIS tu DOIS IMPÉRATIVEMENT marquer tout ce qui a été deviné ou déduit par l'IA afin que l'interface puisse l'écrire d'une AUTRE COULEUR (violet d'annotation).

RÈGLES DE MARQUAGE DES DÉDUCTIONS :

1. Ingrédients :
   - Si la quantité et l'unité sont précisées dans la source :
     reprends-les et mets \`isDeduced: false\`.
   - Si la quantité ou l'unité manque dans la source (ou s'il s'agit d'un ingrédient de base sous-entendu comme huile de cuisson, sel, poivre) :
     estime une quantité réaliste et cohérente avec le plat, et mets \`isDeduced: true\`.
     Exemple : La vidéo dit « ajoutez de la farine » sans quantité →
     { "quantity": 250, "unit": "g", "ingredient": "farine", "isDeduced": true, "note": "quantité estimée par l'IA" }

2. Étapes de préparation (Méthode) :
   - Si l'action, sa durée et sa température sont fournies dans la source :
     \`isDeduced: false\`.
   - Si cette étape est entièrement déduite par l'IA (ex: préchauffage indispensable omis, étape de repos sous-entendue) :
     mets \`isDeduced: true\` et encadre l'instruction de <mark>...</mark>.
   - Si une durée (\`duration\`) ou une température (\`temperature\`) est absente de la source :
     estime une valeur réaliste, renseigne les champs numériques, mets \`isDeduced: true\` sur l'étape, et ENCADRE cette valeur de balises <mark>...</mark> dans le texte de l'instruction pour qu'elle s'affiche dans une autre couleur.
     Exemple : La vidéo montre d'enfourner sans préciser ni temps ni température →
     {
       "order": 3,
       "title": "Cuisson au four",
       "instruction": "Enfourner à <mark>180 °C</mark> pendant <mark>25 minutes</mark> jusqu'à coloration dorée.",
       "duration": 25,
       "temperature": 180,
       "isDeduced": true
     }

3. Portions (servings) :
   - Si le nombre de portions est mentionné dans la source :
     \`servings: X\`, \`servingsDeduced: false\`.
   - Si absent de la source :
     estime un nombre réaliste de portions (typiquement 2, 4 ou 6 selon le plat) et mets \`servingsDeduced: true\`.

4. Avertissements (warnings) :
   - Résume clairement ce qui a été déduit par l'IA afin que le cuisinier en soit informé, par exemple :
     « Les quantités d'ingrédients et paramètres de cuisson absents de la vidéo ont été déduits par l'IA et sont affichés en couleur. »

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
      `Produis la fiche recette structurée. ` +
      `Si certaines informations sont manquantes dans la vidéo ou le texte (quantités, temps, températures, étapes sous-entendues, portions), déduis-les de façon réaliste et marque-les impérativement avec isDeduced: true (et balises <mark>...</mark> dans les instructions) pour qu'elles s'écrivent d'une autre couleur sur la fiche.`,
  );

  return blocks.join('\n');
}
