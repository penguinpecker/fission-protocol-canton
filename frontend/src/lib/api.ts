/**
 * REST client for the Fission backend (Fastify, JSON Ledger API V2 wrapper).
 * The frontend talks to this — never directly to Canton.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Asset {
  code: string;
  displayName: string;
  yieldKind: string;
  credentialClass: string;
  decimals: string;
  currentRate: string;
  apr: string;
  lastObservedAt: string;
}

export interface Market {
  assetCode: string;
  maturity: { iso: string; daysToMaturity: number };
  ptInstrumentId: string;
  ytInstrumentId: string;
  syInstrumentId: string;
  currentIndex: string;
  impliedApy: string;
  poolSyReserve: string;
  poolPtReserve: string;
}

export interface Position {
  contractId: string;
  instrumentId: string;
  kind: "SY" | "PT" | "YT" | "LP";
  amount: string;
  claimableYield?: string;
}

export interface Portfolio {
  party: string;
  positions: Position[];
  totalValueSy: string;
}

export interface ResolvePartyResponse {
  userId: string;
  party: string;
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  async listAssets(): Promise<Asset[]> {
    return unwrap(await fetch(`${API_URL}/api/assets`));
  },
  async listMarkets(): Promise<Market[]> {
    return unwrap(await fetch(`${API_URL}/api/markets`));
  },
  async resolveParty(userId: string): Promise<ResolvePartyResponse> {
    return unwrap(
      await fetch(`${API_URL}/api/auth/resolve-party`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    );
  },
  async portfolio(token: string): Promise<Portfolio> {
    return unwrap(
      await fetch(`${API_URL}/api/portfolio`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  },
  async mint(token: string, args: {
    marketAssetCode: string;
    marketMaturityIso: string;
    amount: string;
  }): Promise<unknown> {
    return unwrap(
      await fetch(`${API_URL}/api/trade/mint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(args),
      }),
    );
  },
  async swap(token: string, args: {
    marketAssetCode: string;
    marketMaturityIso: string;
    kind: "SyToPt" | "PtToSy";
    amountIn: string;
    minAmountOut: string;
  }): Promise<unknown> {
    return unwrap(
      await fetch(`${API_URL}/api/trade/swap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(args),
      }),
    );
  },
  async claim(token: string, ytContractId: string): Promise<unknown> {
    return unwrap(
      await fetch(`${API_URL}/api/trade/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ytContractId }),
      }),
    );
  },
};
