import { FastifyInstance } from 'fastify';
import { PortfolioService } from '../services/portfolio.js';
import { authMiddleware } from '../middleware/auth.js';

export function registerPortfolioRoutes(
  app: FastifyInstance,
  portfolio: PortfolioService,
): void {
  app.get('/api/portfolio', { preHandler: authMiddleware }, async (req, reply) => {
    if (!req.party) {
      reply.code(401).send({ code: 'NO_PARTY' });
      return;
    }
    return portfolio.getPortfolio(req.party);
  });
}
