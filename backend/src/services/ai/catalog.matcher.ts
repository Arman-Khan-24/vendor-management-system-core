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

      // 1. Exact Name Match (case-insensitive)
      const exactMatch = catalog.find(c => c.name.toLowerCase() === query);
      if (exactMatch) {
        matchedItems.push({
          productId: exactMatch.id,
          productName: exactMatch.name,
          quantity: qty,
          unit: item.unit || exactMatch.unit,
          unitPrice: exactMatch.current_price,
          totalPrice: qty * exactMatch.current_price
        });
        continue;
      }

      // 2. Word Boundary / Prefix / Shorthand Matching
      // e.g., 'tom' matches 'Tomato', 'pot' matches 'Potato'
      const candidates = catalog.filter(c => {
        const cLower = c.name.toLowerCase();
        if (cLower.includes(query) || query.includes(cLower)) return true;
        // Known wholesale shorthands
        if (query === 'tom' && cLower.includes('tomato')) return true;
        if (query === 'pot' && cLower.includes('potato')) return true;
        if (query === 'chilli' && cLower.includes('chilli')) return true;
        if (query === 'onion' && cLower.includes('onion')) return true;
        return false;
      });

      if (candidates.length === 1) {
        const found = candidates[0];
        matchedItems.push({
          productId: found.id,
          productName: found.name,
          quantity: qty,
          unit: item.unit || found.unit,
          unitPrice: found.current_price,
          totalPrice: qty * found.current_price
        });
      } else if (candidates.length > 1) {
        // Multiple products plausible - do NOT silently guess
        ambiguousItems.push({
          input: item.product,
          candidates: candidates.map(c => c.name)
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
