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
    const prompt = `You are OrderLedger AI order extractor for a wholesale vendor.
Vendor Catalog:
${catalogPrompt}

Incoming customer message:
"${text}"

TASK:
Extract ALL products, quantities, and units into structured JSON adhering strictly to:
{
  "items": [
    { "product": "exact or closest catalog item name", "quantity": number, "unit": "kg/dozen/crate/etc" }
  ],
  "warnings": []
}

CRITICAL PARSING RULES:
1. Comma-less and "and"-joined multi-item lists are PRIMARY formats. For example:
   - "tomato 5kg pyaz 3kg aalu 10kg bhindi 2kg" MUST extract 4 distinct items: tomato 5kg, pyaz 3kg, aalu 10kg, bhindi 2kg.
   - "tomato 5kg and potato 10kg" MUST extract 2 distinct items: tomato 5kg, potato 10kg.
2. NEVER merge adjacent items or drop items. If the customer lists 4 items, you must extract all 4 items.
3. Understand common Hinglish/Hindi synonyms against the catalog (e.g. pyaz/kanda -> onion, aalu/batata -> potato, bhindi -> okra, tamatar -> tomato).
4. If a quantity has no unit specified (e.g., "Tomatoes- 20"), use the standard unit from the vendor catalog for that item, or "kg" if unspecified.
5. If you cannot confidently identify any valid product or if the message is unintelligible gibberish, return "items": [] and include an explicit explanation in "warnings", e.g. ["Could not parse message into order items"]. NEVER return a garbled or merged single item.
6. Output valid JSON only with NO markdown fences.`;

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
    const systemPrompt = `You are OrderLedger AI order extractor for a wholesale vendor.
Vendor Catalog:
${catalogPrompt}

CRITICAL RULES:
1. Comma-less and "and"-joined multi-item lists (e.g. "tomato 5kg pyaz 3kg aalu 10kg bhindi 2kg", "tomato 5kg and potato 10kg") are PRIMARY formats. Extract every single item individually.
2. NEVER merge adjacent items or silently drop items.
3. Understand Hindi/Hinglish synonyms (pyaz, aalu, bhindi, tamatar).
4. If unintelligible, return "items": [] and warning "Could not parse message into order items".
5. Return JSON with keys "items" (array of { product, quantity, unit }) and "warnings".`;

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
  const items: ExtractedOrderItem[] = [];
  const warnings: string[] = [];

  // Normalize common separators, conversational filler, and prefixes
  let cleaned = text
    .replace(/^(bhai|bhaiya|sir|dear|boss|hello|hi|hey)\b/i, '')
    .replace(/\b(please\s+send|please|send|need|order|want|make|change|give)\b/gi, '')
    .trim();

  // Pre-split on ' and ', commas, semicolons, or newlines
  const segments = cleaned
    .split(/[\n,;]+|\s+and\s+/i)
    .map(s => s.trim())
    .filter(Boolean);

  // Helper unit normalizer - leaves empty if not specified
  const normalizeUnit = (u: string) => {
    const raw = (u || '').toLowerCase().trim();
    if (!raw) return '';
    if (raw === 'kgg' || raw === 'kgs' || raw === 'kg') return 'kg';
    if (raw === 'dz' || raw === 'doz' || raw === 'dozen') return 'dozen';
    if (raw === 'crate' || raw === 'crates') return 'crate';
    if (raw === 'pc' || raw === 'pcs' || raw === 'piece' || raw === 'pieces') return 'piece';
    if (raw === 'gm' || raw === 'g' || raw === 'gram' || raw === 'grams') return 'g';
    return raw;
  };

  for (const segment of segments) {
    // Check if segment contains multiple items concatenated without commas (e.g., "tomato 5kg pyaz 3kg aalu 10kg bhindi 2kg")
    // Regex pattern for item tokens: [name...] [qty] [optional unit]
    const tokenRegex = /([a-zA-Z\s]+?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?(?=\s+[a-zA-Z]|$)/gi;
    const matches = Array.from(segment.matchAll(tokenRegex));

    if (matches && matches.length > 1) {
      for (const m of matches) {
        let rawName = m[1].replace(/^(and|need|order)\s+/i, '').trim();
        let rawQty = parseFloat(m[2]);
        let rawUnit = normalizeUnit(m[3]);

        if (rawName && !isNaN(rawQty) && rawQty > 0) {
          items.push({
            product: rawName,
            quantity: rawQty,
            unit: rawUnit
          });
        }
      }
    } else {
      // Single item per segment
      // Pattern 1: Name [qty] [unit?] e.g. "Tomatoes- 20", "tomato 5kg", "onion 15 kg"
      // Pattern 2: [qty] [unit?] Name e.g. "5kg tomato", "2dz banana"
      const p1 = segment.match(/^([a-zA-Z\s]+?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/i);
      const p2 = segment.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+([a-zA-Z\s]+)$/i);

      if (p1) {
        let rawName = p1[1].replace(/^(and|need|order)\s+/i, '').trim();
        let rawQty = parseFloat(p1[2]);
        let rawUnit = normalizeUnit(p1[3]);

        if (rawName && !isNaN(rawQty) && rawQty > 0) {
          items.push({
            product: rawName,
            quantity: rawQty,
            unit: rawUnit
          });
        }
      } else if (p2) {
        let rawQty = parseFloat(p2[1]);
        let rawUnit = normalizeUnit(p2[2]);
        let rawName = p2[3].replace(/^(and|need|order)\s+/i, '').trim();

        if (rawName && !isNaN(rawQty) && rawQty > 0) {
          items.push({
            product: rawName,
            quantity: rawQty,
            unit: rawUnit
          });
        }
      } else {
        // Unparseable fragment (e.g. "potato ," or random words without numbers)
        // Never fabricate or garble! Record a warning.
        warnings.push(`Could not confidently parse fragment: "${segment}"`);
      }
    }
  }

  // Rule 2: If we couldn't parse any valid item, explicitly flag warning
  if (items.length === 0) {
    warnings.push('Could not parse this message into any confident order items.');
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
