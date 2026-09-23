import { normalizeUnit } from '../../utils/units.js';

/**
 * Découpe une ligne d'ingrédient en (quantité, unité, nom, préparation).
 *
 * Sert uniquement au chemin Schema.org : les sites listent leurs ingrédients
 * sous forme de texte libre ("2 c. à soupe de sauce soja, réduite en sel").
 * Le chemin IA, lui, reçoit déjà les champs séparés.
 *
 * Principe identique au reste : ce qui n'est pas lisible reste null, avec une
 * note. On ne devine jamais une quantité.
 */

export interface ParsedIngredientLine {
  quantity: number | null;
  unit: string | null;
  ingredient: string;
  preparation: string | null;
  note: string | null;
}

/** Fractions unicode et écrites, telles qu'on les trouve sur les sites. */
const FRACTION_MAP: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅕': 0.2,
  '⅙': 1 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/** Quantités écrites en toutes lettres, courantes dans les transcriptions. */
const WORD_NUMBERS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
  sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, vingt: 20,
  demi: 0.5, demie: 0.5, quart: 0.25,
};

function parseNumber(token: string): number | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Fraction unicode seule ou après un entier : "1 ½"
  const unicodeFraction = FRACTION_MAP[trimmed];
  if (unicodeFraction !== undefined) return unicodeFraction;

  // "1/2", "3/4"
  const slash = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (slash?.[1] && slash[2]) {
    const denominator = Number(slash[2]);
    return denominator === 0 ? null : Number(slash[1]) / denominator;
  }

  // "1,5" ou "1.5"
  const decimal = Number(trimmed.replace(',', '.'));
  if (Number.isFinite(decimal)) return decimal;

  const word = WORD_NUMBERS[trimmed.toLowerCase()];
  return word ?? null;
}

/** Sépare "farine, tamisée" en nom + préparation. */
function splitPreparation(text: string): { name: string; preparation: string | null } {
  const commaIndex = text.indexOf(',');
  if (commaIndex > 0) {
    const name = text.slice(0, commaIndex).trim();
    const preparation = text.slice(commaIndex + 1).trim();
    if (name && preparation) return { name, preparation };
  }

  // "(coupé en dés)" en fin de ligne
  const parenthetical = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenthetical?.[1] && parenthetical[2]) {
    return { name: parenthetical[1].trim(), preparation: parenthetical[2].trim() };
  }

  return { name: text.trim(), preparation: null };
}

export function parseIngredientLine(raw: string): ParsedIngredientLine | null {
  const line = raw
    .replace(/\s+/g, ' ')
    .replace(/^[-•*–—\s]+/, '')
    .trim();

  if (!line || line.length < 2) return null;

  // Motif : [quantité][fraction] [unité] [de] nom
  // La quantité peut être "2", "1,5", "1/2", "½", "1 ½", ou absente.
  const pattern =
    /^(?<qty>\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|\d*\s*[½⅓⅔¼¾⅕⅙⅛⅜⅝⅞])?\s*(?<rest>.*)$/u;

  const match = line.match(pattern);
  const rawQty = match?.groups?.['qty']?.trim() ?? '';
  let rest = match?.groups?.['rest']?.trim() ?? line;

  let quantity: number | null = null;

  if (rawQty) {
    // "1 ½" : entier + fraction collés
    const mixed = rawQty.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅙⅛⅜⅝⅞])$/u);
    if (mixed?.[1] && mixed[2]) {
      quantity = Number(mixed[1]) + (FRACTION_MAP[mixed[2]] ?? 0);
    } else {
      quantity = parseNumber(rawQty);
    }
  }

  // Intervalle "2 à 3 tomates" : on retient la borne basse et on le signale.
  let note: string | null = null;
  const range = rest.match(/^(?:à|a|-|–)\s*(\d+(?:[.,]\d+)?)\s+(.*)$/u);
  if (quantity !== null && range?.[1] && range[2]) {
    note = `quantité indiquée entre ${quantity} et ${range[1]}`;
    rest = range[2];
  }

  // Unité : premier mot, s'il est reconnu comme telle.
  let unit: string | null = null;
  const unitMatch = rest.match(/^([\p{L}.]+(?:\s+à\s+\p{L}+)?)\s+(.*)$/u);

  if (unitMatch?.[1] && unitMatch[2]) {
    const candidate = unitMatch[1];
    const normalized = normalizeUnit(candidate);
    // normalizeUnit rend le mot tel quel s'il ne le connaît pas : on ne
    // retient donc que les cas où il a vraiment reconnu une unité.
    if (normalized && normalized !== candidate) {
      unit = normalized;
      rest = unitMatch[2];
    } else if (/^(g|kg|mg|ml|cl|dl|l)$/i.test(candidate)) {
      unit = candidate.toLowerCase();
      rest = unitMatch[2];
    }
  }

  // "de", "d'" après l'unité : "2 c. à soupe DE sauce soja"
  rest = rest.replace(/^(?:de\s+la\s+|de\s+l'|du\s+|des\s+|de\s+|d')/i, '').trim();

  if (!rest) return null;

  const { name, preparation } = splitPreparation(rest);
  if (!name) return null;

  if (quantity === null && note === null) note = 'quantité non précisée';

  return {
    quantity,
    unit,
    ingredient: name.slice(0, 200),
    preparation: preparation?.slice(0, 200) ?? null,
    note,
  };
}
