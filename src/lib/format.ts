export function fmtCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

export function fmtSigned(cents: number): string {
  if (cents === 0) return '$0.00';
  return cents > 0 ? `+${fmtCents(cents)}` : fmtCents(cents);
}
