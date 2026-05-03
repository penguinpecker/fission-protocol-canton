import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Asset, Market, Portfolio } from '../types';

const API_BASE = '/api';

// In a real deployment we'd grab the token from the wallet. For LocalNet demo
// the wallet sets a token in localStorage; in production this would be the
// AppsFactory wallet's signing flow.
function authHeaders(): HeadersInit {
  const token = localStorage.getItem('fission.token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export function useAssets() {
  return useQuery<Asset[]>({ queryKey: ['assets'], queryFn: () => get('/assets') });
}

export function useMarkets() {
  return useQuery<Market[]>({ queryKey: ['markets'], queryFn: () => get('/markets'), refetchInterval: 30_000 });
}

export function usePortfolio() {
  return useQuery<Portfolio>({ queryKey: ['portfolio'], queryFn: () => get('/portfolio'), refetchInterval: 15_000 });
}

export function useMint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { marketAssetCode: string; marketMaturityIso: string; amount: string }) =>
      post('/trade/mint', req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      qc.invalidateQueries({ queryKey: ['markets'] });
    },
  });
}

export function useSwap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: {
      marketAssetCode: string;
      marketMaturityIso: string;
      kind: 'SyToPt' | 'PtToSy';
      amountIn: string;
      minAmountOut: string;
    }) => post('/trade/swap', req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      qc.invalidateQueries({ queryKey: ['markets'] });
    },
  });
}

export function useClaimYield() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { ytContractId: string }) => post('/trade/claim', req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portfolio'] }),
  });
}

export function useRedeem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { ptContractId: string; ytContractId?: string; amount: string }) =>
      post('/trade/redeem', req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portfolio'] }),
  });
}
