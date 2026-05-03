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
  currentRate: string;
  apr: string;
  lastObservedAt: string;
}

export interface Maturity {
  iso: string;
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
  claimableYield?: string;
  redemptionValue?: string;
}

export interface Portfolio {
  party: string;
  positions: PortfolioPosition[];
  totalValueSy: string;
}
