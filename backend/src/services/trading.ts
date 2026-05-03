import { LedgerClient } from '../lib/LedgerClient.js';
import type {
  MintPyRequest,
  SwapRequest,
  ClaimYieldRequest,
  RedeemRequest,
} from '../types/api.js';

export class TradingService {
  constructor(
    private readonly ledger: LedgerClient,
    private readonly operatorParty: string,
    private readonly custodianParty: string,
  ) {}

  /**
   * Mint PT + YT from SY.
   * Looks up the user's SY holding, the market, the index state, and the user's KYC,
   * then exercises MintPY in a single transaction.
   */
  async mintPy(party: string, req: MintPyRequest): Promise<unknown> {
    const market = await this.ledger.queryContractByKey(
      '#fission-py:Fission.PY:PyMarket',
      {
        issuer: this.operatorParty,
        assetCode: { unAssetCode: req.marketAssetCode },
        maturity: { unMaturity: req.marketMaturityIso },
      },
      [this.operatorParty],
    );
    if (!market) throw new Error(`Market not found: ${req.marketAssetCode}/${req.marketMaturityIso}`);

    const indexState = await this.ledger.queryContractByKey(
      '#fission-py:Fission.PY:PyIndexState',
      {
        issuer: this.operatorParty,
        assetCode: { unAssetCode: req.marketAssetCode },
        maturity: { unMaturity: req.marketMaturityIso },
      },
      [this.operatorParty],
    );
    if (!indexState) throw new Error('Index state not found');

    const syHolding = await this.findSyHolding(party, req.marketAssetCode, req.amount);
    if (!syHolding) throw new Error('Insufficient SY holding');

    const kyc = await this.findKyc(party);
    if (!kyc) throw new Error('No valid KYC certificate');

    return this.ledger.exerciseChoice({
      templateId: '#fission-py:Fission.PY:PyMarket',
      contractId: market.contractId,
      choice: 'MintPY',
      argument: {
        owner: party,
        syHoldingCid: syHolding,
        amount: req.amount,
        kycCertCid: kyc,
        indexStateCid: indexState.contractId,
      },
      actAs: [party, this.custodianParty],
    });
  }

  /**
   * Submit a swap intent. The sequencer will pick it up and settle in the next batch.
   */
  async submitSwap(party: string, req: SwapRequest): Promise<unknown> {
    const pool = await this.ledger.queryContractByKey(
      '#fission-amm:Fission.AMM:AmmPool',
      {
        issuer: this.operatorParty,
        poolId: {
          assetCode: { unAssetCode: req.marketAssetCode },
          maturity: { unMaturity: req.marketMaturityIso },
        },
      },
      [this.operatorParty],
    );
    if (!pool) throw new Error('Pool not found');

    const kyc = await this.findKyc(party);
    if (!kyc) throw new Error('No valid KYC certificate');

    let syHoldingCid: string | undefined;
    let ptHoldingCid: string | undefined;

    if (req.kind === 'SyToPt') {
      const sy = await this.findSyHolding(party, req.marketAssetCode, req.amountIn);
      if (!sy) throw new Error('Insufficient SY for swap');
      syHoldingCid = sy;
    } else {
      const pt = await this.findPtHolding(
        party,
        req.marketAssetCode,
        req.marketMaturityIso,
        req.amountIn,
      );
      if (!pt) throw new Error('Insufficient PT for swap');
      ptHoldingCid = pt;
    }

    return this.ledger.exerciseChoice({
      templateId: '#fission-amm:Fission.AMM:AmmPool',
      contractId: pool.contractId,
      choice: 'SubmitSwap',
      argument: {
        trader: party,
        kind: req.kind,
        amountIn: req.amountIn,
        minAmountOut: req.minAmountOut,
        kycCertCid: kyc,
        syHoldingCid: syHoldingCid ?? null,
        ptHoldingCid: ptHoldingCid ?? null,
      },
      actAs: [party, this.custodianParty],
    });
  }

  /**
   * Claim accrued yield on a YT holding.
   */
  async claimYield(party: string, req: ClaimYieldRequest): Promise<unknown> {
    const yt = await this.fetchYt(req.ytContractId);
    if (!yt) throw new Error('YT not found');

    const indexState = await this.ledger.queryContractByKey(
      '#fission-py:Fission.PY:PyIndexState',
      {
        issuer: this.operatorParty,
        assetCode: { unAssetCode: yt.payload.assetCode.unAssetCode },
        maturity: { unMaturity: yt.payload.maturity.unMaturity },
      },
      [this.operatorParty],
    );
    if (!indexState) throw new Error('Index state not found');

    const kyc = await this.findKyc(party);
    if (!kyc) throw new Error('No valid KYC certificate');

    // readAs operator: PyIndexState observers are oracle+public only; the
    // exercising owner needs operator (signatory) in readAs to fetch indexStateCid.
    return this.ledger.exerciseChoice({
      templateId: '#fission-py:Fission.PY:YtHolding',
      contractId: req.ytContractId,
      choice: 'ClaimYield',
      argument: {
        indexStateCid: indexState.contractId,
        kycCertCid: kyc,
        syInstrumentId: { unInstrumentId: `SY-${yt.payload.assetCode.unAssetCode}` },
      },
      actAs: [party, this.custodianParty],
      readAs: [party, this.custodianParty, this.operatorParty],
    });
  }

