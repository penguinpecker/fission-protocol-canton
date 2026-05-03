import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useWallet } from '../hooks/wallet';
import { shortParty } from '../lib/format';
import { ConnectModal } from './ConnectModal';

export function Header() {
  const { party, displayName, disconnect } = useWallet();
  const [showConnect, setShowConnect] = useState(false);

  return (
    <>
      <header className="site">
        <div className="container nav-row">
          <a href="/" className="brand">
            <span className="mark">Fission</span>
            <span className="seq">Protocol · v0.1</span>
          </a>
          <nav className="primary">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              Markets
            </NavLink>
            <NavLink to="/portfolio" className={({ isActive }) => (isActive ? 'active' : '')}>
              Portfolio
            </NavLink>
            <NavLink to="/about" className={({ isActive }) => (isActive ? 'active' : '')}>
              Method
            </NavLink>
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {party ? (
              <>
                <span className="mono" style={{ fontSize: '0.8125rem', color: 'var(--ink-soft)' }}>
                  {shortParty(displayName ?? party)}
                </span>
                <button className="ghost" onClick={disconnect}>Disconnect</button>
              </>
            ) : (
              <button onClick={() => setShowConnect(true)}>Connect Wallet</button>
            )}
          </div>
        </div>
      </header>
      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
    </>
  );
}
