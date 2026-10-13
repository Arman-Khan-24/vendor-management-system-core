import { CatalogItemContext, ExtractedOrderItem } from './ai.service.js';

export interface MatchedOrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface CatalogMatchResult {
  matchedItems: MatchedOrderItem[];
  unresolvedItems: string[];
  ambiguousItems: Array<{ input: string; candidates: string[] }>;
  isValid: boolean;
}

export class CatalogMatcher {
  /**
   * Deterministically match AI-extracted items against the tenant catalog.
   * Supports shorthands, unit validation, and flags ambiguous or missing products.
   */
  static match(
    extractedItems: ExtractedOrderItem[],
    catalog: CatalogItemContext[]
  ): CatalogMatchResult {
    const matchedItems: MatchedOrderItem[] = [];
    const unresolvedItems: string[] = [];
    const ambiguousItems: Array<{ input: string; candidates: string[] }> = [];

    for (const item of extractedItems) {
      const query = item.product.trim().toLowerCase();
      const qty = Number(item.quantity);

      if (isNaN(qty) || qty <= 0) {
        unresolvedItems.push(`${item.product} (invalid quantity ${item.quantity})`);
        continue;
      }

      // Normalize plurals and stems (e.g. 'tomatoes' -> 'tomato', 'onions' -> 'onion', 'potatoes' -> 'potato')
      const singularQuery = query
        .replace(/es$/i, '')
        .replace(/s$/i, '');

      // 1. Check exact match candidates
      const exactCandidates = catalog.filter(c => {
        const cLower = c.name.toLowerCase();
        const cSingular = cLower.replace(/es$/i, '').replace(/s$/i, '');
        return cLower === query || (query.length > 3 && cSingular === singularQuery);
      });

      if (exactCandidates.length === 1) {
        const found = exactCandidates[0];
        // If customer provided a unit, ensure it matches or inherit catalog unit
        matchedItems.push({
          productId: found.id,
          productName: found.name,
          quantity: qty,
          unit: item.unit || found.unit, // Inherits catalog base unit
          unitPrice: found.current_price,
          totalPrice: qty * found.current_price
        });
        continue;
      } else if (exactCandidates.length > 1) {
        // Multiple exact matches (e.g., "Watermelon" in kg vs "Watermelon" in piece)
        if (item.unit) {
          const unitMatch = exactCandidates.find(c => c.unit.toLowerCase() === item.unit.toLowerCase());
          if (unitMatch) {
            matchedItems.push({
              productId: unitMatch.id,
              productName: unitMatch.name,
              quantity: qty,
              unit: unitMatch.unit,
              unitPrice: unitMatch.current_price,
              totalPrice: qty * unitMatch.current_price
            });
            continue;
          }
        }
        // Unit was not specified or didn't match: flag ambiguity!
        ambiguousItems.push({
          input: item.product,
          candidates: exactCandidates.map(c => `${c.name} (${c.unit})`)
        });
        continue;
      }

      // 2. Word Boundary / Prefix / Shorthand / Hindi Synonym Matching
      // e.g., 'tom' or 'tomatoes' matches 'Tomato', 'pot' matches 'Potato', 'pyaz' matches 'Onion'
      const candidates = catalog.filter(c => {
        const cLower = c.name.toLowerCase();
        const cSingular = cLower.replace(/es$/i, '').replace(/s$/i, '');

        if (cLower.includes(query) || query.includes(cLower)) return true;
        if (cSingular.includes(singularQuery) || singularQuery.includes(cSingular)) return true;

        // Known wholesale shorthands & Hindi synonyms
        if ((query === 'tom' || query === 'tamatar' || query === 'tamator' || singularQuery === 'tomato') && cLower.includes('tomato')) return true;
        if ((query === 'pot' || singularQuery === 'potato') && cLower.includes('potato')) return true;
        if ((query === 'pyaz' || query === 'kanda' || singularQuery === 'onion') && (cLower.includes('onion') || cLower.includes('pyaz'))) return true;
        if ((query === 'aalu' || query === 'alu' || query === 'batata' || singularQuery === 'potato') && (cLower.includes('potato') || cLower.includes('aalu') || cLower.includes('alu'))) return true;
        if ((query === 'bhindi' || query === 'okra') && (cLower.includes('bhindi') || cLower.includes('okra'))) return true;
        if ((query === 'chilli' || query === 'mirchi') && (cLower.includes('chilli') || cLower.includes('mirchi'))) return true;
        if (singularQuery === 'banana' && cLower.includes('banana')) return true;
        if (singularQuery === 'watermelon' && cLower.includes('watermelon')) return true;

        return false;
      });

      if (candidates.length === 1) {
        const found = candidates[0];
        matchedItems.push({
          productId: found.id,
          productName: found.name,
          quantity: qty,
          unit: item.unit || found.unit, // Inherits catalog base unit
          unitPrice: found.current_price,
          totalPrice: qty * found.current_price
        });
      } else if (candidates.length > 1) {
        // If customer specified a unit, check if that resolves the ambiguity
        if (item.unit) {
          const unitMatches = candidates.filter(c => c.unit.toLowerCase() === item.unit.toLowerCase());
          if (unitMatches.length === 1) {
            const found = unitMatches[0];
            matchedItems.push({
              productId: found.id,
              productName: found.name,
              quantity: qty,
              unit: found.unit,
              unitPrice: found.current_price,
              totalPrice: qty * found.current_price
            });
            continue;
          }
        }

        // Multiple products/units plausible - do NOT silently guess
        ambiguousItems.push({
          input: item.product,
          candidates: candidates.map(c => `${c.name} (${c.unit})`)
        });
      } else {
        // Not in catalog
        unresolvedItems.push(item.product);
      }
    }

    const isValid = unresolvedItems.length === 0 && ambiguousItems.length === 0 && matchedItems.length > 0;

    return {
      matchedItems,
      unresolvedItems,
      ambiguousItems,
      isValid
    };
  }
}
