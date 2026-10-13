export interface ExtractedOrderItem {
  product: string;
  quantity: number;
  unit: string;
}

export interface ExtractionResult {
  items: ExtractedOrderItem[];
  warnings: string[];
  provider: string;
  model: string;
  wasFallback: boolean;
  rawResponse?: string;
}

export interface CatalogItemContext {
  id: string;
  name: string;
  unit: string;
  current_price: number;
}

export interface IOrderExtractionProvider {
  readonly name: string;
  extractOrderText(text: string, catalog: CatalogItemContext[]): Promise<{
    items: ExtractedOrderItem[];
    warnings: string[];
    rawResponse: string;
    model: string;
  }>;
}

export class GeminiExtractionProvider implements IOrderExtractionProvider {
  readonly name = 'gemini';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-1.5-flash') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async extractOrderText(text: string, catalog: CatalogItemContext[]) {
    if (!this.apiKey || this.apiKey === 'mock' || this.apiKey === 'test') {
      // Deterministic fallback/mock simulation if real API key not provided
      return simulateStructuredExtraction(text, catalog, 'gemini', this.model);
    }

    const catalogPrompt = catalog.map(c => `- ${c.name} (Unit: ${c.unit})`).join('\n');
    const prompt = `You are OrderLedger AI order extractor.
Customer order text:
"${text}"

Vendor Catalog:
${catalogPrompt}

Extract the products, quantities, and units into structured JSON adhering strictly to:
{
  "items": [
    { "product": "exact or closest catalog item name", "quantity": number, "unit": "kg/dozen/crate/etc" }
  ],
  "warnings": []
}
Output valid JSON only. Do not invent products outside the catalog.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini API error [${res.status}]: ${errBody}`);
    }

    const data: any = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error('Gemini returned empty response');
    }

    const parsed = JSON.parse(candidateText);
    return {
      items: parsed.items || [],
      warnings: parsed.warnings || [],
      rawResponse: candidateText,
      model: this.model
    };
  }
}

export class GroqExtractionProvider implements IOrderExtractionProvider {
  readonly name = 'groq';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'llama-3.3-70b-versatile') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async extractOrderText(text: string, catalog: CatalogItemContext[]) {
    if (!this.apiKey || this.apiKey === 'mock' || this.apiKey === 'test') {
      return simulateStructuredExtraction(text, catalog, 'groq', this.model);
    }

    const catalogPrompt = catalog.map(c => `- ${c.name} (Unit: ${c.unit})`).join('\n');
    const systemPrompt = `You are OrderLedger order parser. Given the vendor catalog, parse incoming customer orders into JSON with keys "items" (array of { product, quantity, unit }) and "warnings".
Vendor Catalog:
${catalogPrompt}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Groq API error [${res.status}]: ${errBody}`);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    return {
      items: parsed.items || [],
      warnings: parsed.warnings || [],
      rawResponse: content,
      model: this.model
    };
  }
}

function simulateStructuredExtraction(text: string, catalog: CatalogItemContext[], provider: string, model: string) {
  // Built-in intelligent deterministic mock parser when test/simulating without live internet keys
  const lines = text.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean);
  const items: ExtractedOrderItem[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    // e.g. "tom 20kg", "potato 10 kg", "banana 5 doz", "make tomato 25kg"
    const cleanedLine = line.replace(/^(make|change|add|give|send)\s+/i, '');
    const match = cleanedLine.match(/([a-zA-Z\s]+?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/i)
      || cleanedLine.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+([a-zA-Z\s]+)$/i);

    if (match) {
      let rawName = '';
      let rawQty = 0;
      let rawUnit = '';

      if (isNaN(parseFloat(match[1]))) {
        rawName = match[1].trim();
        rawQty = parseFloat(match[2]);
        rawUnit = (match[3] || '').trim();
      } else {
        rawQty = parseFloat(match[1]);
        rawUnit = (match[2] || '').trim();
        rawName = match[3].trim();
      }

      items.push({
        product: rawName,
        quantity: rawQty,
        unit: rawUnit || 'kg'
      });
    }
  }

  return {
    items,
    warnings,
    rawResponse: JSON.stringify({ items, warnings }),
    model
  };
}

export class AiOrderExtractionService {
  private primaryProvider: IOrderExtractionProvider;
  private fallbackProvider: IOrderExtractionProvider;

  constructor(primary?: IOrderExtractionProvider, fallback?: IOrderExtractionProvider) {
    const primaryName = process.env.AI_PRIMARY_PROVIDER || 'gemini';
    const primaryModel = process.env.AI_PRIMARY_MODEL || 'gemini-1.5-flash';
    const primaryKey = process.env.AI_PRIMARY_API_KEY || 'mock';

    const fallbackName = process.env.AI_FALLBACK_PROVIDER || 'groq';
    const fallbackModel = process.env.AI_FALLBACK_MODEL || 'llama-3.3-70b-versatile';
    const fallbackKey = process.env.AI_FALLBACK_API_KEY || 'mock';

    this.primaryProvider = primary || (primaryName === 'groq'
      ? new GroqExtractionProvider(primaryKey, primaryModel)
      : new GeminiExtractionProvider(primaryKey, primaryModel));

    this.fallbackProvider = fallback || (fallbackName === 'gemini'
      ? new GeminiExtractionProvider(fallbackKey, fallbackModel)
      : new GroqExtractionProvider(fallbackKey, fallbackModel));
  }

  setProviders(primary: IOrderExtractionProvider, fallback: IOrderExtractionProvider) {
    this.primaryProvider = primary;
    this.fallbackProvider = fallback;
  }

  async extract(text: string, catalog: CatalogItemContext[]): Promise<ExtractionResult> {
    try {
      const res = await this.primaryProvider.extractOrderText(text, catalog);
      return {
        items: res.items,
        warnings: res.warnings,
        provider: this.primaryProvider.name,
        model: res.model,
        wasFallback: false,
        rawResponse: res.rawResponse
      };
    } catch (primaryErr: any) {
      console.warn(`[AI Primary Provider ${this.primaryProvider.name} Failed]: ${primaryErr.message}. Attempting fallback to ${this.fallbackProvider.name}...`);
      try {
        const fallbackRes = await this.fallbackProvider.extractOrderText(text, catalog);
        return {
          items: fallbackRes.items,
          warnings: fallbackRes.warnings,
          provider: this.fallbackProvider.name,
          model: fallbackRes.model,
          wasFallback: true,
          rawResponse: fallbackRes.rawResponse
        };
      } catch (fallbackErr: any) {
        console.error(`[AI Fallback Provider ${this.fallbackProvider.name} also Failed]: ${fallbackErr.message}`);
        throw new Error(`Both AI extraction providers failed: Primary (${primaryErr.message}), Fallback (${fallbackErr.message})`);
      }
    }
  }
}
