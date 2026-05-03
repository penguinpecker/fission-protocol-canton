import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const resolveSchema = z.object({
  userId: z.string().min(1).max(64),
});

interface User {
  id: string;
  primaryParty: string;
}

/**
 * /api/auth/resolve-party
 *   Takes a userId (e.g. "alice") and returns the Canton party ID it maps to.
 *   Looks the user up via /v2/users on the participant.
 *
 * This is needed because the frontend wallet flow only has the userId after
 * Keycloak auth; the actual party ID is allocated server-side and stored as
 * the user's primaryParty.
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  ledgerApiUrl: string,
  tokenProvider: () => Promise<string>,
): void {
  app.post('/api/auth/resolve-party', async (req, reply) => {
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'BAD_INPUT', details: parsed.error.format() });
    }

    try {
      const token = await tokenProvider();
      const res = await fetch(`${ledgerApiUrl}/v2/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return reply.code(502).send({ code: 'PARTICIPANT_ERROR', status: res.status });
      }
      const data = (await res.json()) as { users: User[] };
      const user = data.users.find((u) => u.id === parsed.data.userId);
      if (!user) {
        return reply.code(404).send({ code: 'USER_NOT_FOUND' });
      }
      return { userId: user.id, party: user.primaryParty };
    } catch (err) {
      reply.code(500).send({ code: 'RESOLVE_FAILED', message: String(err) });
    }
  });
}
