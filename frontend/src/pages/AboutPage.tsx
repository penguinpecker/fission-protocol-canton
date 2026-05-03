export function AboutPage() {
  return (
    <>
      <section className="container" style={{ paddingTop: 96, paddingBottom: 64 }}>
        <span className="eyebrow reveal d1">Method · Whitepaper · §1</span>
        <h1 className="display reveal d2" style={{ fontSize: 'clamp(3rem, 7vw, 5rem)', maxWidth: '14ch', marginTop: 16 }}>
          Yield, <em>strip-fed</em> through Canton.
        </h1>
        <p className="reveal d3" style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', lineHeight: 1.4, maxWidth: '52ch', color: 'var(--ink-soft)', marginTop: 32 }}>
          A document on the architecture and economic invariants of Fission Protocol —
          a Pendle-style yield tokenization market built natively in Daml,
          deployed against the institutional asset base of Canton Network.
        </p>
      </section>

      <hr className="rule-bold" style={{ margin: 0 }} />

      {/* Mechanics */}
      <section id="mechanics" className="container" style={{ paddingTop: 80 }}>
        <div className="split">
          <div>
            <span className="eyebrow">§ 2.0 · Mechanics</span>
            <h2 style={{ marginTop: 8 }}>The split.</h2>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.0625rem', lineHeight: 1.6, color: 'var(--ink-soft)' }}>
            <p>
              An underlying yield-bearing instrument — for the v0.1 launch, Hashnote/Circle <strong style={{ color: 'var(--ink)' }}>USYC</strong> —
              is wrapped into <strong style={{ color: 'var(--ink)' }}>SY</strong>, a Standardized Yield token whose exchange rate
              against the underlying grows monotonically over time.
            </p>
            <p>
              SY is split atomically into <strong style={{ color: 'var(--pt-color)' }}>PT</strong>, the Principal Token,
              and <strong style={{ color: 'var(--yt-color)' }}>YT</strong>, the Yield Token.
              Each carries the same face value at issuance. Together they reconstitute the original SY at any point in time.
            </p>
            <p>
              At maturity, PT redeems 1:1 for the underlying. YT becomes worthless — all its yield has been distributed.
              Before maturity, YT holders may claim accrued yield at any time, paid out in additional SY.
            </p>
          </div>
        </div>
      </section>

      <section className="container" style={{ marginTop: 64 }}>
        <div className="card-bordered">
          <pre className="mono" style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.6, overflow: 'auto' }}>
{`Lifecycle of one Fission position
─────────────────────────────────────────────────────────

  t = 0                                    t = T (maturity)
  │                                                 │
  │   wrap                                          │
  ▼                                                 │
  ┌──────┐    split    ┌──────────┐                │
  │  SY  │ ─────────►  │   PT     │ ──── 1:1 ────► underlying
  └──────┘             └──────────┘                 │
      ▲                ┌──────────┐                 │
      │                │   YT     │ ── pays yield ─┤
      │                └──────────┘                 │
      │                     │                       │
      └─── ClaimYield ◄─────┘                       │
                                                    ▼
                                               YT → 0
`}
          </pre>
        </div>
      </section>

      {/* Invariants */}
      <section className="container" style={{ marginTop: 96 }}>
        <span className="eyebrow">§ 2.1 · Invariants</span>
        <h2 style={{ marginTop: 8 }}>Three guarantees.</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, marginTop: 32 }}>
          <Invariant
            n="i."
            title="Conservation"
            body="At all times before maturity, PT(t) + YT(t) is exchangeable for SY(t) in either direction. The split is reversible without loss."
          />
          <Invariant
            n="ii."
            title="Ratchet"
            body="The PY-Index never decreases. If the oracle reports a lower exchange rate, the index is held flat — protecting PT holders from negative-yield events."
          />
          <Invariant
            n="iii."
            title="Privacy"
            body="Individual positions are visible only to their parties and custodians. Aggregate pool reserves are public for price discovery; counterparty identities are not."
          />
        </div>
      </section>

      {/* Why Canton */}
      <section className="container" style={{ marginTop: 96 }}>
        <hr className="rule-bold" />
        <div className="split" style={{ marginTop: 48 }}>
          <div>
            <span className="eyebrow">§ 3 · Why Canton</span>
            <h2 style={{ marginTop: 8 }}>The chain matches the asset.</h2>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.0625rem', lineHeight: 1.6, color: 'var(--ink-soft)' }}>
            <p>
              Fission's underlyings are real-world assets — tokenized treasuries, money-market funds,
              repo positions. Their issuers are regulated. Their holders are accredited.
              These instruments do not exist on permissionless chains in any meaningful volume.
            </p>
            <p>
              Canton Network already custodies the institutional base — over six trillion dollars
              in tokenized assets, with daily on-ledger settlement at JPMorgan, Goldman Sachs, and DTCC.
              Our derivative inherits and respects the credentialing of its underlying through CIP-56,
              KYC certificates, and selective disclosure.
            </p>
            <p>
              Pendle on Ethereum cannot offer this. Onyx and DAP have the assets but no yield-stripping.
              Fission fills the gap.
            </p>
          </div>
        </div>
      </section>

      {/* Audit */}
      <section id="audit" className="container" style={{ marginTop: 96 }}>
        <hr className="rule-bold" />
        <div style={{ marginTop: 48 }}>
          <span className="eyebrow">§ 4 · Audits & Security</span>
          <h2 style={{ marginTop: 8 }}>Status.</h2>

          <table className="ledger" style={{ marginTop: 24 }}>
            <thead>
              <tr><th>Item</th><th>Status</th><th>Counterparty</th><th className="right">Date</th></tr>
            </thead>
            <tbody>
              <tr><td className="asset-name">Daml package audit</td><td>Planned</td><td>Halborn</td><td className="right">Q3 2026</td></tr>
              <tr><td className="asset-name">Oracle integrity review</td><td>Planned</td><td>OpenZeppelin</td><td className="right">Q3 2026</td></tr>
              <tr><td className="asset-name">DevNet operation</td><td>In progress</td><td>NODERS Validator</td><td className="right">Live</td></tr>
              <tr><td className="asset-name">Featured App application</td><td>Pending</td><td>GSF Tokenomics Cmte.</td><td className="right">Q3 2026</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="container" style={{ marginTop: 96 }}>
        <hr className="rule-bold" />
        <p className="fine" style={{ marginTop: 24, maxWidth: '64ch' }}>
          Fission Protocol v0.1 is an open-source software project and does not constitute investment
          advice or an offer to sell securities. Underlyings such as USYC are restricted under the
          Securities Act and accessible only to accredited or institutional counterparties in approved
          jurisdictions. The KYC certificate gating in this protocol is not optional.
        </p>
      </section>
    </>
  );
}

function Invariant({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="card" style={{ background: 'var(--paper)', borderTop: 'var(--rule-bold)' }}>
      <div className="mono" style={{ fontSize: '0.6875rem', letterSpacing: '0.16em', color: 'var(--ink-faint)' }}>{n}</div>
      <h3 style={{ marginTop: 8, color: 'var(--ink)', fontSize: '1.125rem', textTransform: 'none', letterSpacing: 'normal', fontFamily: 'var(--font-display)' }}>{title}</h3>
      <p className="fine" style={{ marginTop: 8, fontFamily: 'var(--font-display)', fontSize: '0.9375rem', color: 'var(--ink-soft)', lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}
