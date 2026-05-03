import 'dotenv/config';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { LedgerClient } from './lib/LedgerClient.js';
import { MarketsService } from './services/markets.js';
import { PortfolioService } from './services/portfolio.js';
import { TradingService } from './services/trading.js';
import { registerMarketsRoutes } from './routes/markets.js';
import { registerPortfolioRoutes } from './routes/portfolio.js';
import { registerTradingRoutes } from './routes/trading.js';
import { registerAuthRoutes } from './routes/auth.js';

function b64u(input: string | Buffer): string {
  return Buffer.from(input as never).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function mintLedgerToken(sub: string, audience: string, secret: string): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ sub, aud: audience, scope: 'daml_ledger_api' }));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64u(sig)}`;
}

async function main(): Promise<void> {
  const PORT = Number(process.env.PORT ?? 3001);
  const HOST = process.env.HOST ?? '0.0.0.0';
  const LEDGER_API_URL = process.env.LEDGER_API_URL ?? 'http://localhost:2975';
  const OPERATOR_PARTY = process.env.OPERATOR_PARTY!;
  const CUSTODIAN_PARTY = process.env.CUSTODIAN_PARTY!;
  const ORACLE_PARTY = process.env.ORACLE_PARTY!;
  const LEDGER_HMAC_SECRET = process.env.LEDGER_HMAC_SECRET ?? 'unsafe';
  const LEDGER_AUDIENCE = process.env.LEDGER_AUDIENCE ?? 'https://canton.network.global';
  const LEDGER_USER = process.env.LEDGER_USER ?? 'ledger-api-user';

  if (!OPERATOR_PARTY || !CUSTODIAN_PARTY || !ORACLE_PARTY) {
    throw new Error('Missing required env vars: OPERATOR_PARTY, CUSTODIAN_PARTY, ORACLE_PARTY');
  }

  const tokenProvider = async (): Promise<string> =>
    mintLedgerToken(LEDGER_USER, LEDGER_AUDIENCE, LEDGER_HMAC_SECRET);

  const ledger = new LedgerClient({
    baseUrl: LEDGER_API_URL,
    tokenProvider,
    userId: LEDGER_USER,
  });

  const markets = new MarketsService(ledger, OPERATOR_PARTY, ORACLE_PARTY);
  const portfolio = new PortfolioService(ledger);
  const trading = new TradingService(ledger, OPERATOR_PARTY, CUSTODIAN_PARTY);

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty' },
    },
  });

  await app.register(cors, {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
    credentials: true,
  });

  app.get('/health', async () => ({ ok: true, ledger: await ledger.ping() }));

  registerAuthRoutes(app, LEDGER_API_URL, tokenProvider);
  registerMarketsRoutes(app, markets);
  registerPortfolioRoutes(app, portfolio);
  registerTradingRoutes(app, trading);

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Fission backend listening on ${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
