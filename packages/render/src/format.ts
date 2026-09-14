export const gbp = (n: number): string => '£' + Math.round(n).toLocaleString('en-GB');

export const gbpPence = (n: number): string =>
  '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const asUtc = (isoDate: string): Date => new Date(`${isoDate}T00:00:00Z`);

/** 2026-10-15 -> "15 October 2026" */
export const longDate = (isoDate: string): string =>
  asUtc(isoDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** 2026-10-15 -> "15 Oct 2026" */
export const shortDate = (isoDate: string): string =>
  asUtc(isoDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const number = (n: number): string => n.toLocaleString('en-GB');

/** 8000 -> "8k" */
export const kMiles = (n: number): string => (n % 1000 === 0 ? `${n / 1000}k` : number(n));
