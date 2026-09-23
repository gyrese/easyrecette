import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

/**
 * Extraction de contenu depuis du HTML brut.
 *
 * Stratégie en couches, de la plus fiable à la plus approximative (§4) :
 *   1. JSON-LD Schema.org Recipe — données déjà structurées par le site ;
 *   2. microdata / RDFa Recipe ;
 *   3. OpenGraph + meta — titre, auteur, image ;
 *   4. Readability — corps d'article débarrassé du menu et des pubs.
 *
 * Quand la couche 1 ou 2 aboutit, on peut se passer d'appel IA : le site a
 * déjà fait le travail, et ses données valent mieux qu'une reformulation.
 */

export interface SchemaRecipe {
  name?: string;
  description?: string;
  image?: string[];
  author?: string;
  recipeYield?: string;
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  recipeIngredient?: string[];
  recipeInstructions?: string[];
  recipeCategory?: string;
  recipeCuisine?: string;
  keywords?: string[];
  tips?: string[];
}

export interface HtmlExtraction {
  title: string | null;
  description: string | null;
  author: string | null;
  images: string[];
  /** Corps d'article nettoyé, ou null si Readability n'a rien trouvé. */
  text: string | null;
  structuredRecipe: SchemaRecipe | null;
  metadata: Record<string, unknown>;
}

/** Une valeur Schema.org peut être une chaîne, un objet, ou un tableau des deux. */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return decodeEntities(value.trim()) || undefined;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // { "@type": "Person", "name": "..." } ou { "@value": "..." }
    for (const key of ['name', 'text', '@value', 'headline']) {
      const nested = record[key];
      if (typeof nested === 'string' && nested.trim()) return decodeEntities(nested.trim());
    }
  }
  return undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aplatit recipeInstructions, dont le format varie beaucoup d'un site à l'autre :
 * chaînes, HowToStep, ou HowToSection contenant des HowToStep.
 */
function flattenInstructions(value: unknown): string[] {
  const out: string[] = [];

  for (const item of asArray(value as unknown[])) {
    if (typeof item === 'string') {
      const cleaned = stripTags(item);
      if (cleaned) out.push(cleaned);
      continue;
    }
    if (!item || typeof item !== 'object') continue;

    const record = item as Record<string, unknown>;
    const type = String(record['@type'] ?? '');

    if (type.includes('HowToSection')) {
      const sectionName = textOf(record['name']);
      const nested = flattenInstructions(record['itemListElement'] ?? record['steps']);
      // Le titre de section aide l'IA à regrouper, on le garde en préfixe.
      if (sectionName && nested.length > 0) out.push(`[${sectionName}]`);
      out.push(...nested);
      continue;
    }

    const text = textOf(record['text']) ?? textOf(record['name']);
    if (text) out.push(stripTags(text));
  }

  return out.filter(Boolean);
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '));
}

/** Les images Schema.org : string, ImageObject, ou tableau. */
function extractImages(value: unknown): string[] {
  const out: string[] = [];
  for (const item of asArray(value as unknown[])) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object') {
      const url = (item as Record<string, unknown>)['url'];
      if (typeof url === 'string') out.push(url);
    }
  }
  return out.filter((url) => /^https?:\/\//.test(url));
}

/** Parcourt un graphe JSON-LD à la recherche du premier nœud de type Recipe. */
function findRecipeNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || !node || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  const types = asArray(record['@type']).map((t) => String(t).toLowerCase());
  if (types.includes('recipe')) return record;

  // @graph est la forme la plus répandue chez les gros sites de cuisine.
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    const found = findRecipeNode(record[key], depth + 1);
    if (found) return found;
  }

  return null;
}

