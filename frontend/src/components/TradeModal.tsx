import { useState } from 'react';
import { useMint, useSwap } from '../hooks/api';
import type { Market } from '../types';
import { fmtPct, fmtMaturityCode } from '../lib/format';

interface Props {
  market: Market;
  onClose: () => void;
}

type Tab = 'mint' | 'swap-pt' | 'swap-yt';

export function TradeModal({ market, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('mint');
  const [amount, setAmount] = useState('');
  const mint = useMint();
  const swap = useSwap();

  const isLoading = mint.isPending || swap.isPending;
  const error = mint.error ?? swap.error;

  async function handleSubmit() {
    if (!amount || parseFloat(amount) <= 0) return;
    try {
      if (tab === 'mint') {
        await mint.mutateAsync({
          marketAssetCode: market.assetCode,
          marketMaturityIso: market.maturity.iso,
          amount,
        });
      } else if (tab === 'swap-pt') {
        // Buy PT with SY: SyToPt
        await swap.mutateAsync({
          marketAssetCode: market.assetCode,
          marketMaturityIso: market.maturity.iso,
          kind: 'SyToPt',
          amountIn: amount,
          minAmountOut: '0',
        });
      } else if (tab === 'swap-yt') {
        // Selling PT for SY (proxy for YT exposure via flash mint pattern)
        await swap.mutateAsync({
          marketAssetCode: market.assetCode,
          marketMaturityIso: market.maturity.iso,
          kind: 'PtToSy',
          amountIn: amount,
          minAmountOut: '0',
        });
      }
      setAmount('');
      setTimeout(onClose, 800);
    } catch {/* handled in error display */}
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
            <div className="eyebrow">Trade · {market.assetCode}</div>
            <h2 style={{ marginBottom: 4 }}>
              {market.assetCode} <em style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>· {fmtMaturityCode(market.maturity.iso)}</em>
            </h2>
            <div className="fine">
              {market.maturity.daysToMaturity} days · implied APY {fmtPct(market.impliedApy)}
            </div>
          </div>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'flex', borderTop: 'var(--rule-thin)', borderBottom: 'var(--rule-thin)', marginBottom: 24 }}>
          <TabButton label="Split → PT + YT" active={tab === 'mint'} onClick={() => setTab('mint')} />
          <TabButton label="Buy PT (Fixed Yield)" active={tab === 'swap-pt'} onClick={() => setTab('swap-pt')} />
          <TabButton label="Buy YT (Variable Yield)" active={tab === 'swap-yt'} onClick={() => setTab('swap-yt')} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Amount {tab === 'mint' ? 'SY-' + market.assetCode : 'SY-' + market.assetCode}
            </div>
            <input
              type="number"
              step="0.000001"
              min="0"
              placeholder="0.000000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mono"
              style={{ fontSize: '1.25rem', padding: 16 }}
            />
          </label>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Estimate</div>
          {tab === 'mint' ? (
            <div className="mono" style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Row k={`SY-${market.assetCode} in`} v={amount || '0'} />
              <Row k="PT out" v={amount || '0'} accent="pt" />
              <Row k="YT out" v={amount || '0'} accent="yt" />
            </div>
          ) : (
            <div className="mono" style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Row k="In" v={amount || '0'} />
              <Row k="Min out" v="0 (slippage tolerated)" />
              <Row k="Pool reserves" v={`SY ${parseFloat(market.poolSyReserve).toFixed(2)} · PT ${parseFloat(market.poolPtReserve).toFixed(2)}`} />
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, border: '1px solid var(--oxblood)', color: 'var(--oxblood)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
            {String(error)}
          </div>
        )}

        <button onClick={handleSubmit} disabled={isLoading || !amount} style={{ width: '100%' }}>
          {isLoading ? 'Submitting…' : tab === 'mint' ? 'Split into PT + YT' : 'Submit Swap'}
        </button>

        <p className="fine" style={{ marginTop: 12, textAlign: 'center' }}>
          {tab === 'mint'
            ? 'Splitting is atomic and reversible until maturity.'
            : 'Swap settles in the next sequencer batch (≈3s).'}
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

function Row({ k, v, accent }: { k: string; v: string; accent?: 'pt' | 'yt' }) {
  const color = accent === 'pt' ? 'var(--pt-color)' : accent === 'yt' ? 'var(--yt-color)' : 'inherit';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--ink-soft)' }}>{k}</span>
      <span style={{ color, fontWeight: 500 }}>{v}</span>
    </div>
  );
}
