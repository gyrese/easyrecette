/**
 * Normalisation des unités, mise à l'échelle des quantités et fusion.
 *
 * Trois usages :
 *  - normaliser ce que rend l'IA ("cuillères à soupe" -> "c. à soupe") ;
 *  - recalculer les quantités quand l'utilisateur change le nombre de
 *    portions (§11), en basculant g <-> kg quand c'est plus lisible ;
 *  - décider si deux lignes de courses peuvent être additionnées (§12).
 *
 * Ce fichier est dupliqué à l'identique côté client (client/src/lib/units.ts)
 * pour que l'affichage soit cohérent sans aller-retour réseau. Toute
 * modification doit être reportée des deux côtés.
 */

export type UnitFamily = 'mass' | 'volume' | 'count' | 'spoon' | 'other';

interface UnitDef {
  /** Forme canonique affichée. */
  canonical: string;
  family: UnitFamily;
  /** Facteur vers l'unité de base de la famille (g, ml). null = non convertible. */
  toBase: number | null;
  /** Variantes reconnues en entrée, en minuscules sans accent. */
  aliases: string[];
}

const UNIT_DEFS: UnitDef[] = [
  // Masse — base : gramme
  { canonical: 'g', family: 'mass', toBase: 1, aliases: ['g', 'gr', 'gramme', 'grammes', 'gram', 'grams'] },
  { canonical: 'kg', family: 'mass', toBase: 1000, aliases: ['kg', 'kilo', 'kilos', 'kilogramme', 'kilogrammes'] },
  { canonical: 'mg', family: 'mass', toBase: 0.001, aliases: ['mg', 'milligramme', 'milligrammes'] },
  { canonical: 'lb', family: 'mass', toBase: 453.592, aliases: ['lb', 'lbs', 'livre', 'livres', 'pound', 'pounds'] },
  { canonical: 'oz', family: 'mass', toBase: 28.3495, aliases: ['oz', 'once', 'onces', 'ounce', 'ounces'] },

  // Volume — base : millilitre
  { canonical: 'ml', family: 'volume', toBase: 1, aliases: ['ml', 'millilitre', 'millilitres', 'cc', 'cm3'] },
  { canonical: 'cl', family: 'volume', toBase: 10, aliases: ['cl', 'centilitre', 'centilitres'] },
  { canonical: 'dl', family: 'volume', toBase: 100, aliases: ['dl', 'decilitre', 'decilitres'] },
  { canonical: 'l', family: 'volume', toBase: 1000, aliases: ['l', 'litre', 'litres', 'liter', 'liters'] },

  // Cuillères et tasses — volumes usuels, convertibles mais gardés tels quels
  // à l'affichage parce que « 2 c. à soupe » est plus utile que « 30 ml ».
  {
    canonical: 'c. à soupe',
    family: 'spoon',
    toBase: 15,
    aliases: [
      'c a soupe', 'c. a soupe', 'cuillere a soupe', 'cuilleres a soupe', 'cuillere a soupe',
      'cas', 'c.a.s', 'cs', 'tbsp', 'tablespoon', 'tablespoons', 'cuilleree a soupe',
    ],
  },
  {
    canonical: 'c. à café',
    family: 'spoon',
    toBase: 5,
    aliases: [
      'c a cafe', 'c. a cafe', 'cuillere a cafe', 'cuilleres a cafe', 'cac', 'c.a.c', 'cc cafe',
      'tsp', 'teaspoon', 'teaspoons', 'cuillere a the', 'cuilleres a the', 'cuilleree a cafe',
    ],
  },
  { canonical: 'tasse', family: 'volume', toBase: 240, aliases: ['tasse', 'tasses', 'cup', 'cups'] },

  // Dénombrables — non convertibles entre eux
  { canonical: 'pincée', family: 'count', toBase: null, aliases: ['pincee', 'pincees', 'pinch'] },
  { canonical: 'gousse', family: 'count', toBase: null, aliases: ['gousse', 'gousses', 'clove', 'cloves'] },
  { canonical: 'tranche', family: 'count', toBase: null, aliases: ['tranche', 'tranches', 'slice', 'slices'] },
  { canonical: 'sachet', family: 'count', toBase: null, aliases: ['sachet', 'sachets', 'packet'] },
  { canonical: 'botte', family: 'count', toBase: null, aliases: ['botte', 'bottes', 'bunch'] },
  { canonical: 'brin', family: 'count', toBase: null, aliases: ['brin', 'brins', 'sprig', 'sprigs'] },
  { canonical: 'feuille', family: 'count', toBase: null, aliases: ['feuille', 'feuilles', 'leaf', 'leaves'] },
  { canonical: 'boîte', family: 'count', toBase: null, aliases: ['boite', 'boites', 'can', 'cans', 'tin'] },
  { canonical: 'filet', family: 'count', toBase: null, aliases: ['filet', 'filets', 'fillet', 'fillets'] },
];

