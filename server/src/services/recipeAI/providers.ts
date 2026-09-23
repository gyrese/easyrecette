import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { appError } from '../../utils/errors.js';
import { RECIPE_JSON_SCHEMA, toGeminiSchema } from './schema.js';

/**
 * Adaptateurs IA.
 *
 * Chaque provider reçoit le même couple (system, user) et doit rendre une
 * chaîne JSON. La validation Zod est faite en amont par l'appelant : ici on
 * ne s'occupe que du transport et de la contrainte de format.
 *
 * Les erreurs des SDK sont traduites en AppError pour que le pipeline puisse
 * décider d'un repli sur un autre provider (rate limit) ou d'un abandon.
 */

export interface AiCallResult {
  json: string;
  provider: string;
  model: string;
}

export interface AiProviderAdapter {
  name: 'anthropic' | 'openai' | 'gemini';
  isConfigured(): boolean;
  generate(system: string, user: string): Promise<AiCallResult>;
}

/** Sortie tronquée = JSON incomplet ; mieux vaut une erreur claire. */
const MAX_OUTPUT_TOKENS = 16_000;

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  anthropicClient ??= new Anthropic({ apiKey: config.ai.anthropic.apiKey });
  return anthropicClient;
}

export const anthropicAdapter: AiProviderAdapter = {
  name: 'anthropic',

  isConfigured: () => Boolean(config.ai.anthropic.apiKey),

  async generate(system, user) {
    const model = config.ai.anthropic.model;

    try {
      const response = await getAnthropic().messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: RECIPE_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      });

      if (response.stop_reason === 'max_tokens') {
        throw appError('AI_INVALID_JSON', {
          message: "La recette générée était trop longue et a été coupée. Réessaie.",
        });
      }
      if (response.stop_reason === 'refusal') {
        throw appError('NOT_A_RECIPE', {
          message: "L'IA a refusé de traiter ce contenu.",
          canRetryManually: true,
        });
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!text.trim()) throw appError('AI_INVALID_JSON');

      return { json: text, provider: 'anthropic', model };
    } catch (error) {
      throw translateSdkError(error, 'anthropic');
    }
  },
};

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  openaiClient ??= new OpenAI({ apiKey: config.ai.openai.apiKey });
  return openaiClient;
}

export const openaiAdapter: AiProviderAdapter = {
  name: 'openai',

  isConfigured: () => Boolean(config.ai.openai.apiKey),

  async generate(system, user) {
    const model = config.ai.openai.model;

    try {
      const response = await getOpenAI().chat.completions.create({
        model,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'recipe',
            strict: true,
            schema: RECIPE_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      });

      const choice = response.choices[0];
      if (choice?.finish_reason === 'length') {
        throw appError('AI_INVALID_JSON', {
          message: "La recette générée était trop longue et a été coupée. Réessaie.",
        });
      }

      const text = choice?.message.content;
      if (!text?.trim()) throw appError('AI_INVALID_JSON');

      return { json: text, provider: 'openai', model };
    } catch (error) {
      throw translateSdkError(error, 'openai');
    }
  },
};

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

let geminiClient: GoogleGenAI | null = null;

function getGemini(): GoogleGenAI {
  geminiClient ??= new GoogleGenAI({ apiKey: config.ai.gemini.apiKey ?? '' });
  return geminiClient;
}

export const geminiAdapter: AiProviderAdapter = {
  name: 'gemini',

  isConfigured: () => Boolean(config.ai.gemini.apiKey),

  async generate(system, user) {
    const model = config.ai.gemini.model;

    try {
      const response = await getGemini().models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(RECIPE_JSON_SCHEMA) as Record<string, unknown>,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });

      const text = response.text;
      if (!text?.trim()) throw appError('AI_INVALID_JSON');

      return { json: text, provider: 'gemini', model };
    } catch (error) {
      throw translateSdkError(error, 'gemini');
    }
  },
};

// ---------------------------------------------------------------------------

const ADAPTERS: Record<string, AiProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
};

/** Providers réellement utilisables, dans l'ordre de préférence configuré. */
export function getAvailableAdapters(): AiProviderAdapter[] {
  return config.ai.order
    .map((name) => ADAPTERS[name])
    .filter((adapter): adapter is AiProviderAdapter => Boolean(adapter?.isConfigured()));
}

/**
 * Traduit une erreur SDK en AppError.
 * Le rate limit et les pannes serveur sont distingués du reste : ce sont les
 * deux cas où réessayer avec un autre provider a du sens.
 */
function translateSdkError(error: unknown, provider: string) {
  // Déjà traduite (levée par nos soins plus haut) : on la laisse passer.
  if (error instanceof Error && error.name === 'AppError') return error;

  const status = extractStatus(error);
  const detail = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403) {
    return appError('AI_UNAVAILABLE', {
      message: `La clé d'API ${provider} est invalide ou n'a pas les droits nécessaires.`,
      detail,
    });
  }
  if (status === 429) {
    return appError('RATE_LIMITED', {
      message: `Quota ${provider} atteint.`,
      detail,
    });
  }
  if (status !== null && status >= 500) {
    return appError('AI_ERROR', {
      message: `Le service ${provider} est momentanément indisponible.`,
      detail,
    });
  }
  if (error instanceof Error && (error.name === 'AbortError' || /timeout/i.test(error.message))) {
    return appError('TIMEOUT', { message: `Le service ${provider} n'a pas répondu à temps.`, detail });
  }

  return appError('AI_ERROR', { detail, cause: error });
}

function extractStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'code']) {
    const value = record[key];
    if (typeof value === 'number' && value >= 100 && value < 600) return value;
  }
  return null;
}
