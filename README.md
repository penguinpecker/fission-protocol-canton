# Fission Protocol

> Yield tokenization for tokenized real-world assets on Canton Network.
> Built natively in Daml. Submitted to HackCanton Season 1.

Fission is a Pendle-style yield tokenization protocol designed for the institutional asset base of Canton — tokenized US Treasuries, money-market funds, and yield-bearing repo positions. It splits a yield-bearing asset into a Principal Token (PT) and a Yield Token (YT), enabling fixed-rate fixed-income products and yield speculation, all while inheriting the credentialing and selective-disclosure properties of the underlying.

The first underlying is **Hashnote/Circle USYC** — a tokenized US Treasury repo product live on Canton mainnet.

## Why on Canton

Three structural advantages over a Pendle deployment on Ethereum:

1. **Per-user pull-based yield claims are contention-free.** Each YT holder's position is its own UTXO. The shared mutable state — the PY-Index — is updated once per oracle epoch, not on every claim. Ethereum's account model forces serialization that Daml's UTXO model avoids.
2. **Flash swaps disappear entirely.** Daml's atomic-transaction composition replaces Pendle's callback dance with a single multi-choice exercise. Mint, swap, and settle in one transaction. One bug class eliminated.
3. **MEV is structurally impossible.** The Canton sequencer never sees plaintext transactions; selective disclosure means an institutional PT holder can take a billion-dollar position without revealing it to the rest of the network.

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Frontend (React + Vite)                     │
│   markets · portfolio · trade · about                                │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ JSON / JWT
┌────────────────────────────▼─────────────────────────────────────────┐
│                    Backend API (Fastify, TypeScript)                 │
│   /api/assets · /api/markets · /api/portfolio · /api/trade/*         │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ Canton JSON Ledger API V2
┌────────────────────────────▼─────────────────────────────────────────┐
│                    Canton Participant Node                           │
│   Daml packages: AssetRegistry · Credential · SY · PY · Oracle · AMM │
└────────┬────────────────────────┬────────────────────────────────────┘
         │                        │
         │ ratchet/publish         │ batch settle
┌────────▼──────────┐  ┌─────────▼──────────────┐
│  Oracle Keeper    │  │  Batch Sequencer       │
│  (USYC NAV API →  │  │  (PendingSwap →        │
│   PyIndexState)   │  │   AmmPool.SettleBatch) │
└───────────────────┘  └────────────────────────┘
```

## Repository Layout

```
fission/
├── daml/                          Six Daml packages (the on-ledger logic)
│   ├── fission-asset-registry/    Approved underlying registry
│   ├── fission-credential/        KYC certificates with bilateral signing
│   ├── fission-sy/                Standardized Yield wrapper
│   ├── fission-py/                PT/YT split + PY-Index ratchet
│   ├── fission-oracle/            Yield observations & feeds
│   ├── fission-amm/               Batch-sequenced AMM
│   └── fission-tests/             End-to-end Daml Script tests
├── backend/                       Fastify API (TypeScript)
│   ├── src/lib/                   LedgerClient (JSON Ledger API V2 wrapper)
│   ├── src/services/              markets, portfolio, trading
│   ├── src/routes/                REST endpoints
│   └── src/middleware/            JWT auth
├── frontend/                      React + Vite + Recharts
│   ├── src/pages/                 Markets, Portfolio, About
│   ├── src/components/            Header, TradeModal, Sparkline, …
│   └── src/styles/                Editorial/archival design system
├── services/
│   ├── oracle/                    Hashnote-NAV-polling keeper
│   └── sequencer/                 Batch swap settlement
├── scripts/
│   └── bootstrap.ts               One-shot LocalNet seeding
├── docker-compose.fission.yml     Runtime side-cars (joins splice_default)
└── Makefile                       The dev workflow
```

## Getting Started (LocalNet)

**Prerequisites**: Docker (with compose v2), Node.js 22+, Daml SDK 3.4.11 ([install](https://docs.daml.com/getting-started/installation.html)), `make`, `curl`, `jq`.

### 1. Bring up Splice LocalNet

LocalNet is the official Digital Asset bundle that runs a full Canton stack on your machine: Super Validator, Validator, Canton Coin wallet, Keycloak, and the Participant Query Store.

```bash
# Download the latest Splice LocalNet release:
#   https://github.com/hyperledger-labs/splice/releases
# Extract into ./splice-bundle/

make localnet-up
```

You should see the Wallet UI at `http://wallet.localhost:2000` and the Ledger API at `http://localhost:2975/livez`.

### 2. Build the Daml packages

```bash
make daml-build
```

This compiles all seven packages and produces a `.dar` for each in `daml/<pkg>/.daml/dist/`.

### 3. Run the end-to-end test

```bash
make daml-test
```

The test exercises the full lifecycle: register USYC, issue KYC, mint SY, split into PT+YT, ratchet the index, claim yield, redeem at maturity. It also asserts the negative-yield ratchet protection.

### 4. Bootstrap the deployment

```bash
make install
make bootstrap
```

This uploads all DARs to the participant, allocates the operational parties (operator, custodian, oracle, sequencer, KYC provider, alice, bob), creates the AssetRegistry with USYC, deploys SY and two PY markets (Dec 2026 and Mar 2027), and issues KYC certificates to the demo users.

The script prints the allocated party IDs at the end. **Copy them into the `.env` files**:

```bash
cp backend/.env.example backend/.env
cp services/oracle/.env.example services/oracle/.env
cp services/sequencer/.env.example services/sequencer/.env
cp frontend/.env.example frontend/.env

# Then edit each .env with the party IDs from the bootstrap output.
```

### 5. Run the application

```bash
# Run all four services concurrently:
make dev

# Or individually in separate terminals:
make dev-backend     # http://localhost:3001
make dev-frontend    # http://localhost:5173
make dev-oracle
make dev-sequencer
```

Visit `http://localhost:5173`, click "Connect Wallet", and paste in either Alice's or Bob's party ID with a JWT minted from Keycloak.

## How a swap works end-to-end

1. User fills in the Trade modal in the frontend → POST `/api/trade/swap`.
2. Backend resolves the user's party from JWT, finds the relevant SY/PT holding and KYC cert, then exercises `AmmPool.SubmitSwap` on the ledger.
3. A `PendingSwap` contract is created. **No pool state is touched yet.** This is the parallelism trick.
4. The sequencer service polls every 3 seconds, finds all pending swaps for each pool, and exercises `AmmPool.SettleBatch` once per pool.
5. SettleBatch archives the pending contracts and updates the pool reserves in a single transaction.
6. The frontend's React Query cache invalidates and re-fetches the portfolio.

A naive on-chain pool would serialize step 5 across all swaps. With the batch sequencer, 100 swaps become 1 settlement transaction.

## Submission Strategy

**Track 1 (RWA & Business Workflows)** — primary submission. The narrative: tokenizing the yield of a real-world asset (USYC) for institutional fixed-income use cases. Demonstrate the full lifecycle: a fund manager wraps a tokenized treasury, sells PT to a pension fund seeking fixed yield, sells YT to a hedge fund speculating on rates, all with selective disclosure of position sizes.

**Track 2 (DeFi)** — secondary submission if multi-track entries are permitted. Frame: the YT-against-SY AMM as a fixed-rate trading venue. Highlight: the batch sequencer and structural MEV-resistance.

## Design Decisions

- **Daml-native, not a Solidity port.** We use CIP-56 (Canton Token Standard) Holdings for SY/PT/YT/LP, Daml Finance Claims for instrument economics, and the propose-accept pattern for KYC. Nothing is ported from Pendle's EVM contracts; this is rebuilt to fit Canton's UTXO and privacy model.
- **PY-Index Ratchet on a singleton.** One `PyIndexState` per (asset, maturity). Non-consuming `GetCurrentIndex` for parallel reads; consuming `RatchetIndex` only on epoch updates. This is structurally faster than Pendle's EVM equivalent.
- **Batch sequencer for the AMM.** Pendle V2's Market is a single contract that serializes swaps. We split intent (`PendingSwap`, parallel) from settlement (`SettleBatch`, batched), giving us 100x throughput on a single pool.
- **No fancy curve math in the on-ledger code.** The AMM uses `x*y=k` for clarity. Production should use Pendle's logit curve with `rateScalar` and `initialAnchor`; the wiring is in place.

## Audits & Production

- **Daml package audit** — planned, Halborn or OpenZeppelin
- **Oracle integrity review** — planned
- **DevNet operation** — planned via NODERS Validator
- **Featured App approval** — pending, GSF Tokenomics Committee

## License

Apache-2.0. See `LICENSE`.
