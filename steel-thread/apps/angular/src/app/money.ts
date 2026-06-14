/**
 * Format a number as US currency to match the React app exactly, e.g.
 *   50000      -> "$50,000.00"
 *   2500       -> "$2,500.00"
 * Uses Intl.NumberFormat (en-US, USD) — the same primitive both apps use.
 */
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number): string {
  return USD.format(value);
}
