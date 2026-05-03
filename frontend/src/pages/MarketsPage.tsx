import { useState } from 'react';
import { useAssets, useMarkets } from '../hooks/api';
import { TradeModal } from '../components/TradeModal';
import { Sparkline } from '../components/Sparkline';
import { fmtNumber, fmtPct, fmtMaturityCode } from '../lib/format';
import type { Market } from '../types';

export function MarketsPage() {
  const { data: assets = [], isLoading: assetsLoading } = useAssets();
  const { data: markets = [], isLoading: marketsLoading } = useMarkets();
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);

  const totalTvl = markets.reduce(
    (acc, m) => acc + parseFloat(m.poolSyReserve) + parseFloat(m.poolPtReserve),
    0,
  );

  // Mock historical points for sparklines (in production, comes from PQS)
  const mockPoints = (apr: number) => {
    const out = [];
    for (let i = 0; i < 30; i++) {
      out.push({ t: Date.now() - (29 - i) * 86_400_000, rate: 1 + (apr / 365) * i + Math.random() * 0.0002 });
    }
    return out;
  };

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="container">
          <div className="hero-meta reveal d1">
            <span>Bulletin №.001 · Yield Strip Markets</span>
            <span>{new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()}</span>
          </div>
          <h1 className="display hero-headline reveal d2">
            Split <em>principal</em> from <em>yield.</em>
          </h1>
          <p className="hero-deck reveal d3">
            Fission tokenizes the yield of regulated, real-world assets on Canton Network.
            Lock fixed rates with PT. Speculate on yield with YT. Settle atomically with privacy preserved end-to-end —
            <em> the way institutional fixed-income should work.</em>
          </p>
          <div className="reveal d4" style={{ display: 'flex', gap: 16 }}>
            <a href="#markets" style={{ border: 'none' }}><button>Explore Markets ↓</button></a>
            <a href="/about" style={{ border: 'none' }}><button className="ghost">How it works</button></a>
          </div>
        </div>
      </section>

      {/* Metrics strip */}
      <section className="container" style={{ marginTop: 64 }}>
        <div className="metric-grid reveal d2">
          <div className="metric">
            <span className="label">Total Value Locked</span>
            <span className="value tabular">${fmtNumber(totalTvl, 0)}</span>
          </div>
          <div className="metric">
            <span className="label">Active Markets</span>
            <span className="value tabular">{markets.length}</span>
          </div>
          <div className="metric">
            <span className="label">Underlyings</span>
            <span className="value tabular">{assets.length}</span>
          </div>
          <div className="metric">
            <span className="label">Network</span>
            <span className="value mono">Canton</span>
            <span className="delta">LocalNet · Daml 3.4</span>
          </div>
        </div>
      </section>

      {/* Underlyings table */}
      <section className="container" style={{ marginTop: 80 }} id="underlyings">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
          <div>
            <span className="eyebrow">§ I</span>
            <h2 style={{ margin: '4px 0 0' }}>Approved Underlyings</h2>
          </div>
          <span className="fine">Live yield observations from registered oracle parties.</span>
        </div>

        {assetsLoading ? <Skeleton /> : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Asset</th>
                <th>Yield Source</th>
                <th>Tier</th>
                <th className="right">Current Rate</th>
                <th className="right">APR</th>
                <th>30-Day Trace</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a, i) => (
                <tr key={a.code} className="reveal" style={{ animationDelay: `${i * 60}ms` }}>
                  <td className="asset-name">{a.code}</td>
                  <td>{a.displayName}</td>
                  <td>{yieldKindLabel(a.yieldKind)}</td>
                  <td><CredentialPill tier={a.credentialClass} /></td>
                  <td className="right tabular">{fmtNumber(a.currentRate, 6)}</td>
                  <td className="right tabular" style={{ color: 'var(--moss-bright)' }}>
                    {fmtPct(a.apr)}
                  </td>
                  <td style={{ minWidth: 120, maxWidth: 160 }}>
                    <Sparkline points={mockPoints(parseFloat(a.apr))} height={32} color="var(--ink)" />
                  </td>
                </tr>
              ))}
              {assets.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 48, color: 'var(--ink-soft)' }}>
                  No underlyings registered yet. Run <code>scripts/bootstrap.ts</code> to seed USYC.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {/* Markets table */}
      <section className="container" style={{ marginTop: 96 }} id="markets">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
          <div>
            <span className="eyebrow">§ II</span>
            <h2 style={{ margin: '4px 0 0' }}>PY Markets</h2>
          </div>
          <span className="fine">Maturity-specific PT/YT pairs with batch-settled AMM liquidity.</span>
        </div>

        {marketsLoading ? <Skeleton /> : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Maturity</th>
                <th className="right">Days</th>
                <th className="right">Implied APY</th>
                <th className="right">PT Discount</th>
                <th className="right">SY Reserve</th>
                <th className="right">PT Reserve</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m, i) => (
                <tr key={`${m.assetCode}-${m.maturity.iso}`} className="reveal" style={{ animationDelay: `${i * 60}ms` }}>
                  <td className="asset-name">
                    <span className="token-pill pt" style={{ marginRight: 4 }}>PT</span>
                    <span className="token-pill yt" style={{ marginRight: 8 }}>YT</span>
                    {m.assetCode}
                  </td>
                  <td className="mono">{fmtMaturityCode(m.maturity.iso)}</td>
                  <td className="right tabular">{m.maturity.daysToMaturity}</td>
                  <td className="right tabular" style={{ color: 'var(--moss-bright)', fontWeight: 700 }}>
                    {fmtPct(m.impliedApy)}
                  </td>
                  <td className="right tabular">
                    {fmtPct(impliedDiscount(m), 3)}
                  </td>
                  <td className="right tabular">{fmtNumber(m.poolSyReserve)}</td>
                  <td className="right tabular">{fmtNumber(m.poolPtReserve)}</td>
                  <td className="right">
                    <button onClick={() => setSelectedMarket(m)} style={{ padding: '8px 16px', fontSize: '0.6875rem' }}>
                      Trade →
                    </button>
                  </td>
                </tr>
              ))}
              {markets.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 48, color: 'var(--ink-soft)' }}>
                  No PY markets deployed. Bootstrap seeds USYC-Dec26 and USYC-Mar27 by default.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {/* Method footnote */}
      <section className="container" style={{ marginTop: 96 }}>
        <hr className="rule-bold" />
        <div className="split">
          <div>
            <span className="eyebrow">Method</span>
            <h2>The Pendle pattern, made institutional.</h2>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', lineHeight: 1.55, color: 'var(--ink-soft)' }}>
              Each underlying is wrapped into a Standardized Yield (SY) token, then split atomically
              into a Principal Token (PT) and Yield Token (YT) of equal face value.
              PT redeems 1:1 at maturity. YT pays accrued yield until then.
              The PY-Index ratchet protects PT holders from negative-yield events —
              a structural advantage over the EVM equivalent.
            </p>
          </div>
          <div>
            <pre className="mono" style={{ fontSize: '0.8125rem', background: 'var(--paper-aged)', padding: 24, border: 'var(--rule-thin)', overflow: 'auto', margin: 0 }}>
{`-- The invariant
PT(t) + YT(t) ≡ SY(t)   for all t < maturity

-- At maturity
PT(T) → 1 unit underlying
YT(T) → 0   (yield exhausted)

-- The ratchet
index(t+1) = max(index(t), oracle(t+1))
-- never decreases`}
            </pre>
          </div>
        </div>
      </section>

      {selectedMarket && (
        <TradeModal market={selectedMarket} onClose={() => setSelectedMarket(null)} />
      )}
    </>
  );
}

