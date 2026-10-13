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
  extractOrderImage(imageBuffer: Buffer, mimeType: string, catalog: CatalogItemContext[], caption?: string): Promise<{
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
4. If a quantity has no unit specified (e.g., "Tomatoes- 20"), leave the unit empty string ("") so it can be matched with catalog default.
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

  async extractOrderImage(imageBuffer: Buffer, mimeType: string, catalog: CatalogItemContext[], caption?: string) {
    if (!this.apiKey || this.apiKey === 'mock' || this.apiKey === 'test') {
      return simulateVisionExtraction(imageBuffer, mimeType, catalog, 'gemini', this.model, caption);
    }

    const catalogPrompt = catalog.map(c => `- ${c.name} (Unit: ${c.unit})`).join('\n');
    const prompt = `You are OrderLedger AI Vision order extractor for a wholesale vendor.
You are inspecting a photo of a customer order (could be handwritten notepad, printed slip, whiteboard, or kitchen order sheet).
${caption ? `Optional note/caption accompanying image: "${caption}"` : ''}

Vendor Catalog:
${catalogPrompt}

TASK:
Accurately transcribe and extract ALL items, quantities, and units into structured JSON:
{
  "items": [
    { "product": "exact or closest catalog item name", "quantity": number, "unit": "kg/dozen/crate/piece/etc" }
  ],
  "warnings": []
}

VISION EXTRACTION RULES:
1. Handle realistic kitchen conditions: angled photos, uneven lighting, shadows, handwritten script, cursive, or ink smudges.
2. CROSSED OUT ITEMS / CORRECTIONS: If an item is struck through, crossed out (e.g. ~~10kg tomato~~ 15kg tomato), or modified with an arrow/scribble, take ONLY the final intended correction. Do NOT include crossed-out items.
3. Messy lists: Items may be in multi-column, clustered, or space-separated lists. Extract every single non-crossed-out line item.
4. If a handwritten word or quantity is illegible, blurry, or ambiguous, DO NOT guess wildly. Include an explicit warning in "warnings" (e.g. ["Illegible quantity for line item near bottom"]).
5. If the image is completely blank, unintelligible, or not an order (e.g. photo of random object), return "items": [] and warning "Image does not appear to contain readable order items".
6. Output valid JSON only with NO markdown fences.`;

    const base64Data = imageBuffer.toString('base64');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data
              }
            }
          ]
        }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini Vision API error [${res.status}]: ${errBody}`);
    }

    const data: any = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error('Gemini Vision returned empty response');
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
  private visionModel: string;

  constructor(apiKey: string, model: string = 'llama-3.3-70b-versatile', visionModel: string = 'qwen/qwen3.8-27b') {
    this.apiKey = apiKey;
    this.model = model;
    this.visionModel = process.env.AI_FALLBACK_VISION_MODEL || visionModel;
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

  async extractOrderImage(imageBuffer: Buffer, mimeType: string, catalog: CatalogItemContext[], caption?: string) {
    if (!this.apiKey || this.apiKey === 'mock' || this.apiKey === 'test') {
      return simulateVisionExtraction(imageBuffer, mimeType, catalog, 'groq', this.visionModel, caption);
    }

    const catalogPrompt = catalog.map(c => `- ${c.name} (Unit: ${c.unit})`).join('\n');
    const systemPrompt = `You are OrderLedger AI Vision order extractor for a wholesale vendor.