  /**
   * Redeem PT (post-maturity) for the underlying SY.
   */
  async redeemPostMaturity(party: string, req: RedeemRequest): Promise<unknown> {
    const pt = await this.fetchPt(req.ptContractId);
    if (!pt) throw new Error('PT not found');

    const market = await this.ledger.queryContractByKey(
      '#fission-py:Fission.PY:PyMarket',
      {
        issuer: this.operatorParty,
        assetCode: { unAssetCode: pt.payload.assetCode.unAssetCode },
        maturity: { unMaturity: pt.payload.maturity.unMaturity },
      },
      [this.operatorParty],
    );
    if (!market) throw new Error('Market not found');

    const kyc = await this.findKyc(party);
    if (!kyc) throw new Error('No valid KYC certificate');

    return this.ledger.exerciseChoice({
      templateId: '#fission-py:Fission.PY:PyMarket',
      contractId: market.contractId,
      choice: 'RedeemPostMaturity',
      argument: {
        owner: party,
        ptCid: req.ptContractId,
        amount: req.amount,
        kycCertCid: kyc,
      },
      actAs: [party, this.custodianParty],
    });
  }

  // --- Helpers ---

  private async findSyHolding(
    party: string,
    assetCode: string,
    minAmount: string,
  ): Promise<string | null> {
    const holdings = await this.ledger.queryActiveContracts<{
      instrumentId: { unInstrumentId: string };
      amount: string;
    }>('#fission-sy:Fission.SY:SyHolding', [party]);
    const min = parseFloat(minAmount);
    const candidate = holdings.find(
      (h) =>
        h.payload.instrumentId.unInstrumentId === `SY-${assetCode}` &&
        parseFloat(h.payload.amount) >= min,
    );
    return candidate?.contractId ?? null;
  }

  private async findPtHolding(
    party: string,
    assetCode: string,
    maturityIso: string,
    minAmount: string,
  ): Promise<string | null> {
    const holdings = await this.ledger.queryActiveContracts<{
      assetCode: { unAssetCode: string };
      maturity: { unMaturity: string };
      amount: string;
    }>('#fission-py:Fission.PY:PtHolding', [party]);
    const min = parseFloat(minAmount);
    const candidate = holdings.find(
      (h) =>
        h.payload.assetCode.unAssetCode === assetCode &&
        h.payload.maturity.unMaturity === maturityIso &&
        parseFloat(h.payload.amount) >= min,
    );
    return candidate?.contractId ?? null;
  }

  private async findKyc(party: string): Promise<string | null> {
    const certs = await this.ledger.queryActiveContracts<{
      user: string;
      expiresAt: string;
    }>('#fission-credential:Fission.Credential:KycCertificate', [party]);
    const now = Date.now();
    const valid = certs.find(
      (c) => c.payload.user === party && new Date(c.payload.expiresAt).getTime() > now,
    );
    return valid?.contractId ?? null;
  }

  private async fetchYt(cid: string): Promise<{
    payload: {
      assetCode: { unAssetCode: string };
      maturity: { unMaturity: string };
    };
  } | null> {
    return this.fetchByContractId('#fission-py:Fission.PY:YtHolding', cid);
  }

  private async fetchPt(cid: string): Promise<{
    payload: {
      assetCode: { unAssetCode: string };
      maturity: { unMaturity: string };
    };
  } | null> {
    return this.fetchByContractId('#fission-py:Fission.PY:PtHolding', cid);
  }

  /**
   * Fetch a single contract by ID via the JSON Ledger API V2.
   * Uses /v2/events/events-by-contract-id which returns the create event
   * (and any consuming event) for a given contract.
   */
  private async fetchByContractId<T>(
    templateId: string,
    contractId: string,
  ): Promise<{ payload: T } | null> {
    try {
      const events = await (this.ledger as unknown as {
        eventsByContractId: (req: {
          contractId: string;
          requestingParties?: string[];
        }) => Promise<{ created?: { createArgument: T } } | null>;
      }).eventsByContractId({
        contractId,
        requestingParties: [this.operatorParty, this.custodianParty],
      });
      if (!events?.created) return null;
      return { payload: events.created.createArgument };
    } catch {
      // Fallback: scan active contracts and find by ID. Slower but always works.
      const all = await this.ledger.queryActiveContracts<T>(templateId, [
        this.operatorParty,
        this.custodianParty,
      ]);
      const match = all.find((c) => c.contractId === contractId);
      return match ? { payload: match.payload } : null;
    }
  }
}