function yieldKindLabel(k: string): string {
  return k === 'RisingNav' ? 'Rising NAV' : k === 'Rebasing' ? 'Rebasing' : 'Streaming';
}

function impliedDiscount(m: Market): number {
  const sy = parseFloat(m.poolSyReserve);
  const pt = parseFloat(m.poolPtReserve);
  if (sy + pt === 0) return 0;
  return 1 - pt / (sy + pt);
}

function CredentialPill({ tier }: { tier: string }) {
  const labels: Record<string, string> = {
    Permissionless: 'OPEN',
    RetailKyc: 'KYC',
    AccreditedInvestor: 'ACCRED.',
    InstitutionalOnly: 'INST.',
  };
  return (
    <span className="mono" style={{
      fontSize: '0.6875rem',
      padding: '2px 8px',
      border: '1px solid var(--ink-faint)',
      letterSpacing: '0.1em',
      color: 'var(--ink-soft)',
    }}>
      {labels[tier] ?? tier}
    </span>
  );
}

function Skeleton() {
  return (
    <div style={{ height: 200, background: 'var(--paper-aged)', border: 'var(--rule-thin)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="mono cursor" style={{ color: 'var(--ink-soft)', fontSize: '0.8125rem' }}>Loading from ledger</span>
    </div>
  );
}