/** Enlève les accents et met en minuscules, pour comparer des libellés. */
export function deaccent(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const ALIAS_INDEX = new Map<string, UnitDef>();
for (const def of UNIT_DEFS) {
  ALIAS_INDEX.set(deaccent(def.canonical), def);
  for (const alias of def.aliases) ALIAS_INDEX.set(deaccent(alias), def);
}

function lookup(unit: string): UnitDef | null {
  const key = deaccent(unit).replace(/\.$/, '').replace(/\s+/g, ' ');
  return ALIAS_INDEX.get(key) ?? ALIAS_INDEX.get(key.replace(/s$/, '')) ?? null;
}

/**
 * Ramène une unité à sa forme canonique.
 * Une unité inconnue est conservée telle quelle (nettoyée) plutôt que rejetée :
 * mieux vaut afficher « 2 louches » que perdre l'information.
 */
export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const trimmed = unit.trim();
  if (!trimmed) return null;
  const def = lookup(trimmed);
  if (def) return def.canonical;
  return trimmed.slice(0, 32);
}

export function unitFamily(unit: string | null): UnitFamily {
  if (!unit) return 'count';
  return lookup(unit)?.family ?? 'other';
}

/**
 * Deux lignes fusionnent si elles désignent le même ingrédient ET que leurs
 * unités sont compatibles. « 2 oignons » + « 1 oignon » = 3 ; mais
 * « 200 g de tomates » + « 3 tomates » ne fusionne pas (§12).
 */
export function areUnitsCompatible(a: string | null, b: string | null): boolean {
  const defA = a ? lookup(a) : null;
  const defB = b ? lookup(b) : null;

  // Deux unités absentes : dénombrables sans unité, fusionnables.
  if (!a && !b) return true;
  if (!a || !b) return false;

  // Unités inconnues : seulement si écrites pareil.
  if (!defA || !defB) return deaccent(a) === deaccent(b);

  if (defA.canonical === defB.canonical) return true;
  if (defA.family !== defB.family) return false;
  return defA.toBase !== null && defB.toBase !== null;
}

/** Convertit une quantité vers l'unité de base de sa famille. */
export function toBaseQuantity(
  quantity: number,
  unit: string | null,
): { value: number; family: UnitFamily; base: string | null } {
  const def = unit ? lookup(unit) : null;
  if (!def || def.toBase === null) {
    return { value: quantity, family: def?.family ?? 'count', base: normalizeUnit(unit) };
  }
  return {
    value: quantity * def.toBase,
    family: def.family,
    base: def.family === 'mass' ? 'g' : 'ml',
  };
}

/**
 * Additionne deux quantités exprimées dans des unités compatibles.
 * Retourne null si l'une des quantités est inconnue : additionner « 1 oignon »
 * et « quantité non précisée » produirait un total faux.
 */
export function addQuantities(
  a: { quantity: number | null; unit: string | null },
  b: { quantity: number | null; unit: string | null },
): { quantity: number | null; unit: string | null } | null {
  if (!areUnitsCompatible(a.unit, b.unit)) return null;
  if (a.quantity === null || b.quantity === null) {
    // Unités compatibles mais total inconnu : on garde l'unité, pas de chiffre.
    return { quantity: null, unit: a.unit ?? b.unit };
  }

  const unitA = normalizeUnit(a.unit);
  const unitB = normalizeUnit(b.unit);
  const sum = a.quantity + b.quantity;

  if (unitA === unitB) {
    // Même unité : la somme est directe, mais on la repasse par
    // prettifyQuantity pour que 500 g + 700 g s'affiche « 1,2 kg » et non
    // « 1200 g ». Une unité non convertible en ressort inchangée.
    return prettifyQuantity(sum, unitA);
  }

  const baseA = toBaseQuantity(a.quantity, a.unit);
  const baseB = toBaseQuantity(b.quantity, b.unit);
  if (baseA.base === null || baseA.base !== baseB.base) return null;

  return prettifyQuantity(baseA.value + baseB.value, baseA.base);
}

