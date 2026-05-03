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
