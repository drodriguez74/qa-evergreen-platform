// Currency formatting per the contract: balances/amounts read like "$50,000.00".
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatMoney(value: number): string {
  return usd.format(value);
}
