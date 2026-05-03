/**
 * Shared types between backend API and frontend.
 * These mirror the Daml record types but use string-encoded Decimals (JSON-safe).
 */

export type CredentialClass =
  | 'Permissionless'
  | 'RetailKyc'
  | 'AccreditedInvestor'
  | 'InstitutionalOnly';

export type YieldKind = 'RisingNav' | 'Rebasing' | 'Streaming';

export interface Asset {
  code: string;
  displayName: string;
  yieldKind: YieldKind;
  credentialClass: CredentialClass;
  decimals: number;
  currentRate: string;       // exchange rate, decimal as string
  apr: string;                // annualized rate, decimal as string
  lastObservedAt: string;     // ISO 8601
}

export interface Maturity {
  iso: string;                // ISO 8601
  daysToMaturity: number;
}

export interface Market {
  assetCode: string;
  maturity: Maturity;
  ptInstrumentId: string;
  ytInstrumentId: string;
  syInstrumentId: string;
  currentIndex: string;
  impliedApy: string;
  poolSyReserve: string;
  poolPtReserve: string;
}

export interface PortfolioPosition {
  contractId: string;
  instrumentId: string;
  kind: 'SY' | 'PT' | 'YT' | 'LP';
  amount: string;
  market?: Market;
  // For YT only: yield available to claim
  claimableYield?: string;
  // For PT only: redemption value at maturity
  redemptionValue?: string;
}

export interface Portfolio {
  party: string;
  positions: PortfolioPosition[];
  totalValueSy: string;       // sum of all positions in SY-equivalent terms
}

export interface MintPyRequest {
  marketAssetCode: string;
  marketMaturityIso: string;
  amount: string;
}

export interface SwapRequest {
  marketAssetCode: string;
  marketMaturityIso: string;
  kind: 'SyToPt' | 'PtToSy';
  amountIn: string;
  minAmountOut: string;
}

export interface ClaimYieldRequest {
  ytContractId: string;
}

export interface RedeemRequest {
  ptContractId: string;
  ytContractId?: string;       // omitted for post-maturity
  amount: string;
}

export interface KycCertificateView {
  contractId: string;
  user: string;
  tier: CredentialClass;
  jurisdiction: string;
  issuedAt: string;
  expiresAt: string;
  isValid: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
