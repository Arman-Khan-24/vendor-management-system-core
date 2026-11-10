const aliases: Record<string, string> = {
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', 'किलो': 'kg', 'किग्रा': 'kg',
  g: 'g', gm: 'g', gram: 'g', grams: 'g', 'ग्राम': 'g',
  l: 'litre', liter: 'litre', liters: 'litre', litre: 'litre', litres: 'litre', 'लीटर': 'litre',
  ml: 'ml', millilitre: 'ml', milliliter: 'ml',
  pc: 'piece', pcs: 'piece', piece: 'piece', pieces: 'piece', unit: 'piece', units: 'piece', 'नग': 'piece',
  dz: 'dozen', doz: 'dozen', dozen: 'dozen', dozens: 'dozen', 'दर्जन': 'dozen'
};
export const normalizeUnit = (unit: string) => aliases[unit.trim().toLowerCase()] || unit.trim().toLowerCase();
const units: Record<string, { dimension: string; factor: number }> = {
  kg: { dimension: 'mass', factor: 1000 }, g: { dimension: 'mass', factor: 1 },
  litre: { dimension: 'volume', factor: 1000 }, ml: { dimension: 'volume', factor: 1 },
  piece: { dimension: 'count', factor: 1 }, dozen: { dimension: 'count', factor: 12 }
};
/** Never infer a crate, bag, tray or box size; they depend on the product. */
export function convertQuantity(quantity: number, from: string, to: string): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const source = normalizeUnit(from), target = normalizeUnit(to);
  let converted = quantity;
  if (source !== target) {
    if (!units[source] || !units[target] || units[source].dimension !== units[target].dimension) return null;
    converted = quantity * units[source].factor / units[target].factor;
  }
  const rounded = Math.round(converted * 100) / 100;
  // The ledger stores two decimals: do not silently round 1 piece to .08 dozen.
  if (rounded <= 0 || rounded > 99999999.99 || Math.abs(converted - rounded) > 0.0000001) return null;
  return rounded;
}
