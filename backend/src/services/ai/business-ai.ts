import { query } from '../../database/connection.js';
import { decryptSecret } from '../business-settings.service.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AiOrderExtractionService, GeminiExtractionProvider, GroqExtractionProvider, type IOrderExtractionProvider } from './ai.service.js';

function provider(name: string, key: string, model: string, visionModel: string, endpoint?: string): IOrderExtractionProvider {
  if (!key || !model) throw new AppError('Save a provider API key and model in Settings → Connections before extracting orders.', 400);
  if (name === 'gemini') return new GeminiExtractionProvider(key, model, endpoint || undefined);
  if (name === 'groq') return new GroqExtractionProvider(key, model, visionModel || model, endpoint || undefined);
  throw new AppError('Order extraction supports Gemini and Groq. Select one in Settings → Connections.', 400);
}
/** Saved tenant configuration takes precedence, including an explicitly cleared key. */
export async function getBusinessAi(businessId: string) {
  const rows = (await query('SELECT * FROM business_connections WHERE business_id = $1', [businessId])).rows;
  const primaryRow = rows.find(row => row.slot === 'primary');
  const fallbackRow = rows.find(row => row.slot === 'fallback');
  const primaryName = process.env.AI_PRIMARY_PROVIDER || 'gemini';
  const primaryModel = process.env.AI_PRIMARY_MODEL || (primaryName==='gemini' ? 'gemini-2.5-flash' : 'llama-3.3-70b-versatile');
  const fallbackName = process.env.AI_FALLBACK_PROVIDER || 'groq';
  const fallbackModel = process.env.AI_FALLBACK_MODEL || (fallbackName==='gemini' ? 'gemini-2.5-flash' : 'llama-3.3-70b-versatile');
  const fallbackKey = process.env.AI_FALLBACK_API_KEY || (fallbackName==='gemini' ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY) || '';
  const primary = primaryRow
    ? provider(primaryRow.provider, decryptSecret(primaryRow.api_key_encrypted, businessId, 'primary'), primaryRow.model, primaryRow.model, primaryRow.endpoint)
    : provider(primaryName, process.env.AI_PRIMARY_API_KEY || (primaryName==='gemini' ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY) || '',
      primaryModel, process.env.AI_PRIMARY_VISION_MODEL || primaryModel);
  let fallback: IOrderExtractionProvider | undefined;
  if (fallbackRow?.api_key_encrypted && fallbackRow.model) {
    fallback = provider(fallbackRow.provider, decryptSecret(fallbackRow.api_key_encrypted, businessId, 'fallback'), fallbackRow.model, fallbackRow.model, fallbackRow.endpoint);
  } else if (!fallbackRow && fallbackKey) {
    fallback = provider(fallbackName, fallbackKey, fallbackModel, process.env.AI_FALLBACK_VISION_MODEL || fallbackModel);
  }
  return new AiOrderExtractionService(primary, fallback);
}
