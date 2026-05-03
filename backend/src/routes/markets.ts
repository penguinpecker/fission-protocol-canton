import { FastifyInstance } from 'fastify';
import { MarketsService } from '../services/markets.js';

export function registerMarketsRoutes(
  app: FastifyInstance,
  markets: MarketsService,
): void {
  app.get('/api/assets', async () => {
    return markets.listAssets();
  });

  app.get('/api/markets', async () => {
    return markets.listMarkets();
  });

  app.get<{ Params: { code: string } }>('/api/markets/:code', async (req) => {
    const all = await markets.listMarkets();
    return all.filter((m) => m.assetCode === req.params.code);
  });
}
