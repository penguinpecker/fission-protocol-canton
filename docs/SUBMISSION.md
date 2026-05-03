# Fission Protocol — HackCanton Season 1 Submission Brief

## One-line

Fission is a Pendle-style yield tokenization protocol built natively in Daml on Canton Network — splitting tokenized real-world assets like USYC into Principal Tokens (PT, fixed yield) and Yield Tokens (YT, variable yield) with privacy and KYC inheritance preserved end-to-end.

## Tracks

- **Track 1 (Real-World Asset & Business Workflows)** — primary
- **Track 2 (Financial Applications)** — secondary

## Problem

Canton Network has $6T+ in tokenized real-world assets — Treasuries, MMFs, repo positions — but no yield-tokenization infrastructure. Pendle on Ethereum cannot serve these assets because they are credential-gated and Ethereum has no native privacy. JPMorgan Onyx and Goldman DAP have the assets but no yield-stripping capability. Fission fills this gap.

## Solution

A Daml-native protocol that:

1. Wraps any yield-bearing CIP-56 asset into a Standardized Yield (SY) token.
2. Atomically splits SY into PT (zero-coupon principal claim) and YT (variable yield claim).
3. Hosts a batch-sequenced AMM for trading PT against SY at any time before maturity.
4. Inherits the underlying's KYC requirements through bilateral certificates verified on every operation.

## Innovation

Three structural advantages over an EVM port:

- **Per-user yield claims are contention-free.** Each YT holder has their own UTXO. Pendle on EVM serializes through a shared state.
- **Flash swaps disappear.** Daml's atomic transactions replace Pendle's callback machinery with a single multi-choice exercise. Bug class eliminated.
- **MEV is structurally impossible.** Canton's sequencer never sees plaintext, so no sandwich attacks, no front-running, no arbitrage extraction.

A fourth innovation is the **batch-sequenced AMM**: rather than a naive on-chain pool that contends on every swap, we split swap intent (`PendingSwap`, parallel) from settlement (`SettleBatch`, batched). 100x throughput improvement on a single pool.

## What's Built

- **6 Daml packages** with full template definitions (~1,200 lines of Daml)
- **End-to-end Daml Script tests** covering mint, ratchet, claim yield, post-maturity redemption, and negative-yield protection
- **Oracle keeper service** that polls Hashnote's USYC NAV API and ratchets the index
- **Batch sequencer** that coalesces swaps into single settlement transactions
- **Fastify backend API** wrapping the JSON Ledger API V2 with JWT auth via Keycloak
- **React + Vite frontend** with editorial/archival aesthetic — Markets dashboard, Portfolio, Trade modal
- **Bootstrap script** that seeds USYC, deploys two PY markets (Dec26 and Mar27), and issues KYC certificates to demo users
- **Apache 2.0 license**, fully open source

## Technology Stack

- Daml SDK 3.4.11 with Daml-LF 1.17 (LF target 2.1)
- CIP-56 Canton Token Standard for SY/PT/YT/LP holdings
- JSON Ledger API V2 with Keycloak OAuth2 / JWT
- TypeScript backend (Fastify, Zod), TypeScript services
- React 18, React Query, Recharts, Zustand
- Docker Compose LocalNet (the official Splice bundle)

## Underlying

**Hashnote/Circle USYC** — a tokenized US Treasury repo product live on Canton mainnet, ~$2.9B AUM, ~4–5% APY. The protocol mocks USYC on LocalNet for the demo using the same on-ledger interface as production. The mainnet path requires institutional party-ID access, which is a governance step rather than a code change.

## Demo Flow

1. Operator registers USYC in the Asset Registry.
2. KYC provider issues an Accredited Investor certificate to Alice.
3. Alice mints 1,000 SY-USYC by depositing the underlying.
4. Alice splits her 1,000 SY atomically into 1,000 PT-USYC-DEC26 and 1,000 YT-USYC-DEC26.
5. Time passes; the oracle keeper publishes a 2.5% accrued yield observation.
6. The keeper ratchets the PyIndexState; Alice claims 25 SY of accrued yield on her YT.
7. At maturity, Alice redeems her PT 1:1 for SY.
8. Bonus: the AMM swap flow trades PT against SY, settled in batches by the sequencer.

The full lifecycle is covered by the `testFullLifecycle` Daml Script in `daml/fission-tests/daml/Fission/Test/EndToEnd.daml`.

## Production Path

1. Submit DARs for security audit (Halborn or OpenZeppelin) — ~4 weeks
2. Deploy to DevNet via NODERS sponsorship — ~1 week
3. Apply to GSF Tokenomics Committee for Featured App status — ~2 weeks
4. Onboard with Hashnote / Circle for production USYC access — variable
5. Production launch with institutional partners

Total: 6–12 weeks to MainNet, contingent on audit and institutional partner timing.

## Repository

`./` — see `README.md` for setup instructions.

## Why this wins

- **Canton-native, not a port.** Every architectural choice exploits Daml's UTXO model, multi-party signing, and selective disclosure.
- **A real product on a real asset.** Not a toy. USYC is live on Canton mainnet today.
- **Composable.** Designed so that Goldman DAP, Broadridge DLR, BNY tokenized MMFs, and DTCC Treasuries can be added as adapters without modifying the core protocol.
- **Open source.** Apache 2.0. No proprietary lock-in. Could realistically attract institutional partners post-hackathon.
- **A genuine improvement on Pendle.** Not just a Canton replica — the contention-free yield claims, the disappearance of flash swaps, the MEV resistance, and the batch-sequenced AMM are all material improvements over the EVM original.