function toSchemaRecipe(node: Record<string, unknown>): SchemaRecipe {
  const ingredients = asArray(node['recipeIngredient'] ?? node['ingredients'])
    .map((item) => (typeof item === 'string' ? stripTags(item) : textOf(item)))
    .filter((item): item is string => Boolean(item));

  const instructions = flattenInstructions(node['recipeInstructions']);

  const authorNode = node['author'] ?? node['creator'];
  const author = asArray(authorNode).map(textOf).find(Boolean);

  const keywords = (() => {
    const raw = node['keywords'];
    if (typeof raw === 'string') return raw.split(',').map((k) => k.trim()).filter(Boolean);
    return asArray(raw).map(textOf).filter((k): k is string => Boolean(k));
  })();

  return {
    name: textOf(node['name']) ?? textOf(node['headline']),
    description: textOf(node['description']),
    image: extractImages(node['image']),
    author,
    recipeYield: asArray(node['recipeYield'] ?? node['yield']).map(textOf).find(Boolean),
    prepTime: textOf(node['prepTime']),
    cookTime: textOf(node['cookTime']),
    totalTime: textOf(node['totalTime']),
    recipeIngredient: ingredients,
    recipeInstructions: instructions,
    recipeCategory: asArray(node['recipeCategory']).map(textOf).find(Boolean),
    recipeCuisine: asArray(node['recipeCuisine']).map(textOf).find(Boolean),
    keywords,
  };
}

/** JSON-LD : la source la plus fiable quand elle existe. */
function extractJsonLd($: cheerio.CheerioAPI): SchemaRecipe | null {
  const scripts = $('script[type="application/ld+json"]').toArray();

  for (const script of scripts) {
    const raw = $(script).text().trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Certains sites injectent du JSON-LD légèrement cassé (virgule finale,
      // commentaires). On tente une réparation minimale avant d'abandonner.
      try {
        parsed = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1'));
      } catch {
        continue;
      }
    }

    const node = findRecipeNode(parsed);
    if (node) {
      const recipe = toSchemaRecipe(node);
      // Une "Recipe" sans ingrédient ni instruction n'est qu'une coquille.
      if ((recipe.recipeIngredient?.length ?? 0) > 0 || (recipe.recipeInstructions?.length ?? 0) > 0) {
        return recipe;
      }
    }
  }

  return null;
}

/** Microdata (itemprop) — repli pour les sites plus anciens. */
function extractMicrodata($: cheerio.CheerioAPI): SchemaRecipe | null {
  const scope = $('[itemtype*="schema.org/Recipe" i]').first();
  if (scope.length === 0) return null;

  const prop = (name: string): string[] =>
    scope
      .find(`[itemprop="${name}"]`)
      .toArray()
      .map((el) => {
        const $el = $(el);
        return decodeEntities(
          $el.attr('content') ?? $el.attr('datetime') ?? $el.attr('value') ?? $el.text(),
        );
      })
      .filter(Boolean);

  const ingredients = [...prop('recipeIngredient'), ...prop('ingredients')];
  const instructions = prop('recipeInstructions');

  if (ingredients.length === 0 && instructions.length === 0) return null;

  return {
    name: prop('name')[0],
    description: prop('description')[0],
    image: scope
      .find('[itemprop="image"]')
      .toArray()
      .map((el) => $(el).attr('src') ?? $(el).attr('content') ?? '')
      .filter((url) => /^https?:\/\//.test(url)),
    author: prop('author')[0],
    recipeYield: prop('recipeYield')[0],
    prepTime: prop('prepTime')[0],
    cookTime: prop('cookTime')[0],
    totalTime: prop('totalTime')[0],
    recipeIngredient: ingredients,
    recipeInstructions: instructions,
    recipeCategory: prop('recipeCategory')[0],
    recipeCuisine: prop('recipeCuisine')[0],
    keywords: prop('keywords').flatMap((k) => k.split(',').map((s) => s.trim())).filter(Boolean),
  };
}

/** Métadonnées OpenGraph / Twitter / meta standard. */
function extractMeta($: cheerio.CheerioAPI, baseUrl: string) {
  const meta = (selectors: string[]): string | null => {
    for (const selector of selectors) {
      const value = $(selector).attr('content') ?? $(selector).attr('value');
      if (value?.trim()) return decodeEntities(value.trim());
    }
    return null;
  };

  const absolutize = (url: string | null): string | null => {
    if (!url) return null;
    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return null;
    }
  };

  const title =
    meta(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ??
    decodeEntities($('title').first().text()) ??
    null;

  const description = meta([
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
  ]);

  const author = meta([
    'meta[property="article:author"]',
    'meta[name="author"]',
    'meta[property="og:site_name"]',
  ]);

  const images = [
    meta(['meta[property="og:image:secure_url"]', 'meta[property="og:image"]']),
    meta(['meta[name="twitter:image"]']),
  ]
    .map(absolutize)
    .filter((url): url is string => Boolean(url));

  return { title: title || null, description, author, images: [...new Set(images)] };
}

/**
 * Corps de l'article via Readability (l'algorithme du mode lecture de Firefox).
 * Bien plus robuste qu'un `$('article').text()` maison face aux sites de cuisine
 * saturés de pubs et de contenus liés.
 */
function extractArticleText(html: string, url: string): string | null {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document, { charThreshold: 200 });
    const article = reader.parse();
    const text = article?.textContent?.replace(/\n{3,}/g, '\n\n').trim();
    return text && text.length > 120 ? text : null;
  } catch {
    return null;
  }
}

