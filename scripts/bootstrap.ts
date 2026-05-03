/**
 * Fission Bootstrap Script
 * ------------------------
 * One-shot setup that takes a freshly-started LocalNet and brings up the full Fission
 * deployment: parties, asset registry, oracle feed, SY/PY markets, and an initial AMM pool.
 *
 * Run after `make localnet-up` and a successful `daml build` of all packages:
 *   pnpm tsx scripts/bootstrap.ts
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { LedgerClient } from '../backend/src/lib/LedgerClient.js';

const LEDGER_API_URL = process.env.LEDGER_API_URL ?? 'http://localhost:2975';
const LEDGER_HMAC_SECRET = process.env.LEDGER_HMAC_SECRET ?? 'unsafe';
const LEDGER_AUDIENCE = process.env.LEDGER_AUDIENCE ?? 'https://canton.network.global';
const LEDGER_USER = process.env.LEDGER_USER ?? 'ledger-api-user';

function b64u(input: string | Buffer): string {
  return Buffer.from(input as never).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function mintToken(sub = LEDGER_USER): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ sub, aud: LEDGER_AUDIENCE, scope: 'daml_ledger_api' }));
  const sig = crypto.createHmac('sha256', LEDGER_HMAC_SECRET).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64u(sig)}`;
}

async function getToken(): Promise<string> {
  return mintToken();
}

async function main(): Promise<void> {
  console.log('Fission bootstrap starting...');
  console.log(`  ledger API: ${LEDGER_API_URL}`);

  const ledger = new LedgerClient({
    baseUrl: LEDGER_API_URL,
    tokenProvider: getToken,
    userId: LEDGER_USER,
  });

  if (!(await ledger.ping())) {
    throw new Error('LocalNet is not reachable. Did you `make localnet-up`?');
  }

  async function grantActAs(party: string): Promise<void> {
    const res = await fetch(`${LEDGER_API_URL}/v2/users/${LEDGER_USER}/rights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await getToken()}`,
      },
      body: JSON.stringify({
        userId: LEDGER_USER,
        rights: [{ kind: { CanActAs: { value: { party } } } }],
      }),
    });
    if (!res.ok) throw new Error(`grantActAs failed: ${res.status} ${await res.text()}`);
  }

  async function listContracts(templateId: string, parties: string[]): Promise<Array<{
    contractId: string;
    templateId: string;
    payload: Record<string, unknown>;
  }>> {
    const offsetRes = await fetch(`${LEDGER_API_URL}/v2/state/ledger-end`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
    });
    const offset = offsetRes.ok ? ((await offsetRes.json()) as { offset: number }).offset : 0;
    const res = await fetch(`${LEDGER_API_URL}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await getToken()}`,
      },
      body: JSON.stringify({
        filter: {
          filtersByParty: Object.fromEntries(parties.map((p) => [p, {
            cumulative: [{
              identifierFilter: {
                TemplateFilter: { value: { templateId, includeCreatedEventBlob: false } },
              },
            }],
          }])),
        },
        verbose: false,
        activeAtOffset: offset,
      }),
    });
    if (!res.ok) throw new Error(`active-contracts failed: ${res.status}`);
    const data = (await res.json()) as Array<{
      contractEntry?: {
        JsActiveContract?: {
          createdEvent: { contractId: string; templateId: string; createArgument: Record<string, unknown> };
        };
      };
    }>;
    return data
      .map((row) => row.contractEntry?.JsActiveContract?.createdEvent)
      .filter((e): e is NonNullable<typeof e> => !!e)
      .map((e) => ({ contractId: e.contractId, templateId: e.templateId, payload: e.createArgument }));
  }

  async function listParties(): Promise<string[]> {
    const res = await fetch(`${LEDGER_API_URL}/v2/parties`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
    });
    if (!res.ok) throw new Error(`list parties failed: ${res.status}`);
    const data = (await res.json()) as { partyDetails: Array<{ party: string }> };
    return data.partyDetails.map((p) => p.party);
  }

  async function allocateAndGrant(hint: string, displayName: string): Promise<{ party: string }> {
    const existing = (await listParties()).find((p) => p.startsWith(`${hint}::`));
    const p = existing ? { party: existing } : await ledger.allocateParty(hint, displayName);
    await grantActAs(p.party);
    return p;
  }

  async function ensureUser(userId: string, primaryParty: string): Promise<void> {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getToken()}`,
    };
    const create = await fetch(`${LEDGER_API_URL}/v2/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user: { id: userId, primaryParty },
        rights: [{ kind: { CanActAs: { value: { party: primaryParty } } } }],
      }),
    });
    if (!create.ok && create.status !== 409) {
      // Already-exists from the participant returns INVALID_ARGUMENT/AlreadyExists; ignore.
      const body = await create.text();
      if (!body.includes('ALREADY_EXISTS')) {
        throw new Error(`create user ${userId} failed: ${create.status} ${body}`);
      }
    }
  }

  // ---------------------------------------------------------------
  // 1. Allocate parties
  // ---------------------------------------------------------------
  console.log('\n[1/6] Allocating parties (with CanActAs grants)...');
  const operator    = await allocateAndGrant('fission-operator', 'Fission Operator');
  const custodian   = await allocateAndGrant('fission-custodian', 'Fission Custodian');
  const oracle      = await allocateAndGrant('fission-oracle', 'Fission Oracle Keeper');
  const sequencer   = await allocateAndGrant('fission-sequencer', 'Fission Sequencer');
  const kycProvider = await allocateAndGrant('trm-labs', 'TRM Labs (KYC)');
  const publicParty = await allocateAndGrant('fission-public', 'Public Observer');
  const alice       = await allocateAndGrant('alice', 'Alice (Demo Trader)');
  const bob         = await allocateAndGrant('bob', 'Bob (Demo LP)');

  // Create user accounts so the frontend can resolve userId -> party.
  await ensureUser('alice', alice.party);
  await ensureUser('bob', bob.party);

  console.log(`  operator:    ${operator.party}`);
  console.log(`  custodian:   ${custodian.party}`);
  console.log(`  oracle:      ${oracle.party}`);
  console.log(`  sequencer:   ${sequencer.party}`);
  console.log(`  kycProvider: ${kycProvider.party}`);
  console.log(`  alice:       ${alice.party}`);
  console.log(`  bob:         ${bob.party}`);

  // ---------------------------------------------------------------
  // 2. Create the AssetRegistry with USYC
  // ---------------------------------------------------------------
  console.log('\n[2/6] Creating AssetRegistry...');
  const registry = await ledger.createContract({
    templateId: '#fission-asset-registry:Fission.Asset.Registry:AssetRegistry',
    argument: {
      operator: operator.party,
      assets: [],
      public: publicParty.party,
    },
    actAs: [operator.party],
  }) as { events: Array<{ created: { contractId: string } }> };

  // List USYC.
  const usycCfg = {
    code: { unAssetCode: 'USYC' },
    displayName: 'Hashnote/Circle US Yield Coin',
    yieldKind: 'RisingNav',
    credentialClass: 'AccreditedInvestor',
    oracleParty: oracle.party,
    custodian: custodian.party,
    initialIndex: '1.0',
    decimals: '6',
  };

  const registryCid = (registry.events[0]?.created?.contractId);
  if (!registryCid) throw new Error('AssetRegistry creation failed');
  console.log(`  AssetRegistry @ ${registryCid}`);

  await ledger.exerciseChoice({
    templateId: '#fission-asset-registry:Fission.Asset.Registry:AssetRegistry',
    contractId: registryCid,
    choice: 'ListAsset',
    argument: { cfg: usycCfg },
    actAs: [operator.party],
  });
  console.log('  listed USYC');

  // ---------------------------------------------------------------
  // 3. Initialize the YieldOracleFeed for USYC
  // ---------------------------------------------------------------
  console.log('\n[3/6] Bootstrapping oracle feed...');
  const now = new Date().toISOString();
  await ledger.createContract({
    templateId: '#fission-oracle:Fission.Oracle:YieldOracleFeed',
    argument: {
      oracleParty: oracle.party,
      assetCode: { unAssetCode: 'USYC' },
      latest: {
        assetCode: { unAssetCode: 'USYC' },
        exchangeRate: '1.000000',
        observedAt: now,
        apr: '0.0485',
      },
      history: [],
      public: publicParty.party,
    },
    actAs: [oracle.party],
  });
  console.log('  oracle feed initialized at rate=1.0, apr=4.85%');

  // ---------------------------------------------------------------
  // 4. Deploy SY instrument for USYC
  // ---------------------------------------------------------------
  console.log('\n[4/6] Deploying SY-USYC instrument...');
  await ledger.createContract({
    templateId: '#fission-sy:Fission.SY:SyInstrument',
    argument: {
      issuer: operator.party,
      instrumentId: { unInstrumentId: 'SY-USYC' },
      assetCode: { unAssetCode: 'USYC' },
      custodian: custodian.party,
      oracleParty: oracle.party,
      requiredTier: 'AccreditedInvestor',
      decimals: '6',
      public: publicParty.party,
    },
    actAs: [operator.party],
  });
  console.log('  SY-USYC instrument live');

  // ---------------------------------------------------------------
  // 5. Deploy two PY markets: Dec 2026 and Mar 2027
  // ---------------------------------------------------------------
  console.log('\n[5/6] Deploying PY markets...');
  const maturities = [
    { label: 'DEC26', iso: '2026-12-31T16:00:00.000Z' },
    { label: 'MAR27', iso: '2027-03-31T16:00:00.000Z' },
  ];

  for (const m of maturities) {
    await ledger.createContract({
      templateId: '#fission-py:Fission.PY:PyMarket',
      argument: {
        issuer: operator.party,
        assetCode: { unAssetCode: 'USYC' },
        maturity: { unMaturity: m.iso },
        custodian: custodian.party,
        oracleParty: oracle.party,
        requiredTier: 'AccreditedInvestor',
        syInstrumentId: { unInstrumentId: 'SY-USYC' },
        ptInstrumentId: { unInstrumentId: `PT-USYC-${m.label}` },
        ytInstrumentId: { unInstrumentId: `YT-USYC-${m.label}` },
        public: publicParty.party,
      },
      actAs: [operator.party],
    });

    await ledger.createContract({
      templateId: '#fission-py:Fission.PY:PyIndexState',
      argument: {
        issuer: operator.party,
        oracleParty: oracle.party,
        assetCode: { unAssetCode: 'USYC' },
        maturity: { unMaturity: m.iso },
        currentIndex: '1.000000',
        lastUpdated: now,
        public: publicParty.party,
      },
      actAs: [operator.party],
    });

    console.log(`  USYC-${m.label} market deployed`);
  }

  // ---------------------------------------------------------------
  // 6. Issue KYC certificates to demo users
  // ---------------------------------------------------------------
  console.log('\n[6/6] Issuing KYC certificates to demo users...');
  const oneYear = new Date(Date.now() + 365 * 86_400_000).toISOString();

  for (const user of [alice, bob]) {
    const proposal = (await ledger.createContract({
      templateId: '#fission-credential:Fission.Credential:KycCertificateProposal',
      argument: {
        kycProvider: kycProvider.party,
        user: user.party,
        tier: 'AccreditedInvestor',
        jurisdiction: { unJurisdiction: 'US-Q' },
        expiresAt: oneYear,
        sanctionsCheckedAt: now,
        custodians: [custodian.party],
      },
      actAs: [kycProvider.party],
    })) as { events: Array<{ created: { contractId: string } }> };

    const proposalCid = proposal.events[0]?.created?.contractId;
    if (!proposalCid) throw new Error('KYC proposal failed');

    await ledger.exerciseChoice({
      templateId: '#fission-credential:Fission.Credential:KycCertificateProposal',
      contractId: proposalCid,
      choice: 'AcceptCertificate',
      argument: {},
      actAs: [user.party],
    });
    console.log(`  KYC issued to ${user.party.split('::')[0]}`);
  }

  // ---------------------------------------------------------------
  // 7. Seed Alice and Bob with SY-USYC (so the demo trading flow has stock)
  // ---------------------------------------------------------------
  console.log('\n[7/7] Seeding demo users with SY-USYC...');

  // Find the SyInstrument cid for SY-USYC.
  const syInstruments = (await listContracts(
    '#fission-sy:Fission.SY:SyInstrument',
    [operator.party],
  )) as Array<{
    contractId: string;
    payload: { instrumentId: { unInstrumentId: string } };
  }>;
  const syUsyc = syInstruments.find((s) => s.payload.instrumentId.unInstrumentId === 'SY-USYC');
  if (!syUsyc) throw new Error('SY-USYC instrument not found after deploy');

  for (const user of [alice, bob]) {
    // Find the user's KYC certificate.
    const certs = (await listContracts(
      '#fission-credential:Fission.Credential:KycCertificate',
      [user.party],
    )) as Array<{ contractId: string; payload: { user: string } }>;
    const cert = certs.find((c) => c.payload.user === user.party);
    if (!cert) {
      console.error(`  no KYC cert found for ${user.party.split('::')[0]}; skipping seed`);
      continue;
    }

    // Skip if user already has an SY holding (idempotent).
    const existing = (await listContracts(
      '#fission-sy:Fission.SY:SyHolding',
      [user.party],
    )) as Array<{ payload: { instrumentId: { unInstrumentId: string } } }>;
    if (existing.some((h) => h.payload.instrumentId.unInstrumentId === 'SY-USYC')) {
      console.log(`  ${user.party.split('::')[0]} already has SY-USYC; skipping`);
      continue;
    }

    await ledger.exerciseChoice({
      templateId: '#fission-sy:Fission.SY:SyInstrument',
      contractId: syUsyc.contractId,
      choice: 'MintSy',
      argument: {
        owner: user.party,
        amount: '1000.0',
        kycCertCid: cert.contractId,
      },
      actAs: [user.party, custodian.party],
    });
    console.log(`  minted 1,000 SY-USYC to ${user.party.split('::')[0]}`);
  }

  // ---------------------------------------------------------------
  // 8. Deploy AmmPool per market and seed initial liquidity from Alice
  // ---------------------------------------------------------------
  console.log('\n[8/8] Deploying AmmPool + seeding liquidity...');

  async function findCert(p: { party: string }): Promise<{ contractId: string }> {
    const certs = (await listContracts(
      '#fission-credential:Fission.Credential:KycCertificate',
      [p.party],
    )) as Array<{ contractId: string; payload: { user: string } }>;
    const cert = certs.find((c) => c.payload.user === p.party);
    if (!cert) throw new Error(`KYC cert missing for ${p.party.split('::')[0]}`);
    return cert;
  }

  // Locate PyMarket and PyIndexState contracts per maturity.
  const pyMarkets = (await listContracts(
    '#fission-py:Fission.PY:PyMarket',
    [operator.party],
  )) as Array<{
    contractId: string;
    payload: {
      assetCode: { unAssetCode: string };
      maturity: { unMaturity: string };
    };
  }>;
  const pyIndexStates = (await listContracts(
    '#fission-py:Fission.PY:PyIndexState',
    [operator.party],
  )) as Array<{
    contractId: string;
    payload: {
      assetCode: { unAssetCode: string };
      maturity: { unMaturity: string };
    };
  }>;

  const sameMaturity = (a: string, b: string): boolean =>
    new Date(a).getTime() === new Date(b).getTime();

  // Alternate LPs across markets so neither runs out of SY.
  const lpForMaturity: Record<string, { party: string }> = {
    DEC26: alice,
    MAR27: bob,
  };

  for (const m of maturities) {
    const lp = lpForMaturity[m.label];
    const lpCert = await findCert(lp);
    const market = pyMarkets.find(
      (p) =>
        p.payload.assetCode.unAssetCode === 'USYC' &&
        sameMaturity(p.payload.maturity.unMaturity, m.iso),
    );
    const indexState = pyIndexStates.find(
      (p) =>
        p.payload.assetCode.unAssetCode === 'USYC' &&
        sameMaturity(p.payload.maturity.unMaturity, m.iso),
    );
    if (!market || !indexState) {
      console.error(`  market or index state missing for ${m.label}; skipping pool`);
      continue;
    }

    // Idempotency: skip if a pool already exists for this maturity.
    const existingPools = (await listContracts(
      '#fission-amm:Fission.AMM:AmmPool',
      [operator.party],
    )) as Array<{
      contractId: string;
      payload: {
        poolId: { assetCode: { unAssetCode: string }; maturity: { unMaturity: string } };
        syReserve: string;
        ptReserve: string;
      };
    }>;
    let pool = existingPools.find(
      (p) =>
        p.payload.poolId.assetCode.unAssetCode === 'USYC' &&
        sameMaturity(p.payload.poolId.maturity.unMaturity, m.iso),
    );

    if (!pool) {
      const poolRes = (await ledger.createContract({
        templateId: '#fission-amm:Fission.AMM:AmmPool',
        argument: {
          issuer: operator.party,
          sequencer: sequencer.party,
          poolId: {
            assetCode: { unAssetCode: 'USYC' },
            maturity: { unMaturity: m.iso },
          },
          custodian: custodian.party,
          requiredTier: 'AccreditedInvestor',
          syInstrumentId: { unInstrumentId: 'SY-USYC' },
          ptInstrumentId: { unInstrumentId: `PT-USYC-${m.label}` },
          syReserve: '0.0',
          ptReserve: '0.0',
          totalLpShares: '0.0',
          scalarRoot: '50.0',
          initialAnchor: '1.0',
          feeRate: '0.001',
          lastSettledAt: now,
          public: publicParty.party,
        },
        actAs: [operator.party],
      })) as {
        events: Array<{ created?: { contractId: string; templateId: string } }>;
      };
      const newCid = poolRes.events.find((e) => e.created)?.created?.contractId;
      if (!newCid) throw new Error(`AmmPool create returned no contractId for ${m.label}`);
      console.log(`  deployed AmmPool USYC-${m.label}`);
      pool = {
        contractId: newCid,
        payload: {
          poolId: { assetCode: { unAssetCode: 'USYC' }, maturity: { unMaturity: m.iso } },
          syReserve: '0.0',
          ptReserve: '0.0',
        },
      };
    } else {
      console.log(`  AmmPool USYC-${m.label} already exists`);
    }

    // Skip liquidity seeding if pool already has reserves.
    if (parseFloat(pool.payload.syReserve) > 0 || parseFloat(pool.payload.ptReserve) > 0) {
      console.log(`  USYC-${m.label} pool already seeded`);
      continue;
    }

    const lpName = lp.party.split('::')[0];
    // Find LP's SY-USYC holding.
    const lpSyHoldings = (await listContracts(
      '#fission-sy:Fission.SY:SyHolding',
      [lp.party],
    )) as Array<{
      contractId: string;
      payload: { instrumentId: { unInstrumentId: string }; amount: string };
    }>;
    const lpSy = lpSyHoldings.find((h) => h.payload.instrumentId.unInstrumentId === 'SY-USYC');
    if (!lpSy || parseFloat(lpSy.payload.amount) < 500) {
      console.error(`  ${lpName} has insufficient SY (need ≥500); skipping ${m.label} liquidity seed`);
      continue;
    }

    // LP splits 500 SY → 500 PT + 500 YT for this maturity.
    // readAs operator: PyIndexState's only observers are oracle+public; we need
    // operator (signatory) in readAs so MintPY can fetch indexStateCid.
    const mintRes = (await ledger.exerciseChoice({
      templateId: '#fission-py:Fission.PY:PyMarket',
      contractId: market.contractId,
      choice: 'MintPY',
      argument: {
        owner: lp.party,
        syHoldingCid: lpSy.contractId,
        amount: '500.0',
        kycCertCid: lpCert.contractId,
        indexStateCid: indexState.contractId,
      },
      actAs: [lp.party, custodian.party],
      readAs: [lp.party, custodian.party, operator.party, oracle.party],
    })) as {
      events: Array<{ created?: { contractId: string; templateId: string } }>;
    };
    const ptEvt = mintRes.events.find((e) => e.created?.templateId.includes(':PtHolding'));
    const ptCid = ptEvt?.created?.contractId;
    if (!ptCid) throw new Error(`PT not created for ${m.label}`);
    console.log(`  ${lpName} split 500 SY → 500 PT-USYC-${m.label} + 500 YT-USYC-${m.label}`);

    // LP now has residual SY + 500 PT + 500 YT. Provide 250 SY + 250 PT.
    const lpSyAfter = (await listContracts(
      '#fission-sy:Fission.SY:SyHolding',
      [lp.party],
    )) as Array<{
      contractId: string;
      payload: { instrumentId: { unInstrumentId: string }; amount: string };
    }>;
    const syToProvide = lpSyAfter.find(
      (h) => h.payload.instrumentId.unInstrumentId === 'SY-USYC' && parseFloat(h.payload.amount) >= 250,
    );
    if (!syToProvide) {
      console.error(`  ${lpName} has no SY ≥250 to provide for ${m.label}; skipping`);
      continue;
    }

    await ledger.exerciseChoice({
      templateId: '#fission-amm:Fission.AMM:AmmPool',
      contractId: pool.contractId,
      choice: 'ProvideLiquidity',
      argument: {
        provider: lp.party,
        syCid: syToProvide.contractId,
        ptCid,
        syAmount: '250.0',
        ptAmount: '250.0',
        kycCertCid: lpCert.contractId,
      },
      actAs: [lp.party, custodian.party],
    });
    console.log(`  ${lpName} provided 250 SY + 250 PT to USYC-${m.label} pool`);
  }

  // ---------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------
  const envContent = `# Generated by scripts/bootstrap.ts on ${new Date().toISOString()}
# Source these into backend/.env, services/*/.env, etc.
OPERATOR_PARTY=${operator.party}
CUSTODIAN_PARTY=${custodian.party}
ORACLE_PARTY=${oracle.party}
SEQUENCER_PARTY=${sequencer.party}
KYC_PROVIDER_PARTY=${kycProvider.party}
PUBLIC_PARTY=${publicParty.party}
DEMO_ALICE=${alice.party}
DEMO_BOB=${bob.party}
`;

  writeFileSync('.env.bootstrap', envContent);

  console.log('\n✓ Bootstrap complete.');
  console.log('\nParty IDs written to .env.bootstrap. Source into your service .envs:');
  console.log('  cat .env.bootstrap >> backend/.env');
  console.log('  cat .env.bootstrap >> services/oracle/.env');
  console.log('  cat .env.bootstrap >> services/sequencer/.env');
  console.log('\nDemo credentials for the frontend connect modal:');
  console.log(`  Alice: ${alice.party}`);
  console.log(`  Bob:   ${bob.party}`);
}

main().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
