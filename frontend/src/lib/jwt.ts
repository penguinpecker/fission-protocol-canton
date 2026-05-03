/**
 * Browser-side HS256 JWT mint for Splice 0.6.2 LocalNet "unsafe" auth mode.
 * In production a real wallet (CIP-103 dApp SDK) would sign instead.
 */

const SECRET = import.meta.env.VITE_LEDGER_HMAC_SECRET ?? "unsafe";
const AUDIENCE =
  import.meta.env.VITE_LEDGER_AUDIENCE ?? "https://canton.network.global";

function b64u(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function mintToken(userId: string, party: string): Promise<string> {
  const enc = new TextEncoder();
  const header = b64u(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64u(
    enc.encode(
      JSON.stringify({
        sub: userId,
        aud: AUDIENCE,
        scope: "daml_ledger_api",
        party,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  return `${signingInput}.${b64u(new Uint8Array(sigBuf))}`;
}
