import { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';

const LEDGER_HMAC_SECRET = process.env.LEDGER_HMAC_SECRET ?? 'unsafe';
const LEDGER_AUDIENCE = process.env.LEDGER_AUDIENCE ?? 'https://canton.network.global';
const HMAC_KEY = new TextEncoder().encode(LEDGER_HMAC_SECRET);

declare module 'fastify' {
  interface FastifyRequest {
    party?: string;
    userId?: string;
  }
}

/**
 * Validates the HS256 JWT in the Authorization header and binds the user's party
 * to the request. Throws 401 on failure. Pairs with the LocalNet "unsafe" auth
 * mode of the Splice 0.6.2 bundle.
 */
export async function authMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    reply.code(401).send({ code: 'NO_TOKEN', message: 'Missing bearer token' });
    return;
  }

  const token = auth.slice(7);
  try {
    const { payload } = await jwtVerify(token, HMAC_KEY, {
      audience: LEDGER_AUDIENCE,
    });
    req.userId = payload.sub as string;
    // Frontend signs tokens with a `party` claim identifying the connected party.
    req.party = (payload.party as string) ?? (payload.sub as string);
  } catch (err) {
    reply.code(401).send({ code: 'INVALID_TOKEN', message: String(err) });
    return;
  }
}
