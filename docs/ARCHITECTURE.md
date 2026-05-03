# Fission Protocol — Architecture

## Overview

Fission is a Pendle-style yield tokenization protocol built natively on Canton Network using Daml 3.4. This document covers the protocol's economic invariants, the on-ledger data model, the off-chain service topology, and the production deployment path.

## 1. Economic Model

### Tokens

The protocol mints four classes of fungible tokens, all of which are CIP-56 compliant Holdings:

- **SY (Standardized Yield)** — a wrapper around a single underlying. SY's exchange rate against the underlying grows monotonically over time, capturing yield. 1 SY at issuance = 1 unit of underlying. At time t, 1 SY = exchangeRate(t) units.
- **PT (Principal Token)** — a zero-coupon bond. At maturity T, redeemable 1:1 for SY (and thus the underlying).
- **YT (Yield Token)** — a claim on all yield accrued by SY between mint and maturity. Holders may claim accrued yield at any time before maturity. At maturity, YT becomes worthless.
- **LP (Liquidity Provider)** — a share in the AMM pool's reserves of SY and PT. Withdrawable at any time.

### The Conservation Invariant

For every (asset, maturity) market, at all times t < T:

```
PT(t) + YT(t)  ≡  SY(t)
```

Splitting and recombining are perfectly reversible. This is the core invariant of the Pendle pattern.

### The PY-Index Ratchet

The PY-Index tracks the cumulative yield index since the market opened. YT yield claims debit the index; PT redemption is unaffected by it.

The critical property is that the index **never decreases**. If the underlying's exchange rate drops (negative yield event), the index is held flat:

```
index(t+1) = max(index(t), oracleRate(t+1))
```

This protects PT holders. Without the ratchet, a negative-yield event could leave PT under-collateralized at maturity. With the ratchet, PT remains 1:1 redeemable at all times.

## 2. On-Ledger Data Model

### Daml Packages

Seven Daml packages, each with a clear single responsibility:

| Package | Templates | Purpose |
|---------|-----------|---------|
| `fission-asset-registry` | `AssetRegistry` | Whitelist of approved underlyings + their config |
| `fission-credential` | `KycCertificate`, `KycCertificateProposal`, `KycRenewalProposal` | Bilateral KYC certificates |
| `fission-sy` | `SyInstrument`, `SyHolding` | The Standardized Yield wrapper |
| `fission-py` | `PyMarket`, `PtHolding`, `YtHolding`, `PyIndexState` | The PT/YT split engine |
| `fission-oracle` | `YieldOracleFeed` | Yield observations published by oracles |
| `fission-amm` | `AmmPool`, `PendingSwap`, `LpHolding` | The batch-sequenced AMM |
| `fission-tests` | (test scenarios) | End-to-end Daml Script tests |

### Holdings as UTXOs

PT, YT, SY, and LP holdings are all UTXO-style — one contract per position. This is the Daml/Canton-native pattern and is what gives Fission its parallelism advantage. A user with 5 PT positions across different markets has 5 independent contracts; updates to any one do not contend with the others.

Splits and merges are explicit choices (`SplitPt`, `MergePt`, etc.). The protocol does not auto-merge holdings; that is left to the wallet (typically via CIP-56 `MergeDelegation`).

### The PyIndexState Singleton

For each (operator, asset, maturity), there is exactly one `PyIndexState` contract. This is the only mutable state in the yield-tracking machinery. The index is updated via:

```
choice RatchetIndex : ContractId PyIndexState
  controller oracleParty
  do
    feed <- fetch oracleFeedCid
    let observedIndex = getCurrentRate feed
    let newIndex = max currentIndex observedIndex
    create this with currentIndex = newIndex, ...
```

Reads are non-consuming (`GetCurrentIndex`), so thousands of YT holders can claim yield in parallel without contending on this contract. Only the keeper's once-per-epoch update actually consumes and re-creates it.

### Privacy Model

Seven party roles, with carefully bounded visibility:

| Party | Signs | Observes | Visibility |
|-------|-------|----------|------------|
| `fissionOperator` | Factories, lifecycle rules | `public` | Aggregate state only |
| `custodian` | Holdings, accounts | Per-asset KYC certs | All holdings of users it custodies |
| `yieldOracle` | Observations, index updates | `public` | Public feeds only |
| `kycProvider` | KYC certificates | Issued certs | Certs it has issued |
| `public` | (none) | All `*State` contracts | Aggregates only |
| `regulator` (opt-in) | (none) | Subpoena-mode contracts | As permitted by user |
| `trader` | Their own holdings | Own positions + public lattice | Just their own state |

Pool reserves are public (necessary for price discovery), but individual `LpHolding` and `PendingSwap` contracts are visible only to their parties and the custodian/sequencer.

## 3. The Batch-Sequenced AMM

### Why a sequencer

In Daml, every contract is a UTXO. A naive on-chain pool would be a single `Pool` contract that every swap archives and recreates. Two simultaneous swaps would contend; only one would win per Canton round. This caps throughput at a few transactions per second per pool.

### The pattern

We split intent from settlement:

1. Trader exercises `SubmitSwap` → creates a `PendingSwap` contract. **The pool is not touched.** Thousands of `PendingSwap` contracts can be created in parallel.
2. The sequencer service polls every `BATCH_INTERVAL_MS` (default 3s) for active `PendingSwap` contracts.
3. The sequencer groups swaps by pool, applies the AMM curve sequentially against the running reserves to compute the net effect, and exercises `AmmPool.SettleBatch` with all the pending swap CIDs.
4. SettleBatch archives all pending swaps, updates the pool reserves once, and the transaction is final.

