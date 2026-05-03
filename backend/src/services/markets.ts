import { LedgerClient } from '../lib/LedgerClient.js';
import type { Asset, Market, Maturity, YieldKind, CredentialClass } from '../types/api.js';

export class MarketsService {
  constructor(
    private readonly ledger: LedgerClient,
    private readonly operatorParty: string,
    private readonly oracleParty: string,
  ) {}

  /**
   * List all assets registered in the AssetRegistry.
   */
  async listAssets(): Promise<Asset[]> {
    const registries = await this.ledger.queryActiveContracts<{
      assets: Array<{
        code: { unAssetCode: string };
        displayName: string;
        yieldKind: YieldKind;
        credentialClass: CredentialClass;
        decimals: number;
      }>;
    }>('#fission-asset-registry:Fission.Asset.Registry:AssetRegistry', [this.operatorParty]);

    if (registries.length === 0) return [];
    // Multiple registries can exist from repeated bootstraps; pick the one with the most assets.
    const cfg = registries
      .map((r) => r.payload.assets)
      .reduce((a, b) => (b.length > a.length ? b : a), [] as typeof registries[0]['payload']['assets']);

    const assets: Asset[] = [];
    for (const a of cfg) {
      const feed = await this.ledger.queryContractByKey<{
        latest: { exchangeRate: string; observedAt: string; apr: string };
      }>('#fission-oracle:Fission.Oracle:YieldOracleFeed', {
        oracleParty: this.oracleParty,
        assetCode: { unAssetCode: a.code.unAssetCode },
      }, [this.oracleParty]);

      assets.push({
        code: a.code.unAssetCode,
        displayName: a.displayName,
        yieldKind: a.yieldKind,
        credentialClass: a.credentialClass,
        decimals: a.decimals,
        currentRate: feed?.payload.latest.exchangeRate ?? '1.0',
        apr: feed?.payload.latest.apr ?? '0.0',
        lastObservedAt: feed?.payload.latest.observedAt ?? new Date().toISOString(),
      });
    }
    return assets;
  }

  /**
   * List all PY markets across all assets.
   */
  async listMarkets(): Promise<Market[]> {
    const markets = await this.ledger.queryActiveContracts<{
      assetCode: { unAssetCode: string };
      maturity: { unMaturity: string };
      ptInstrumentId: { unInstrumentId: string };
      ytInstrumentId: { unInstrumentId: string };
      syInstrumentId: { unInstrumentId: string };
    }>('#fission-py:Fission.PY:PyMarket', [this.operatorParty]);

    const result: Market[] = [];
    const now = Date.now();

    for (const m of markets) {
      const matIso = m.payload.maturity.unMaturity;
      const matMs = new Date(matIso).getTime();
      const daysToMaturity = Math.max(0, Math.floor((matMs - now) / (1000 * 60 * 60 * 24)));

      const indexState = await this.ledger.queryContractByKey<{
        currentIndex: string;
      }>('#fission-py:Fission.PY:PyIndexState', {
        issuer: this.operatorParty,
        assetCode: { unAssetCode: m.payload.assetCode.unAssetCode },
        maturity: { unMaturity: matIso },
      }, [this.operatorParty]);

      const pool = await this.ledger.queryContractByKey<{
        syReserve: string;
        ptReserve: string;
      }>('#fission-amm:Fission.AMM:AmmPool', {
        issuer: this.operatorParty,
        poolId: {
          assetCode: { unAssetCode: m.payload.assetCode.unAssetCode },
          maturity: { unMaturity: matIso },
        },
      }, [this.operatorParty]);

      const impliedApy =
        pool && parseFloat(pool.payload.ptReserve) > 0
          ? this.computeImpliedApy(
              parseFloat(pool.payload.syReserve),
              parseFloat(pool.payload.ptReserve),
              daysToMaturity,
            )
          : '0.0';

      result.push({
        assetCode: m.payload.assetCode.unAssetCode,
        maturity: { iso: matIso, daysToMaturity },
        ptInstrumentId: m.payload.ptInstrumentId.unInstrumentId,
        ytInstrumentId: m.payload.ytInstrumentId.unInstrumentId,
        syInstrumentId: m.payload.syInstrumentId.unInstrumentId,
        currentIndex: indexState?.payload.currentIndex ?? '1.0',
        impliedApy,
        poolSyReserve: pool?.payload.syReserve ?? '0',
        poolPtReserve: pool?.payload.ptReserve ?? '0',
      });
    }
    return result;
  }

  /**
   * Compute implied APY from pool reserves.
   * Simplified: PT/SY ratio implies discount, annualized.
   *   discount = 1 - (ptReserve / (syReserve + ptReserve))  approx for small pools
   *   apy = discount * (365 / daysToMaturity)
   */
  private computeImpliedApy(sy: number, pt: number, daysToMaturity: number): string {
    if (daysToMaturity === 0 || sy + pt === 0) return '0.0';
    const ptShare = pt / (sy + pt);
    const discount = 1 - ptShare;
    const apy = discount * (365 / daysToMaturity);
    return apy.toFixed(6);
  }
}
