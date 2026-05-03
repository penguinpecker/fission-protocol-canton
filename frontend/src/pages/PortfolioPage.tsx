import { usePortfolio, useClaimYield, useRedeem } from '../hooks/api';
import { useWallet } from '../hooks/wallet';
import { fmtNumber, shortParty } from '../lib/format';
import type { PortfolioPosition } from '../types';

export function PortfolioPage() {
  const { party } = useWallet();
  const { data, isLoading, error } = usePortfolio();
  const claim = useClaimYield();
  const redeem = useRedeem();

  if (!party) {
    return (
      <section className="container" style={{ padding: '96px 0', textAlign: 'center' }}>
        <span className="eyebrow">Authentication required</span>
        <h1 className="display" style={{ fontSize: '4rem', maxWidth: '12ch', margin: '24px auto' }}>
          Connect your <em>wallet</em>.
        </h1>
        <p style={{ maxWidth: '52ch', margin: '0 auto', fontFamily: 'var(--font-display)', fontSize: '1.125rem', color: 'var(--ink-soft)' }}>
          Your portfolio shows positions across PT, YT, SY, and LP holdings.
          Click "Connect Wallet" in the header to authenticate.
        </p>
      </section>
    );
  }

  const sy = data?.positions.filter((p) => p.kind === 'SY') ?? [];
  const pt = data?.positions.filter((p) => p.kind === 'PT') ?? [];
  const yt = data?.positions.filter((p) => p.kind === 'YT') ?? [];
  const lp = data?.positions.filter((p) => p.kind === 'LP') ?? [];

  return (
    <>
      <section className="container" style={{ paddingTop: 64 }}>
        <span className="eyebrow reveal d1">Portfolio · {shortParty(party)}</span>
        <h1 className="reveal d2" style={{ marginTop: 8 }}>
          Holdings <em style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>at the time of writing.</em>
        </h1>

        <div className="metric-grid reveal d3" style={{ marginTop: 32 }}>
          <div className="metric">
            <span className="label">Total Value (SY-eq.)</span>
            <span className="value tabular">{fmtNumber(data?.totalValueSy ?? '0', 2)}</span>
          </div>
          <div className="metric">
            <span className="label">PT Positions</span>
            <span className="value tabular" style={{ color: 'var(--pt-color)' }}>{pt.length}</span>
          </div>
          <div className="metric">
            <span className="label">YT Positions</span>
            <span className="value tabular" style={{ color: 'var(--yt-color)' }}>{yt.length}</span>
          </div>
          <div className="metric">
            <span className="label">Claimable Yield</span>
            <span className="value tabular" style={{ color: 'var(--moss-bright)' }}>
              {fmtNumber(yt.reduce((acc, p) => acc + parseFloat(p.claimableYield ?? '0'), 0), 4)}
            </span>
          </div>
        </div>
      </section>

      {error ? (
        <section className="container" style={{ marginTop: 32, padding: 16, border: '1px solid var(--oxblood)', color: 'var(--oxblood)' }}>
          {String(error)}
        </section>
      ) : isLoading ? (
        <section className="container" style={{ marginTop: 64 }}>
          <div className="card" style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="mono cursor">Loading positions</span>
          </div>
        </section>
      ) : (
        <>
          <PositionTable
            title="Standardized Yield"
            sigil="SY"
            positions={sy}
            actions={() => null}
          />
          <PositionTable
            title="Principal Tokens"
            sigil="PT"
            positions={pt}
            actions={(p) => (
              <button
                onClick={() => redeem.mutate({ ptContractId: p.contractId, amount: p.amount })}
                disabled={redeem.isPending}
                style={{ padding: '8px 16px', fontSize: '0.6875rem' }}
              >
                {redeem.isPending ? '…' : 'Redeem →'}
              </button>
            )}
          />
          <PositionTable
            title="Yield Tokens"
            sigil="YT"
            positions={yt}
            actions={(p) => {
              const claimable = parseFloat(p.claimableYield ?? '0');
              return (
                <button
                  onClick={() => claim.mutate({ ytContractId: p.contractId })}
                  disabled={claim.isPending || claimable === 0}
                  style={{ padding: '8px 16px', fontSize: '0.6875rem' }}
                >
                  {claim.isPending ? '…' : `Claim ${fmtNumber(claimable, 4)}`}
                </button>
              );
            }}
            extraColumns={[{ label: 'Claimable', render: (p) => fmtNumber(p.claimableYield ?? '0', 4) }]}
          />
          <PositionTable
            title="Liquidity Positions"
            sigil="LP"
            positions={lp}
            actions={() => null}
          />
        </>
      )}
    </>
  );
}

function PositionTable({
  title,
  sigil,
  positions,
  actions,
  extraColumns,
}: {
  title: string;
  sigil: 'SY' | 'PT' | 'YT' | 'LP';
  positions: PortfolioPosition[];
  actions: (p: PortfolioPosition) => React.ReactNode;
  extraColumns?: { label: string; render: (p: PortfolioPosition) => string }[];
}) {
  if (positions.length === 0) return null;

  return (
    <section className="container" style={{ marginTop: 64 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 16 }}>
        <span className={`token-pill ${sigil.toLowerCase()}`}>{sigil}</span>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="fine">— {positions.length} position{positions.length === 1 ? '' : 's'}</span>
      </div>
      <table className="ledger">
        <thead>
          <tr>
            <th>Instrument</th>
            <th className="right">Amount</th>
            {extraColumns?.map((c) => <th key={c.label} className="right">{c.label}</th>)}
            <th className="right">Contract ID</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.contractId}>
              <td className="asset-name">{p.instrumentId}</td>
              <td className="right tabular">{fmtNumber(p.amount, 6)}</td>
              {extraColumns?.map((c) => (
                <td key={c.label} className="right tabular" style={{ color: 'var(--moss-bright)' }}>
                  {c.render(p)}
                </td>
              ))}
              <td className="right" style={{ color: 'var(--ink-faint)', fontSize: '0.6875rem' }}>
                {p.contractId.slice(0, 12)}…
              </td>
              <td className="right">{actions(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