/** Repli quand Readability échoue : on prend le texte utile du body. */
function fallbackText($: cheerio.CheerioAPI): string | null {
  $('script, style, nav, header, footer, aside, noscript, iframe, form').remove();
  const text = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 120 ? text.slice(0, 20_000) : null;
}

export function extractFromHtml(html: string, url: string): HtmlExtraction {
  const $ = cheerio.load(html);

  const structuredRecipe = extractJsonLd($) ?? extractMicrodata($);
  const meta = extractMeta($, url);
  const text = extractArticleText(html, url) ?? fallbackText($);

  const images = [...new Set([...(structuredRecipe?.image ?? []), ...meta.images])].slice(0, 5);

  return {
    title: structuredRecipe?.name ?? meta.title,
    description: structuredRecipe?.description ?? meta.description,
    author: structuredRecipe?.author ?? meta.author,
    images,
    text,
    structuredRecipe,
    metadata: {
      hasJsonLd: Boolean(structuredRecipe),
      ogTitle: meta.title,
      ogDescription: meta.description,
    },
  };
}

/**
 * Durée ISO 8601 ("PT1H30M") vers minutes.
 * Schema.org impose ce format, mais certains sites écrivent "30 min" ;
 * on gère les deux.
 */
export function parseDuration(value: string | null | undefined): number | null {
  if (!value) return null;

  const iso = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso) {
    const days = Number(iso[1] ?? 0);
    const hours = Number(iso[2] ?? 0);
    const mins = Number(iso[3] ?? 0);
    const total = days * 1440 + hours * 60 + mins;
    return total > 0 ? total : null;
  }

  const human = value.toLowerCase();
  let total = 0;
  const hourMatch = human.match(/(\d+(?:[.,]\d+)?)\s*(?:h|heure)/);
  if (hourMatch?.[1]) total += Number(hourMatch[1].replace(',', '.')) * 60;
  const minMatch = human.match(/(\d+)\s*(?:min|mn)/);
  if (minMatch?.[1]) total += Number(minMatch[1]);
  if (total === 0) {
    const bare = human.match(/^\s*(\d+)\s*$/);
    if (bare?.[1]) total = Number(bare[1]);
  }

  return total > 0 ? Math.round(total) : null;
}

/** "4 personnes", "Pour 6", "serves 4" -> 4 */
export function parseServings(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+)/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return parsed > 0 && parsed <= 100 ? parsed : null;
}