Transcribe and parse order images (handwritten or printed) into JSON with keys "items" (array of { product, quantity, unit }) and "warnings".
Ignore crossed-out/struck-through items.
Vendor Catalog:
${catalogPrompt}`;

    const base64Data = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.visionModel,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: caption ? `Order image with note: "${caption}"` : 'Please transcribe and extract all order items from this photo.' },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Groq Vision API error [${res.status}]: ${errBody}`);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    return {
      items: parsed.items || [],
      warnings: parsed.warnings || [],
      rawResponse: content,
      model: this.visionModel
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

function simulateVisionExtraction(
  imageBuffer: Buffer,
  mimeType: string,
  catalog: CatalogItemContext[],
  provider: string,
  model: string,
  caption?: string
) {
  // If image buffer encodes embedded mock text metadata or caption, prioritize it
  // In our simulated tests, image files can also encode realistic OCR text tags or simulated noisy handwritten content
  const content = imageBuffer.toString('utf8');
  const items: ExtractedOrderItem[] = [];
  const warnings: string[] = [];

  // Check if buffer contains tagged simulated note test metadata
  if (content.includes('MOCK_IMAGE_NOTE:')) {
    const rawNote = content.split('MOCK_IMAGE_NOTE:')[1].split('\n---')[0].trim();
    // Parse simulated note: handle crossed-out items (e.g. ~~...~~ or [CROSSED_OUT: ...])
    const lines = rawNote.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean);

    for (const rawLine of lines) {
      let line = rawLine;
      if (line.includes('~~') || line.toLowerCase().includes('crossed') || line.toLowerCase().includes('cancel')) {
        // If line has an arrow correction like "~~Tomato 10kg~~ -> Tomato 25kg", take the part after the arrow
        if (line.includes('->') || line.includes('=>') || line.includes('>')) {
          const parts = line.split(/->|=>|>/);
          line = parts[parts.length - 1].trim();
        } else {
          // Completely crossed out line item!
          continue;
        }
      }

      if (line.toLowerCase().includes('illegible') || line.toLowerCase().includes('blurry') || line.toLowerCase().includes('smudge')) {
        warnings.push(`Low confidence / illegible handwriting detected: "${line}"`);
        continue;
      }

      // Check if line contains multiple space-separated items (clustered stream)
      const tokenRegex = /([a-zA-Z\s()]+?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?(?=\s+[a-zA-Z]|$)/gi;
      const matches = Array.from(line.matchAll(tokenRegex));

      if (matches && matches.length > 1) {
        for (const m of matches) {
          let name = m[1].replace(/^(and|need|order)\s+/i, '').trim();
          let qty = parseFloat(m[2]);
          let unit = (m[3] || '').trim();
          if (name && !isNaN(qty) && qty > 0) {
            items.push({ product: name, quantity: qty, unit });
          }
        }
      } else {
        // Extract item from single line
        const match = line.match(/^([a-zA-Z\s()]+?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/i)
          || line.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+([a-zA-Z\s()]+)$/i);

        if (match) {
          let name = '';
          let qty = 0;
          let unit = '';
          if (isNaN(parseFloat(match[1]))) {
            name = match[1].replace(/^(and|need|order)\s+/i, '').trim();
            qty = parseFloat(match[2]);
            unit = (match[3] || '').trim();
          } else {
            qty = parseFloat(match[1]);
            unit = (match[2] || '').trim();
            name = match[3].replace(/^(and|need|order)\s+/i, '').trim();
          }
          if (name && !isNaN(qty) && qty > 0) {
            items.push({ product: name, quantity: qty, unit });
          }
        } else {
          warnings.push(`Could not parse handwritten fragment: "${line}"`);
        }
      }
    }
  } else if (caption) {
    return simulateStructuredExtraction(caption, catalog, provider, model);
  } else {
    // Blank or unrecognized image
    warnings.push('Image does not appear to contain readable order items.');
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
    const fallbackVisionModel = process.env.AI_FALLBACK_VISION_MODEL || 'qwen/qwen3.8-27b';
    const fallbackKey = process.env.AI_FALLBACK_API_KEY || 'mock';

    this.primaryProvider = primary || (primaryName === 'groq'
      ? new GroqExtractionProvider(primaryKey, primaryModel, fallbackVisionModel)
      : new GeminiExtractionProvider(primaryKey, primaryModel));

    this.fallbackProvider = fallback || (fallbackName === 'gemini'
      ? new GeminiExtractionProvider(fallbackKey, fallbackModel)
      : new GroqExtractionProvider(fallbackKey, fallbackModel, fallbackVisionModel));
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

  async extractImage(
    imageBuffer: Buffer,
    mimeType: string,
    catalog: CatalogItemContext[],
    caption?: string
  ): Promise<ExtractionResult> {
    try {
      const res = await this.primaryProvider.extractOrderImage(imageBuffer, mimeType, catalog, caption);
      return {
        items: res.items,
        warnings: res.warnings,
        provider: this.primaryProvider.name,
        model: res.model,
        wasFallback: false,
        rawResponse: res.rawResponse
      };
    } catch (primaryErr: any) {
      console.warn(`[AI Vision Primary Provider ${this.primaryProvider.name} Failed]: ${primaryErr.message}. Attempting fallback to ${this.fallbackProvider.name}...`);
      try {
        const fallbackRes = await this.fallbackProvider.extractOrderImage(imageBuffer, mimeType, catalog, caption);
        return {
          items: fallbackRes.items,
          warnings: fallbackRes.warnings,
          provider: this.fallbackProvider.name,
          model: fallbackRes.model,
          wasFallback: true,
          rawResponse: fallbackRes.rawResponse
        };
      } catch (fallbackErr: any) {
        console.error(`[AI Vision Fallback Provider ${this.fallbackProvider.name} also Failed]: ${fallbackErr.message}`);
        throw new Error(`Both AI Vision extraction providers failed: Primary (${primaryErr.message}), Fallback (${fallbackErr.message})`);
      }
    }
  }
}
