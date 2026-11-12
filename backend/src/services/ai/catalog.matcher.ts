import type { CatalogItemContext, ExtractedOrderItem } from './ai.service.js';

import { convertQuantity, normalizeUnit } from './units.js';

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
  reviewItems: ExtractedOrderItem[];
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
    const reviewItems: ExtractedOrderItem[] = [];
    const unresolvedItems: string[] = [];
    const ambiguousItems: Array<{ input: string; candidates: string[] }> = [];

    const add = (item: ExtractedOrderItem, product: CatalogItemContext) => {
      if (!item.unit.trim()) { unresolvedItems.push(`${item.product}: please specify a unit`); reviewItems.push(item); return; }
      const quantity = convertQuantity(item.quantity, item.unit, product.unit);
      if (quantity === null) {
        reviewItems.push(item);
        unresolvedItems.push(`${item.product}: cannot convert ${item.quantity} ${item.unit} to ${product.unit} exactly; please clarify`);
        return;
      }
      const previous = matchedItems.find(value => value.productId === product.id);
      if (previous) {
        const combined = Math.round((previous.quantity + quantity) * 100) / 100;
        if (combined > 99999999.99) { unresolvedItems.push(`${item.product}: quantity is too large`); reviewItems.push(item); return; }
        previous.quantity = combined;
        previous.totalPrice = Math.round(Math.round(combined * 100) * Math.round(previous.unitPrice * 100) / 100) / 100;
      } else {
        matchedItems.push({ productId: product.id, productName: product.name, quantity,
          unit: product.unit, unitPrice: Number(product.current_price), totalPrice: Math.round(Math.round(quantity * 100) * Math.round(Number(product.current_price) * 100) / 100) / 100 });
      }
    };
    for (const item of extractedItems) {
      const query = item.product.trim().toLowerCase();
      const qty = Number(item.quantity);

      if (!Number.isFinite(qty) || qty <= 0) {
        reviewItems.push(item);
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
        add(item, found);
        continue;
      } else if (exactCandidates.length > 1) {
        // Multiple exact matches (e.g., "Watermelon" in kg vs "Watermelon" in piece)
        if (item.unit) {
          const unitMatch = exactCandidates.find(c => normalizeUnit(c.unit) === normalizeUnit(item.unit));
          if (unitMatch) {
            add(item, unitMatch);
            continue;
          }
        }
        // Unit was not specified or didn't match: flag ambiguity!
        reviewItems.push(item);
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

        // Known wholesale shorthands & Hindi synonyms (Romanized and Devanagari script)
        if ((query === 'tom' || query === 'tamatar' || query === 'tamator' || query === 'टमाटर' || singularQuery === 'tomato') && cLower.includes('tomato')) return true;
        if ((query === 'pot' || singularQuery === 'potato' || query === 'aalu' || query === 'alu' || query === 'आलू' || query === 'बटाटा') && (cLower.includes('potato') || cLower.includes('aalu') || cLower.includes('alu'))) return true;
        if ((query === 'pyaz' || query === 'kanda' || query === 'प्याज़' || query === 'प्याज' || query === 'कांदा' || singularQuery === 'onion') && (cLower.includes('onion') || cLower.includes('pyaz'))) return true;
        if ((query === 'bhindi' || query === 'okra' || query === 'भिंडी') && (cLower.includes('bhindi') || cLower.includes('okra'))) return true;
        if ((query === 'chilli' || query === 'mirchi' || query === 'मिर्ची' || query === 'हरी मिर्च') && (cLower.includes('chilli') || cLower.includes('mirchi'))) return true;
        if ((query === 'kela' || query === 'केला' || singularQuery === 'banana') && cLower.includes('banana')) return true;
        if (singularQuery === 'watermelon' && cLower.includes('watermelon')) return true;

        return false;
      });

      if (candidates.length === 1) {
        const found = candidates[0];
        add(item, found);
      } else if (candidates.length > 1) {
        // Multiple products/units plausible - do NOT silently guess
        reviewItems.push(item);
        ambiguousItems.push({
          input: item.product,
          candidates: candidates.map(c => `${c.name} (${c.unit})`)
        });
      } else {
        // Not in catalog
        reviewItems.push(item);
        unresolvedItems.push(item.product);
      }
    }

    const isValid = unresolvedItems.length === 0 && ambiguousItems.length === 0 && matchedItems.length > 0;

    return {
      matchedItems,
      reviewItems,
      unresolvedItems,
      ambiguousItems,
      isValid
    };
  }
}
