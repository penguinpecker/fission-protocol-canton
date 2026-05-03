/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_LEDGER_HMAC_SECRET?: string;
  readonly VITE_LEDGER_AUDIENCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