/**
 * Choisit l'unité la plus lisible pour une quantité donnée.
 * 1500 g -> 1,5 kg ; 0,5 g -> 500 mg ; 2000 ml -> 2 l.
 */
export function prettifyQuantity(
  quantity: number,
  unit: string | null,
): { quantity: number; unit: string | null } {
  const def = unit ? lookup(unit) : null;
  if (!def || def.toBase === null) return { quantity: round(quantity), unit: normalizeUnit(unit) };

  const inBase = quantity * def.toBase;

  if (def.family === 'mass') {
    if (inBase >= 1000) return { quantity: round(inBase / 1000), unit: 'kg' };
    if (inBase < 1) return { quantity: round(inBase * 1000), unit: 'mg' };
    return { quantity: round(inBase), unit: 'g' };
  }

  if (def.family === 'volume') {
    if (inBase >= 1000) return { quantity: round(inBase / 1000), unit: 'l' };
    // Entre 20 cl et 1 l, le centilitre est l'unité usuelle en cuisine
    // française (« 25 cl de crème » plutôt que « 250 ml »).
    if (inBase >= 200) return { quantity: round(inBase / 10), unit: 'cl' };
    return { quantity: round(inBase), unit: 'ml' };
  }

  // Cuillères : on reste en cuillères, c'est ce que l'utilisateur veut lire.
  return { quantity: round(quantity), unit: def.canonical };
}

/**
 * Met à l'échelle une quantité pour un nouveau nombre de portions.
 * Une quantité inconnue reste inconnue : on ne fabrique pas de chiffre.
 */
export function scaleQuantity(
  quantity: number | null,
  unit: string | null,
  fromServings: number | null,
  toServings: number | null,
): { quantity: number | null; unit: string | null } {
  if (quantity === null) return { quantity: null, unit: normalizeUnit(unit) };
  if (!fromServings || !toServings || fromServings <= 0 || toServings <= 0 || fromServings === toServings) {
    return { quantity: round(quantity), unit: normalizeUnit(unit) };
  }
  return prettifyQuantity((quantity * toServings) / fromServings, unit);
}

/** Arrondi lisible : pas de 0,30000000000000004 dans une fiche cuisine. */
function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Math.abs(value);
  if (abs >= 100) return Math.round(value);
  if (abs >= 10) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

/** Fractions usuelles, plus naturelles qu'un décimal en cuisine. */
const FRACTIONS: Array<[number, string]> = [
  [0.125, '⅛'],
  [0.25, '¼'],
  [0.333, '⅓'],
  [0.5, '½'],
  [0.666, '⅔'],
  [0.75, '¾'],
];

/** Formatte une quantité pour l'affichage : 0.5 -> "½", 1.5 -> "1 ½". */
export function formatQuantity(quantity: number | null): string {
  if (quantity === null) return '';
  if (!Number.isFinite(quantity) || quantity <= 0) return '';

  const whole = Math.floor(quantity);
  const frac = quantity - whole;

  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < 0.02) {
      return whole > 0 ? `${whole} ${glyph}` : glyph;
    }
  }

  if (frac < 0.02) return String(whole);
  // Virgule décimale française, sans zéros inutiles.
  return String(round(quantity)).replace('.', ',');
}

/** Ligne complète : "2 ½ c. à soupe de sauce soja". */
export function formatIngredientLine(input: {
  quantity: number | null;
  unit: string | null;
  label: string;
  preparation?: string | null;
}): string {
  const parts: string[] = [];
  const qty = formatQuantity(input.quantity);
  if (qty) parts.push(qty);
  if (input.unit) parts.push(input.unit);
  parts.push(input.label);
  const line = parts.join(' ').replace(/\s+/g, ' ').trim();
  return input.preparation ? `${line}, ${input.preparation}` : line;
}

/**
 * Clé de regroupement d'un ingrédient : minuscules, sans accent, sans
 * article ni pluriel simple. "Des oignons rouges" -> "oignon rouge".
 */
export function ingredientSlug(name: string): string {
  let slug = deaccent(name)
    .replace(/^(de |des |du |d'|le |la |les |l'|un |une )+/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  slug = slug
    .split(' ')
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ');

  return slug || deaccent(name);
}