With batch size N=100, effective throughput is roughly 100x that of a naive design.

### Curve choice

The reference implementation uses constant-product (`x*y=k`) for clarity. Production should use the Pendle V2 logit curve, where:

```
rateScalar(t) = scalarRoot · yearFraction / timeToMaturity
```

This causes PT and SY to converge to a 1:1 ratio at maturity, eliminating impermanent loss for LPs who hold to maturity.

### MEV resistance

Canton's sequencer never sees plaintext transactions; it sees only commitments. Combined with FIFO ordering within a batch and user-set max-slippage, sandwich attacks are structurally impossible. This is a meaningful property that no EVM chain can offer.

## 4. Off-Chain Services

### Oracle Keeper

Polls the canonical yield source for each registered underlying. For USYC, this is `https://usyc.hashnote.com/api/price-reports`. Once per business day at the appropriate cadence:

1. Fetches the latest NAV report.
2. Computes the new exchange rate (principal + accruedInterest).
3. Computes the realized APR over the window since the last observation.
4. Exercises `YieldOracleFeed.Publish` with the new observation.
5. Iterates over all active `PyIndexState` contracts for that asset and exercises `RatchetIndex` on each.

If the API source publishes a lower rate than current (rare but possible), the ratchet holds the index flat. The PT holders are protected; the YT holders simply do not accrue claims for that period.

### Batch Sequencer

Runs continuously. Every `BATCH_INTERVAL_MS`:

1. Queries active `PendingSwap` contracts.
2. Filters out expired swaps (deadline < now).
3. Groups by pool key (`issuer:assetCode:maturity`).
4. For each group, exercises `AmmPool.SettleBatch` with up to `MAX_BATCH_SIZE` swap CIDs.
5. Logs throughput metrics.

The sequencer in v1 is a single party (`fission-sequencer`) operated by the Fission operator. Decentralization to a vePENDLE-elected rotating set is a v2 concern.

### Backend API

A Fastify (TypeScript) service that wraps the JSON Ledger API V2. Three core services:

- **MarketsService** — aggregates `AssetRegistry`, `YieldOracleFeed`, `PyMarket`, `PyIndexState`, and `AmmPool` into denormalized Asset and Market views.
- **PortfolioService** — queries SY/PT/YT/LP holdings for a given party and computes claimable yield using the current index.
- **TradingService** — orchestrates mint, swap, claim, and redeem flows. Looks up the user's KYC, finds appropriate input holdings, and submits the corresponding multi-party `Exercise` to the ledger.

Authentication is JWT-based, with tokens issued by Keycloak. The backend authenticates against Canton using a service-account token from the `app-provider-validator` client.

## 5. Frontend

A single-page React application with three primary surfaces:

- **Markets** — the home dashboard. Lists approved underlyings with current rates and APRs, and lists PY markets with implied APYs and pool reserves. Each market row has a `Trade →` button that opens the Trade modal.
- **Portfolio** — the user's positions across SY/PT/YT/LP, grouped by kind. Shows claimable yield on each YT and a `Claim` button. Shows a `Redeem` button on each PT (active post-maturity).
- **About** — the protocol method document. Walks through mechanics, invariants, why-Canton, audits.

The aesthetic deliberately rejects the standard DeFi visual vocabulary (gradients, glassmorphism, neon). Instead it leans into editorial/archival: paper-and-ink palette, Fraunces serif as display, JetBrains Mono for tabular data, hard rules, generous spacing. The intent is to read as an institutional product, not a meme coin launchpad.

## 6. Production Deployment Path

### LocalNet (immediate)

The hackathon submission runs on LocalNet — a self-contained Docker bundle with Super Validator, Validator, Canton Coin wallet, Keycloak, and PQS. Full admin access; iterate at any speed. The bootstrap script seeds USYC and two PY markets.

### DevNet (post-hackathon, ~2 weeks)

Requires a sponsor Super Validator (NODERS for this project), IP allowlisting across the SV network (2–7 day propagation), and an onboarding secret. The application code is identical to LocalNet; only the Ledger API endpoint and Keycloak issuer change.

### TestNet / MainNet (post-audit, ~6–12 weeks)

Requires Featured App approval from the Global Synchronizer Foundation Tokenomics Committee. Prerequisites:

- Daml package audit (Halborn or OpenZeppelin)
- 15+ days of clean DevNet operation
- Documented user base and fraud-prevention controls
- KYC integration with TRM Labs, Elliptic, or 7Trust

Once Featured, the protocol earns Canton Coin proportional to its on-ledger transaction volume per CIP-0104.

## 7. Open Questions

1. **Sequencer trust model.** v1 has a single sequencer. v2 should rotate among vePENDLE-elected operators with staking and slashing.
2. **Curve parameterization.** Constant-product is fine for the demo. Production needs the Pendle V2 logit curve with `scalarRoot` and `initialAnchor` per market.
3. **Cross-collateralization.** PT-USYC could in principle be used as collateral in ACME or Alpend lending. The integration is straightforward but adds counterparty risk that needs analysis.
4. **CC reward stream tokenization.** Synthesizing a transferable claim on a validator's expected mintable rewards is novel and uniquely Canton-native. Worth a v0.2 market.
5. **Negative-yield handling for YT.** The ratchet protects PT, but YT holders simply don't accrue during a negative-yield period. Is this fair, or should some compensation flow from the issuer? Out of scope for v1.
