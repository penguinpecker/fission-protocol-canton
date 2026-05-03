/**
 * Fission Oracle Keeper
 * ----------------------
 * On LocalNet we synthesize a rising-NAV rate that grows continuously at SYNTHETIC_APR.
 * This keeps the demo "live" without a runtime dependency on the Hashnote NAV API,
 * and ensures every poll produces an observation strictly newer than the on-ledger feed.
 *
 * Run: pnpm tsx services/oracle/keeper.ts
 */

import 'dotenv/config';
import { LedgerClient } from '../../backend/src/lib/LedgerClient.js';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);
const ORACLE_PARTY = process.env.ORACLE_PARTY!;
const ASSET_CODE = process.env.ASSET_CODE ?? 'USYC';

const SYNTHETIC_BASE_RATE = Number(process.env.SYNTHETIC_BASE_RATE ?? 1.0);
const SYNTHETIC_APR = Number(process.env.SYNTHETIC_APR ?? 0.05);
const SYNTHETIC_EPOCH_MS = process.env.SYNTHETIC_EPOCH
  ? new Date(process.env.SYNTHETIC_EPOCH).getTime()
  : new Date('2026-01-01T00:00:00Z').getTime();
const MS_PER_YEAR = 365.25 * 86_400 * 1000;

/**
 * Synthesize the current rate as `BASE * exp(APR * years_since_epoch)`.
 * Monotonically increasing, deterministic given wall-clock time.
 */
async function fetchLatestUsycRate(): Promise<{ rate: number; observedAt: string } | null> {
  const now = Date.now();
  const years = (now - SYNTHETIC_EPOCH_MS) / MS_PER_YEAR;
  const rate = SYNTHETIC_BASE_RATE * Math.exp(SYNTHETIC_APR * years);
  return { rate, observedAt: new Date(now).toISOString() };
}

/**
 * Compute annualized rate from successive observations.
 * apr = (rate2/rate1 - 1) * (365 / daysBetween)
 */
function computeApr(rate1: number, rate2: number, daysBetween: number): number {
  if (rate1 <= 0 || daysBetween <= 0) return 0;
  return (rate2 / rate1 - 1) * (365 / daysBetween);
}

let lastRate: number | null = null;
let lastObservedAt: string | null = null;

async function pollAndPublish(client: LedgerClient): Promise<void> {
  const latest = await fetchLatestUsycRate();
  if (!latest) {
    console.log(`[${new Date().toISOString()}] No new USYC data`);
    return;
  }

  if (lastObservedAt === latest.observedAt) {
    // No new data since last poll.
    return;
  }

  const apr =
    lastRate !== null && lastObservedAt !== null
      ? computeApr(
          lastRate,
          latest.rate,
          (new Date(latest.observedAt).getTime() - new Date(lastObservedAt).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 0.05; // bootstrap default

  console.log(
    `[${new Date().toISOString()}] Publishing observation: rate=${latest.rate} apr=${apr.toFixed(4)}`,
  );

  // Look up the existing oracle feed for USYC and exercise Publish on it.
  const feeds = (await client.queryActiveContracts(
    '#fission-oracle:Fission.Oracle:YieldOracleFeed',
    [ORACLE_PARTY],
  )) as Array<{
    contractId: string;
    payload: {
      assetCode: { unAssetCode: string };
      latest: { observedAt: string };
    };
  }>;
  const feed = feeds.find((f) => f.payload.assetCode.unAssetCode === ASSET_CODE) ?? null;

  if (!feed) {
    console.error('Oracle feed not initialized; please bootstrap first');
    return;
  }

  // Skip if our observation is not newer than what's already on-ledger.
  if (new Date(latest.observedAt).getTime() <= new Date(feed.payload.latest.observedAt).getTime()) {
    console.log(
      `[${new Date().toISOString()}] Skipping; observation ${latest.observedAt} not newer than ${feed.payload.latest.observedAt}`,
    );
    return;
  }

  await client.exerciseChoice({
    templateId: '#fission-oracle:Fission.Oracle:YieldOracleFeed',
    contractId: feed.contractId,
    choice: 'Publish',
    argument: {
      observation: {
        assetCode: { unAssetCode: ASSET_CODE },
        exchangeRate: latest.rate.toFixed(8),
        observedAt: latest.observedAt,
        apr: apr.toFixed(8),
      },
    },
    actAs: [ORACLE_PARTY],
  });

  // Publish is consuming and creates a new feed; re-query so RatchetIndex sees the live one.
  const refreshed = (await client.queryActiveContracts(
    '#fission-oracle:Fission.Oracle:YieldOracleFeed',
    [ORACLE_PARTY],
  )) as Array<{ contractId: string; payload: { assetCode: { unAssetCode: string } } }>;
  const newFeed = refreshed.find((f) => f.payload.assetCode.unAssetCode === ASSET_CODE);
  if (!newFeed) {
    console.error('Feed disappeared after Publish; skipping ratchet');
    return;
  }

  // Trigger the ratchet on every active PY market for this asset.
  const indexStates = await client.queryActiveContracts(
    '#fission-py:Fission.PY:PyIndexState',
    [ORACLE_PARTY],
  );

  for (const state of indexStates) {
    if (state.payload.assetCode.unAssetCode !== ASSET_CODE) continue;
    const matTime = new Date(state.payload.maturity.unMaturity).getTime();
    if (matTime <= Date.now()) continue; // matured market

    await client.exerciseChoice({
      templateId: '#fission-py:Fission.PY:PyIndexState',
      contractId: state.contractId,
      choice: 'RatchetIndex',
      argument: { oracleFeedCid: newFeed.contractId },
      actAs: [ORACLE_PARTY],
    });

    console.log(`  ratcheted market with maturity=${state.payload.maturity.unMaturity}`);
  }

  lastRate = latest.rate;
  lastObservedAt = latest.observedAt;
}

async function main(): Promise<void> {
  if (!ORACLE_PARTY) {
    throw new Error('ORACLE_PARTY env var is required');
  }

  const client = new LedgerClient({
    baseUrl: process.env.LEDGER_API_URL ?? 'http://localhost:2975',
    tokenProvider: async () => process.env.ORACLE_JWT_TOKEN!,
    userId: process.env.LEDGER_USER ?? 'ledger-api-user',
  });

  console.log(`Fission Oracle Keeper started`);
  console.log(`  asset: ${ASSET_CODE}`);
  console.log(`  oracle party: ${ORACLE_PARTY}`);
  console.log(`  poll interval: ${POLL_INTERVAL_MS}ms`);

  while (true) {
    try {
      await pollAndPublish(client);
    } catch (err) {
      console.error('Poll cycle failed:', err);
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
