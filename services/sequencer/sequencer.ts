/**
 * Fission Batch Sequencer
 * ------------------------
 * Reads up to N PendingSwap contracts every BATCH_INTERVAL_MS, and submits a single
 * AmmPool.SettleBatch transaction to the Canton ledger.
 *
 * This is what gives the AMM throughput: instead of N parallel pool updates fighting
 * over a single contract, we coalesce N swaps into one settlement transaction.
 *
 * Run: pnpm tsx services/sequencer/sequencer.ts
 */

import 'dotenv/config';
import { LedgerClient } from '../../backend/src/lib/LedgerClient.js';

const SEQUENCER_PARTY = process.env.SEQUENCER_PARTY!;
const BATCH_INTERVAL_MS = Number(process.env.BATCH_INTERVAL_MS ?? 3_000);
const MAX_BATCH_SIZE = Number(process.env.MAX_BATCH_SIZE ?? 100);

interface PendingSwapContract {
  contractId: string;
  payload: {
    issuer: string;
    trader: string;
    poolId: { assetCode: string; maturity: string };
    kind: 'SyToPt' | 'PtToSy';
    amountIn: string;
    minAmountOut: string;
    deadline: string;
  };
}

interface PoolGroup {
  poolKey: string;
  issuer: string;
  poolId: { assetCode: string; maturity: string };
  swaps: PendingSwapContract[];
}

/**
 * Group pending swaps by pool so we settle one batch per pool.
 */
function groupByPool(swaps: PendingSwapContract[]): PoolGroup[] {
  const map = new Map<string, PoolGroup>();
  for (const swap of swaps) {
    const key = `${swap.payload.issuer}:${swap.payload.poolId.assetCode}:${swap.payload.poolId.maturity}`;
    let g = map.get(key);
    if (!g) {
      g = {
        poolKey: key,
        issuer: swap.payload.issuer,
        poolId: swap.payload.poolId,
        swaps: [],
      };
      map.set(key, g);
    }
    g.swaps.push(swap);
  }
  return Array.from(map.values());
}

async function settleBatch(client: LedgerClient, group: PoolGroup): Promise<void> {
  const swapsToSettle = group.swaps.slice(0, MAX_BATCH_SIZE);
  if (swapsToSettle.length === 0) return;

  console.log(
    `[${new Date().toISOString()}] Settling pool ${group.poolKey} with ${swapsToSettle.length} swaps`,
  );

  // Look up the AmmPool for this group.
  const pool = await client.queryContractByKey('#fission-amm:Fission.AMM:AmmPool', {
    issuer: group.issuer,
    poolId: group.poolId,
  }, [SEQUENCER_PARTY]);
  if (!pool) {
    console.error(`Pool not found for ${group.poolKey}`);
    return;
  }

  // SettleBatch archives each PendingSwap; PendingSwap's signatories are
  // trader + custodian, so the custodian must co-authorize. operator is added
  // to readAs because the choice fetches the AmmPool / index state.
  const custodian = process.env.CUSTODIAN_PARTY;
  const operator = process.env.OPERATOR_PARTY;
  if (!custodian) throw new Error('CUSTODIAN_PARTY env var required for sequencer');
  await client.exerciseChoice({
    templateId: '#fission-amm:Fission.AMM:AmmPool',
    contractId: pool.contractId,
    choice: 'SettleBatch',
    argument: {
      pendingCids: swapsToSettle.map((s) => s.contractId),
    },
    actAs: [SEQUENCER_PARTY, custodian],
    readAs: operator
      ? [SEQUENCER_PARTY, custodian, operator]
      : [SEQUENCER_PARTY, custodian],
  });
}

async function tick(client: LedgerClient): Promise<void> {
  const swaps = (await client.queryActiveContracts(
    '#fission-amm:Fission.AMM:PendingSwap',
    [SEQUENCER_PARTY],
  )) as PendingSwapContract[];

  if (swaps.length === 0) return;

  // Filter expired ones; let them be cancelled by traders themselves.
  const now = Date.now();
  const live = swaps.filter((s) => new Date(s.payload.deadline).getTime() > now);

  const groups = groupByPool(live);
  for (const group of groups) {
    try {
      await settleBatch(client, group);
    } catch (err) {
      console.error(`Failed to settle ${group.poolKey}:`, err);
    }
  }
}

async function main(): Promise<void> {
  if (!SEQUENCER_PARTY) throw new Error('SEQUENCER_PARTY env var is required');

  const client = new LedgerClient({
    baseUrl: process.env.LEDGER_API_URL ?? 'http://localhost:2975',
    tokenProvider: async () => process.env.SEQUENCER_JWT_TOKEN!,
    userId: process.env.LEDGER_USER ?? 'ledger-api-user',
  });

  console.log('Fission Batch Sequencer started');
  console.log(`  party: ${SEQUENCER_PARTY}`);
  console.log(`  batch interval: ${BATCH_INTERVAL_MS}ms, max size: ${MAX_BATCH_SIZE}`);

  while (true) {
    try {
      await tick(client);
    } catch (err) {
      console.error('Tick failed:', err);
    }
    await new Promise((r) => setTimeout(r, BATCH_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
