import { useState } from 'react';
import { useWallet } from '../hooks/wallet';

interface Props {
  onClose: () => void;
}

const KEYCLOAK_TOKEN_URL =
  import.meta.env.VITE_KEYCLOAK_TOKEN_URL ??
  'http://keycloak.localhost:8082/realms/AppUser/protocol/openid-connect/token';

const DEMO_USERS = [
  { name: 'alice', client: 'app-user-alice', secret: 'demo-secret-alice' },
  { name: 'bob', client: 'app-user-bob', secret: 'demo-secret-bob' },
];

export function ConnectModal({ onClose }: Props) {
  const { connect } = useWallet();
  const [tab, setTab] = useState<'demo' | 'manual'>('demo');
  const [partyId, setPartyId] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connectDemo(user: typeof DEMO_USERS[number]) {
    setBusy(true);
    setErr(null);
    try {
      // Mint a token via Keycloak client_credentials. In a real wallet, the
      // wallet itself signs and we never see the secret. For LocalNet demo
      // we accept this shortcut.
      const res = await fetch(KEYCLOAK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: user.client,
          client_secret: user.secret,
          scope: 'openid',
        }),
      });
      if (!res.ok) throw new Error(`Keycloak returned ${res.status}`);
      const data = (await res.json()) as { access_token: string };

      // Resolve the party from the user. In LocalNet the bootstrap script
      // creates parties with hint = user.name; we look it up via the backend.
      const partyRes = await fetch('/api/auth/resolve-party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.access_token}` },
        body: JSON.stringify({ userId: user.name }),
      });
      if (!partyRes.ok) throw new Error(`Failed to resolve party for ${user.name}`);
      const { party } = (await partyRes.json()) as { party: string };

      connect(party, data.access_token, user.name);
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  function connectManual() {
    if (!partyId.trim() || !token.trim()) {
      setErr('Both party ID and token are required.');
      return;
    }
    connect(partyId.trim(), token.trim(), partyId.trim().split('::')[0]);
    onClose();
  }

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(26, 25, 22, 0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        className="card-bordered"
        style={{ background: 'var(--paper)', minWidth: 480, maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
          <div>
            <div className="eyebrow">Authentication</div>
            <h2 style={{ marginBottom: 4 }}>Connect to Canton</h2>
            <div className="fine">LocalNet · participant @ localhost:2975</div>
          </div>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'flex', borderTop: 'var(--rule-thin)', borderBottom: 'var(--rule-thin)', marginBottom: 24 }}>
          <TabButton label="Demo Users" active={tab === 'demo'} onClick={() => setTab('demo')} />
          <TabButton label="Manual" active={tab === 'manual'} onClick={() => setTab('manual')} />
        </div>

        {tab === 'demo' ? (
          <>
            <p className="fine" style={{ marginBottom: 16 }}>
              The bootstrap script seeds two demo parties — Alice and Bob — both with
              accredited-investor KYC. Pick one to act as.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {DEMO_USERS.map((u) => (
                <button
                  key={u.name}
                  onClick={() => connectDemo(u)}
                  disabled={busy}
                  className="ghost"
                  style={{
                    justifyContent: 'space-between', display: 'flex',
                    padding: '16px 20px', textAlign: 'left',
                    fontSize: '0.875rem',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.0625rem', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                    Continue as {u.name.charAt(0).toUpperCase() + u.name.slice(1)}
                  </span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--ink-faint)' }}>
                    accredited · {u.client}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="fine" style={{ marginBottom: 16 }}>
              Paste a Canton party ID and a JWT minted from your wallet or Keycloak directly.
            </p>
            <label style={{ display: 'block', marginBottom: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Party ID</div>
              <input
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                placeholder="alice::1220abc..."
                className="mono"
                style={{ fontSize: '0.875rem' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>JWT Token</div>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="eyJhbGciOiJSUzI1NiIs..."
                rows={4}
                className="mono"
                style={{ fontSize: '0.75rem', resize: 'vertical' }}
              />
            </label>
            <button onClick={connectManual} style={{ width: '100%' }}>Connect</button>
          </>
        )}

        {err && (
          <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--oxblood)', color: 'var(--oxblood)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
            {err}
          </div>
        )}

        <p className="fine" style={{ marginTop: 16, textAlign: 'center' }}>
          Production deployment will use the AppsFactory wallet via the CIP-103 dApp SDK.
        </p>
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="ghost"
      style={{
        flex: 1, border: 'none', padding: '14px 12px', fontSize: '0.6875rem',
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink-soft)',
        borderRight: '1px solid var(--ink)',
      }}
    >
      {label}
    </button>
  );
}
