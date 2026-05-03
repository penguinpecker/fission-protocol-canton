export function fmtNumber(s: string | number, decimals = 2): string {
  const n = typeof s === 'string' ? parseFloat(s) : s;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPct(s: string | number, decimals = 2): string {
  const n = typeof s === 'string' ? parseFloat(s) : s;
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(decimals)}%`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function fmtMaturityCode(iso: string): string {
  const d = new Date(iso);
  const m = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return `${m}${String(d.getFullYear()).slice(-2)}`;
}

export function shortParty(party: string): string {
  if (party.length < 16) return party;
  const [name, hash] = party.split('::');
  return hash ? `${name}::${hash.slice(0, 6)}…${hash.slice(-4)}` : `${party.slice(0, 8)}…${party.slice(-6)}`;
}
