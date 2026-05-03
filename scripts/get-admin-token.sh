#!/bin/bash
# Mint an HS256 JWT for Splice LocalNet's "unsafe" auth mode.
# The 0.6.2 Splice LocalNet bundle does not include Keycloak; the JSON Ledger API
# accepts HS256 JWTs signed with the shared secret `unsafe` and an audience of
# https://canton.network.global. Used by the Makefile for DAR uploads.

set -e

SUB="${LEDGER_USER:-ledger-api-user}"
AUD="${LEDGER_AUDIENCE:-https://canton.network.global}"
SECRET="${LEDGER_HMAC_SECRET:-unsafe}"

node - <<EOF
import('node:crypto').then((m) => {
  const crypto = m.default;
  const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ sub: '${SUB}', aud: '${AUD}', scope: 'daml_ledger_api' }));
  const sig = crypto.createHmac('sha256', '${SECRET}').update(\`\${header}.\${payload}\`).digest();
  process.stdout.write(\`\${header}.\${payload}.\${b64u(sig)}\`);
});
EOF
