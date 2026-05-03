export function Footer() {
  return (
    <footer style={{ borderTop: 'var(--rule-thin)', marginTop: 96, padding: '48px 0', background: 'var(--paper-aged)' }}>
      <div className="container" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 32 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 500, marginBottom: 8 }}>
            Fission Protocol
          </div>
          <p className="fine" style={{ maxWidth: '32ch' }}>
            Yield tokenization for tokenized real-world assets. Built on Canton Network.
            Submitted to HackCanton Season 1.
          </p>
        </div>
        <div>
          <h3>Protocol</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }} className="fine">
            <li><a href="/about">Method</a></li>
            <li><a href="/about#mechanics">Mechanics</a></li>
            <li><a href="/about#audit">Audits</a></li>
          </ul>
        </div>
        <div>
          <h3>Resources</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }} className="fine">
            <li><a href="https://github.com/your-org/fission" target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a href="https://docs.daml.com" target="_blank" rel="noreferrer">Daml Docs</a></li>
            <li><a href="https://canton.network" target="_blank" rel="noreferrer">Canton</a></li>
          </ul>
        </div>
        <div>
          <h3>Network</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }} className="fine">
            <li>LocalNet · v0.1</li>
            <li>Daml SDK 3.4.11</li>
            <li>Canton 3.4</li>
          </ul>
        </div>
      </div>
      <div className="container" style={{ marginTop: 48, paddingTop: 16, borderTop: '1px solid var(--ink-faint)' }}>
        <p className="fine">© 2026 Fission Protocol. Open source under Apache-2.0. Not investment advice.</p>
      </div>
    </footer>
  );
}
