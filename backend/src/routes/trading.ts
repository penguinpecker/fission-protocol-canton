import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TradingService } from '../services/trading.js';
import { authMiddleware } from '../middleware/auth.js';

const mintSchema = z.object({
  marketAssetCode: z.string().min(1).max(32),
  marketMaturityIso: z.string().datetime(),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
});

const swapSchema = z.object({
  marketAssetCode: z.string().min(1).max(32),
  marketMaturityIso: z.string().datetime(),
  kind: z.enum(['SyToPt', 'PtToSy']),
  amountIn: z.string().regex(/^\d+(\.\d+)?$/),
  minAmountOut: z.string().regex(/^\d+(\.\d+)?$/),
});

const claimSchema = z.object({
  ytContractId: z.string().min(1),
});

const redeemSchema = z.object({
  ptContractId: z.string().min(1),
  ytContractId: z.string().min(1).optional(),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
});

export function registerTradingRoutes(
  app: FastifyInstance,
  trading: TradingService,
): void {
  app.post('/api/trade/mint', { preHandler: authMiddleware }, async (req, reply) => {
    const parsed = mintSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ code: 'BAD_INPUT', details: parsed.error.format() });
      return;
    }
    if (!req.party) {
      reply.code(401).send({ code: 'NO_PARTY' });
      return;
    }
    try {
      return await trading.mintPy(req.party, parsed.data);
    } catch (err: unknown) {
      reply.code(500).send({ code: 'MINT_FAILED', message: String(err) });
    }
  });

  app.post('/api/trade/swap', { preHandler: authMiddleware }, async (req, reply) => {
    const parsed = swapSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ code: 'BAD_INPUT', details: parsed.error.format() });
      return;
    }
    if (!req.party) return reply.code(401).send({ code: 'NO_PARTY' });
    try {
      return await trading.submitSwap(req.party, parsed.data);
    } catch (err) {
      reply.code(500).send({ code: 'SWAP_FAILED', message: String(err) });
    }
  });

  app.post('/api/trade/claim', { preHandler: authMiddleware }, async (req, reply) => {
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ code: 'BAD_INPUT', details: parsed.error.format() });
      return;
    }
    if (!req.party) return reply.code(401).send({ code: 'NO_PARTY' });
    try {
      return await trading.claimYield(req.party, parsed.data);
    } catch (err) {
      reply.code(500).send({ code: 'CLAIM_FAILED', message: String(err) });
    }
  });

  app.post('/api/trade/redeem', { preHandler: authMiddleware }, async (req, reply) => {
    const parsed = redeemSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ code: 'BAD_INPUT', details: parsed.error.format() });
      return;
    }
    if (!req.party) return reply.code(401).send({ code: 'NO_PARTY' });
    try {
      return await trading.redeemPostMaturity(req.party, parsed.data);
    } catch (err) {
      reply.code(500).send({ code: 'REDEEM_FAILED', message: String(err) });
    }
  });
}
