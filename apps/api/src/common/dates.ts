/**
 * Date helpers shared across API modules. Kept minimal — only what the
 * controllers actually need. Anything fancier belongs in @syncpath/domain.
 */

export function parseSafeDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(NaN);
  }
  const [y, m, d] = value.split('-').map(Number);
  // Dates in the API are calendar dates, not local timestamps. Store them at
  // UTC midnight so serialising with toISOString() never shifts a card by a
  // day when the server and browser use different time zones.
  return new Date(Date.UTC(y, m - 1, d));
}
