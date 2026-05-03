import { LedgerClient } from '../lib/LedgerClient.js';
import type { Portfolio, PortfolioPosition } from '../types/api.js';

export class PortfolioService {
  constructor(private readonly ledger: LedgerClient) {}

  /**
   * Build the user's portfolio by querying each holding template.
   */
  async getPortfolio(party: string): Promise<Portfolio> {
    const positions: PortfolioPosition[] = [];

    // SY holdings.
    const sys = await this.ledger.queryActiveContracts<{
      instrumentId: { unInstrumentId: string };
      amount: string;
    }>('#fission-sy:Fission.SY:SyHolding', [party]);
    for (const sy of sys) {
      positions.push({
        contractId: sy.contractId,
        instrumentId: sy.payload.instrumentId.unInstrumentId,
        kind: 'SY',
        amount: sy.payload.amount,
      });
    }

    // PT holdings.
    const pts = await this.ledger.queryActiveContracts<{
      instrumentId: { unInstrumentId: string };
      amount: string;
      maturity: { unMaturity: string };
    }>('#fission-py:Fission.PY:PtHolding', [party]);
    for (const pt of pts) {
      positions.push({
        contractId: pt.contractId,
        instrumentId: pt.payload.instrumentId.unInstrumentId,
        kind: 'PT',
        amount: pt.payload.amount,
      });
    }

    // YT holdings - includes claimable yield calculation.
    const yts = await this.ledger.queryActiveContracts<{
      instrumentId: { unInstrumentId: string };
      amount: string;
      entryIndex: string;
      lastClaimedIndex: string;
      maturity: { unMaturity: string };
      assetCode: { unAssetCode: string };
    }>('#fission-py:Fission.PY:YtHolding', [party]);

    for (const yt of yts) {
      const claimable = await this.computeClaimableYield(
        yt.payload.assetCode.unAssetCode,
        yt.payload.maturity.unMaturity,
        parseFloat(yt.payload.lastClaimedIndex),
        parseFloat(yt.payload.amount),
      );
      positions.push({
        contractId: yt.contractId,
        instrumentId: yt.payload.instrumentId.unInstrumentId,
        kind: 'YT',
        amount: yt.payload.amount,
        claimableYield: claimable,
      });
    }

    // LP holdings.
    const lps = await this.ledger.queryActiveContracts<{
      poolId: { assetCode: { unAssetCode: string }; maturity: { unMaturity: string } };
      shares: string;
    }>('#fission-amm:Fission.AMM:LpHolding', [party]);
    for (const lp of lps) {
      positions.push({
        contractId: lp.contractId,
        instrumentId: `LP-${lp.payload.poolId.assetCode.unAssetCode}-${lp.payload.poolId.maturity.unMaturity}`,
        kind: 'LP',
        amount: lp.payload.shares,
      });
    }

    const totalValueSy = positions
      .reduce((acc, p) => acc + parseFloat(p.amount), 0)
      .toFixed(6);

    return { party, positions, totalValueSy };
  }

  private async computeClaimableYield(
    assetCode: string,
    maturityIso: string,
    lastClaimedIndex: number,
    amount: number,
  ): Promise<string> {
    // Read the current index from PyIndexState.
    const indexState = await this.ledger.queryContractByKey<{ currentIndex: string }>(
      '#fission-py:Fission.PY:PyIndexState',
      {
        issuer: process.env.OPERATOR_PARTY!,
        assetCode: { unAssetCode: assetCode },
        maturity: { unMaturity: maturityIso },
      },
      [process.env.OPERATOR_PARTY!],
    );
    if (!indexState) return '0';
    const currentIndex = parseFloat(indexState.payload.currentIndex);
    const yieldPerUnit = Math.max(0, currentIndex - lastClaimedIndex);
    return (yieldPerUnit * amount).toFixed(6);
  }
}
