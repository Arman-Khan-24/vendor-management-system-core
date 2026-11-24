import { query } from '../../database/connection.js';
import { decryptSecret } from '../business-settings.service.js';
import { reserveSharedAiRequest } from './shared-ai-budget.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AiOrderExtractionService, GeminiExtractionProvider, GroqExtractionProvider, type IOrderExtractionProvider } from './ai.service.js';

type Slot = 'primary' | 'fallback';

async function loadProviderFactory(businessId: string) {
  const rows = (await query('SELECT * FROM business_connections WHERE business_id = $1', [businessId])).rows;
  return (slot: Slot): IOrderExtractionProvider | undefined => {
    const saved = rows.find(row => row.slot === slot);
    const prefix = 'AI_' + slot.toUpperCase();
    const name = saved?.provider ?? (process.env[prefix + '_PROVIDER'] || (slot === 'primary' ? 'gemini' : 'groq'));
    const model = saved?.model ?? (process.env[prefix + '_MODEL'] || (name === 'gemini' ? 'gemini-2.5-flash' : 'llama-3.3-70b-versatile'));
    const visionModel = saved ? saved.vision_model || model : process.env[prefix + '_VISION_MODEL'] || model;
    const key = saved
      ? decryptSecret(saved.api_key_encrypted, businessId, slot)
      : process.env[prefix + '_API_KEY'] || (name === 'gemini' ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY);
    if (!key || !model) return undefined;
    const beforeRequest = saved ? undefined : () => reserveSharedAiRequest(businessId);
    const endpoint = saved?.endpoint || undefined;
    if (name === 'gemini') return new GeminiExtractionProvider(key, model, endpoint, beforeRequest);
    if (name === 'groq') return new GroqExtractionProvider(key, model, visionModel, endpoint, beforeRequest);
    throw new AppError('Order extraction supports Gemini and Groq. Select one in Settings → Connections.', 400);
  };
}

export async function getBusinessAi(businessId: string, testSlot?: Slot) {
  const provider = await loadProviderFactory(businessId);
  const primary = provider(testSlot ?? 'primary');
  if (!primary) throw new AppError('Save a provider API key and model in Settings → Connections before extracting orders.', 400);
  return new AiOrderExtractionService(primary, testSlot ? undefined : () => provider('fallback'));
}
