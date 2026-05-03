import { useState, useEffect, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
} from "recharts";
import { useWallet } from "./hooks/wallet";
import {
  useAssets,
  useMarkets,
  usePortfolio,
  useMint,
  useSwap,
  useClaim,
} from "./hooks/api";
import { api } from "./lib/api";
import { mintToken } from "./lib/jwt";
import type { Market, Position } from "./lib/api";

// Synthesised chart series (UI-only; protocol data flows through REST hooks).
const mkYield = (b: number, v: number, n = 60) =>
  Array.from({ length: n }, (_, i) => ({
    d: i,
    underlying: +(b + Math.sin(i * 0.2) * v + (Math.random() - 0.5) * v * 0.6).toFixed(2),
    implied: +(
      b + 0.8 + Math.sin(i * 0.15) * v * 0.5 + (Math.random() - 0.5) * v * 0.4
    ).toFixed(2),
    fixed: b - 0.7,
  }));
const mkPT = (s: number, n = 60) =>
  Array.from({ length: n }, (_, i) => ({
    d: i,
    price: +Math.min(s + (1 - s) * (i / n) ** 0.55 + (Math.random() - 0.5) * 0.004, 1).toFixed(4),
    target: 1.0,
  }));
const mkMini = (b: number, v: number, n = 30) =>
  Array.from({ length: n }, (_, i) => ({
    d: i,
    v: +(b + Math.sin(i * 0.3) * v + (Math.random() - 0.5) * v * 0.5).toFixed(2),
  }));
const ptMini = (s: number, n = 30) =>
  Array.from({ length: n }, (_, i) => ({
    d: i,
    price: +Math.min(s + (1 - s) * (i / n) ** 0.5 + (Math.random() - 0.5) * 0.003, 1).toFixed(4),
  }));

const STRATS = [
  {
    id: "split",
    title: "Split",
    subtitle: "Mint PT + YT",
    color: "#00ff88",
    risk: "None",
    horizon: "Any",
    desc: "Atomically split SY into PT + YT. Always succeeds, no AMM needed.",
    icon: "⚛",
  },
  {
    id: "fixed",
    title: "Fixed Yield",
    subtitle: "Buy PT",
    color: "#00ff88",
    risk: "Low",
    horizon: "Hold to maturity",
    desc: "Lock in fixed APY. Trade SY for PT against the AMM, redeem 1:1 at maturity.",
    icon: "🛡",
  },
  {
    id: "long",
    title: "Long Yield",
    subtitle: "Buy YT",
    color: "#ff6b35",
    risk: "High",
    horizon: "Active",
    desc: "Leveraged yield bet. Trade PT for SY, then split for additional YT exposure.",
    icon: "🔥",
  },
  {
    id: "earn",
    title: "Earn (LP)",
    subtitle: "Add Liquidity",
    color: "#a855f7",
    risk: "Medium",
    horizon: "Maturity",
    desc: "Provide PT + SY to the pool. Earn swap fees. Already seeded by bootstrap.",
    icon: "💎",
  },
];

const ACCENT_BY_LABEL: Record<string, string> = {
  DEC26: "#00ff88",
  MAR27: "#5C94FF",
};

interface MktDef {
  idx: number;
  market: Market;
  label: string;
  accent: string;
}

function deriveMkts(markets: Market[] | undefined): MktDef[] {
  if (!markets) return [];
  return markets.map((m, idx) => {
    const label = m.ptInstrumentId.split("-").pop() ?? `M${idx}`;
    return { idx, market: m, label, accent: ACCENT_BY_LABEL[label] ?? "#00ff88" };
  });
}

function ChartTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-fission-surface p-2 border border-fission-outline-var/30 font-label text-xs">
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || "#e4e1e9" }}>
          {typeof p.value === "number" ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  );
}

// ─── Wallet button ───
function WalletBtn() {
  const { party, displayName, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const short = party ? `${party.slice(0, 6)}…${party.slice(-4)}` : "";
  if (party)
    return (
      <button
        onClick={disconnect}
        className="frosted-console border border-fission-outline-var/30 px-4 py-2 font-label font-bold text-[10px] uppercase tracking-widest text-fission-on-surface"
      >
        {displayName ? `${displayName} · ${short}` : short}
      </button>
    );
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-fission-green text-fission-on-primary px-4 py-2 font-label font-bold text-[10px] uppercase tracking-widest hover:brightness-110"
      >
        Connect Wallet
      </button>
      {open && <ConnectModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const connect = useWallet((s) => s.connect);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(userId: string) {
    setBusy(true);
    setErr(null);
    try {
      const { party } = await api.resolveParty(userId);
      const token = await mintToken(userId, party);
      connect(party, token, userId);
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="frosted-console border border-fission-outline-var/30 p-6 w-[440px] max-w-[92vw]"
      >
        <div className="flex justify-between items-baseline mb-1">
          <div>
            <div className="text-[10px] font-label text-fission-green uppercase tracking-widest">
              Authentication
            </div>
            <h2 className="text-xl font-headline font-bold tracking-tighter">Connect to Canton</h2>
          </div>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-slate-400 hover:text-fission-on-surface px-2 text-xs font-label uppercase"
          >
            Close
          </button>
        </div>
        <p className="text-xs text-slate-400 font-label mb-5">
          LocalNet · participant @ localhost:2975 · HS256 dev signing
        </p>
        <div className="flex flex-col gap-2">
          {["alice", "bob"].map((u) => (
            <button
              key={u}
              disabled={busy}
              onClick={() => pick(u)}
              className="bg-fission-surface-low border border-fission-outline-var/20 px-4 py-3 text-left text-fission-on-surface hover:border-fission-green/40 transition-all"
            >
              <div className="font-headline font-bold text-base">
                Continue as {u.charAt(0).toUpperCase() + u.slice(1)}
              </div>
              <div className="text-[10px] font-label text-slate-500 uppercase tracking-widest mt-0.5">
                Accredited investor · seeded with 1,000 SY-USYC
              </div>
            </button>
          ))}
        </div>
        {err && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 font-label break-all">
            {err}
          </div>
        )}
        <p className="text-[10px] font-label text-slate-500 mt-4 text-center leading-relaxed">
          Production deploy: token signed by the user's wallet via the CIP-103 dApp SDK.
        </p>
      </div>
    </div>
  );
}

// ─── Hash router ───
type Route =
  | { page: "landing" }
  | { page: "markets" }
  | { page: "strategy"; mi: number }
  | { page: "trade"; mi: number; st: string }
  | { page: "swap" }
  | { page: "dashboard" };

function parseHash(h: string): Route {
  const s = h.replace("#", "");
  if (s.startsWith("trade/")) {
    const p = s.split("/");
    return { page: "trade", mi: +p[1] || 0, st: p[2] || "split" };
  }
  if (s.startsWith("strategy/")) return { page: "strategy", mi: +(s.split("/")[1] || 0) };
  if (s === "markets") return { page: "markets" };
  if (s === "swap") return { page: "swap" };
  if (s === "dashboard") return { page: "dashboard" };
  return { page: "landing" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash(window.location.hash));
  useEffect(() => {
    const fn = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  const nav = (h: string) => {
    window.location.hash = h;
  };

  return (
    <>
      {route.page !== "landing" && <Nav route={route} nav={nav} />}
      {route.page === "landing" && <Landing nav={nav} />}
      {route.page === "markets" && <Markets nav={nav} />}
      {route.page === "strategy" && <Strategy mi={route.mi} nav={nav} />}
      {route.page === "trade" && <Trade mi={route.mi} st={route.st} nav={nav} />}
      {route.page === "swap" && <Swap />}
      {route.page === "dashboard" && <Dash />}
    </>
  );
}

// ─── Nav ───
function Nav({ route, nav }: { route: Route; nav: (h: string) => void }) {
  const isMk = route.page === "markets" || route.page === "strategy" || route.page === "trade";
  return (
    <nav
      className="fixed top-0 w-full z-50 border-b"
      style={{
        background: "rgba(19,19,24,0.85)",
        backdropFilter: "blur(20px)",
        borderColor: "rgba(0,255,136,0.1)",
      }}
    >
      <div className="flex justify-between items-center px-4 md:px-6 h-14 max-w-[1440px] mx-auto">
        <div className="flex items-center gap-5">
          <button
            onClick={() => nav("")}
            className="text-lg font-bold text-fission-green flex items-center gap-2 font-headline tracking-tighter bg-transparent border-none p-0"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-fission-green" /> Fission
          </button>
          <div className="flex gap-0.5">
            {(
              [
                ["Markets", "markets", isMk],
                ["Swap", "swap", route.page === "swap"],
                ["Dashboard", "dashboard", route.page === "dashboard"],
              ] as const
            ).map(([l, h, a]) => (
              <button
                key={h}
                onClick={() => nav(h)}
                className={`px-3 py-1.5 text-xs font-label tracking-wider transition-all bg-transparent border-none ${a ? "text-fission-on-surface bg-fission-surface-high" : "text-slate-500 hover:text-slate-300"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 text-[10px] font-label text-slate-500 tracking-widest uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-fission-green animate-pulse" />
            Canton LocalNet
          </div>
          <WalletBtn />
        </div>
      </div>
    </nav>
  );
}

// ─── Landing ───
function Landing({ nav }: { nav: (h: string) => void }) {
  return (
    <div className="min-h-screen" style={{ background: "#131318" }}>
      <header className="flex items-center justify-between px-6 h-16 border-b border-fission-outline-var/10">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-fission-green" />
          <span className="text-lg font-headline font-bold text-fission-green tracking-tighter">
            Fission
          </span>
        </div>
        <button
          onClick={() => nav("markets")}
          className="bg-fission-green text-fission-on-primary px-5 py-2.5 font-label font-bold text-[10px] uppercase tracking-widest hover:brightness-110 border-none"
        >
          Launch App →
        </button>
      </header>
      <div
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(0,255,136,0.06) 0%, transparent 60%)",
        }}
      >
        <div className="max-w-[900px] mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-fission-green/5 border border-fission-green/10 rounded-full mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-fission-green animate-pulse" />
            <span className="text-[10px] font-label uppercase tracking-widest text-fission-green">
              Live on Canton LocalNet · HackCanton S1
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-headline font-bold leading-tight tracking-tighter mb-5">
            Split your yield.
            <br />
            <span className="text-fission-green">Trade your future.</span>
          </h1>
          <p className="text-slate-400 max-w-xl mx-auto text-base font-light leading-relaxed mb-8">
            Fission tokenises USYC and other yield-bearing real-world assets on Canton into
            tradeable Principal Tokens (PT) and Yield Tokens (YT). Daml-native, MEV-resistant,
            credentialed.
          </p>
          <button
            onClick={() => nav("markets")}
            className="bg-fission-green text-fission-on-primary px-10 py-4 font-label font-bold text-xs uppercase tracking-widest hover:brightness-110 pulse-glow border-none"
          >
            Start Trading
          </button>
          <div className="flex justify-center gap-12 mt-16 pt-8 border-t border-fission-outline-var/10 flex-wrap">
            {(
              [
                ["2", "Markets"],
                ["Dec/Mar", "Maturities"],
                ["Canton", "Network"],
                ["6", "Daml Packages"],
              ] as const
            ).map(([v, l]) => (
              <div key={l} className="text-center">
                <div className="text-xl md:text-2xl font-headline font-bold">{v}</div>
                <div className="text-[10px] font-label text-slate-500 uppercase tracking-widest mt-1">
                  {l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[1000px] mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <span className="text-[10px] font-label text-fission-green uppercase tracking-[0.3em] block mb-2">
            How it works
          </span>
          <h2 className="text-3xl font-headline font-bold tracking-tighter">
            Four steps to yield mastery
          </h2>
        </div>
        <div className="grid md:grid-cols-4 gap-1">
          {[
            { n: "01", t: "Wrap", d: "Wrap a yield-bearing asset (USYC) into Standardised Yield (SY)." },
            { n: "02", t: "Split", d: "Atomically split SY into Principal Token + Yield Token." },
            { n: "03", t: "Trade", d: "Buy PT for fixed yield or YT for leveraged exposure on the AMM." },
            { n: "04", t: "Redeem", d: "Redeem PT 1:1 at maturity. Claim YT yield any time." },
          ].map((s, i) => (
            <div
              key={s.n}
              className="p-7 bg-fission-surface-low border border-fission-outline-var/10"
              style={{ borderTop: i === 0 ? "2px solid rgba(0,255,136,0.3)" : undefined }}
            >
              <div
                className="w-10 h-10 bg-fission-green/10 border border-fission-green/20 flex items-center justify-center mb-5 animate-float"
                style={{ animationDelay: `${i * 0.3}s` }}
              >
                <span className="font-headline font-bold text-fission-green text-sm">{s.n}</span>
              </div>
              <h3 className="font-headline font-bold text-base mb-2">{s.t}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-[1000px] mx-auto px-6 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-headline font-bold tracking-tighter">Choose your strategy</h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {STRATS.map((s) => (
            <button
              key={s.id}
              onClick={() => nav("markets")}
              className="text-left frosted-console border border-fission-outline-var/15 overflow-hidden bg-transparent p-0"
              style={{ borderColor: `${s.color}15` }}
            >
              <div className="h-0.5" style={{ background: `linear-gradient(90deg,${s.color},transparent)` }} />
              <div className="p-5">
                <span className="text-2xl block mb-3">{s.icon}</span>
                <h3 className="font-headline font-bold text-base mb-0.5" style={{ color: s.color }}>
                  {s.title}
                </h3>
                <div className="text-[10px] font-label uppercase tracking-widest mb-3" style={{ color: s.color }}>
                  {s.subtitle}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <footer className="border-t border-fission-outline-var/10 px-6 py-6">
        <div className="max-w-[1000px] mx-auto flex justify-between items-center text-[10px] font-label text-slate-500 flex-wrap gap-2">
          <span className="font-bold text-slate-400">Fission Protocol · Canton</span>
          <a
            href="https://github.com/penguinpecker/fission-protocol-canton"
            target="_blank"
            rel="noreferrer"
            className="hover:text-fission-green border-none"
            style={{ color: "inherit" }}
          >
            GitHub
          </a>
          <span>JSON Ledger API V2</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Markets ───
function Markets({ nav }: { nav: (h: string) => void }) {
  const { data: markets } = useMarkets();
  const { data: assets } = useAssets();
  const mkts = useMemo(() => deriveMkts(markets), [markets]);
  const apr = assets?.[0]?.apr ? (parseFloat(assets[0].apr) * 100).toFixed(2) : "—";
  const rate = assets?.[0]?.currentRate ? parseFloat(assets[0].currentRate).toFixed(4) : "—";

  return (
    <div className="pt-20 pb-20 px-6 max-w-[900px] mx-auto">
      <h1 className="text-3xl font-headline font-bold tracking-tighter mb-1">Markets</h1>
      <p className="text-slate-400 text-sm mb-8">
        USYC oracle: rate <span className="text-fission-green font-label">{rate}</span>, apr{" "}
        <span className="text-fission-green font-label">{apr}%</span>
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        {mkts.map((mk) => {
          const sy = parseFloat(mk.market.poolSyReserve);
          const pt = parseFloat(mk.market.poolPtReserve);
          const tvl = sy + pt;
          const has = tvl > 0;
          const apy = (parseFloat(mk.market.impliedApy) * 100).toFixed(2);
          return (
            <button
              key={mk.idx}
              onClick={() => nav(`strategy/${mk.idx}`)}
              className="text-left bg-fission-surface-low border border-fission-outline-var/10 p-6 hover:border-fission-green/20 transition-all bg-transparent"
            >
              <div className="flex justify-between items-start mb-5">
                <div className="flex gap-3 items-center">
                  <div
                    className="w-11 h-11 bg-fission-surface-highest flex items-center justify-center text-xl font-headline font-bold"
                    style={{ color: mk.accent }}
                  >
                    {mk.market.assetCode[0]}
                  </div>
                  <div>
                    <div className="text-lg font-headline font-bold">
                      {mk.market.ptInstrumentId}
                    </div>
                    <div className="text-[10px] font-label text-slate-500 uppercase tracking-widest">
                      Hashnote/Circle · USYC · {mk.market.maturity.iso.slice(0, 10)}
                    </div>
                  </div>
                </div>
                <span
                  className="text-[9px] font-label px-2 py-1 uppercase tracking-wider"
                  style={{
                    background: `${mk.accent}12`,
                    color: mk.accent,
                    border: `1px solid ${mk.accent}20`,
                  }}
                >
                  {mk.label}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {(
                  [
                    ["Implied APY", `${apy}%`, "#00ff88"],
                    ["Pool TVL", has ? `${tvl.toFixed(0)} SY+PT` : "Empty", "#e4e1e9"],
                    ["Maturity", `${mk.market.maturity.daysToMaturity}d`, "#E97880"],
                    ["Status", has ? "Active" : "Needs LP", "#ff6b35"],
                  ] as const
                ).map(([l, v, c]) => (
                  <div key={l}>
                    <div className="text-[9px] font-label text-slate-600 uppercase tracking-widest mb-1">
                      {l}
                    </div>
                    <div className="text-sm font-headline font-bold" style={{ color: c }}>
                      {v}
                    </div>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Strategy ───
function Strategy({ mi, nav }: { mi: number; nav: (h: string) => void }) {
  const { data: markets } = useMarkets();
  const mkts = useMemo(() => deriveMkts(markets), [markets]);
  const m = mkts[mi];
  if (!m) return <Loading />;
  const has = parseFloat(m.market.poolSyReserve) + parseFloat(m.market.poolPtReserve) > 0;
  const apy = (parseFloat(m.market.impliedApy) * 100).toFixed(2);
  const charts: Record<string, any[]> = {
    split: mkMini(7, 2),
    fixed: ptMini(0.94),
    long: mkMini(15, 6),
    earn: mkMini(10, 3),
  };
  return (
    <div className="pt-20 pb-20 px-6 max-w-[1020px] mx-auto">
      <button
        onClick={() => nav("markets")}
        className="text-xs font-label text-slate-500 hover:text-fission-green mb-6 block bg-transparent border-none p-0"
      >
        ← Back to Markets
      </button>
      <div className="flex items-center gap-3 mb-1">
        <div
          className="w-9 h-9 bg-fission-surface-highest flex items-center justify-center font-headline font-bold"
          style={{ color: m.accent }}
        >
          {m.market.assetCode[0]}
        </div>
        <h1 className="text-2xl font-headline font-bold tracking-tighter">
          {m.market.ptInstrumentId} Market
        </h1>
      </div>
      <p className="text-sm text-slate-400 mb-2">
        Implied APY: <span className="text-fission-green font-label font-bold">{apy}%</span> ·
        Maturity:{" "}
        <span className="text-[#E97880] font-label">{m.market.maturity.iso.slice(0, 10)}</span>
      </p>

      {!has && (
        <div className="mb-6 p-3 bg-fission-orange/10 border border-fission-orange/20 text-xs text-fission-orange font-label">
          ⚠ AMM has no liquidity yet. Use <strong>Earn LP</strong> to seed the pool.
        </div>
      )}

      <div className="text-[10px] font-label text-fission-green uppercase tracking-[0.2em] mb-4 font-bold">
        Choose Your Strategy
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {STRATS.map((s) => {
          const needsAMM = s.id === "fixed" || s.id === "long";
          const disabled = needsAMM && !has;
          return (
            <button
              key={s.id}
              onClick={() => !disabled && nav(`trade/${mi}/${s.id}`)}
              className={`text-left bg-fission-surface-low border border-fission-outline-var/10 overflow-hidden transition-all bg-transparent p-0 ${disabled ? "opacity-40 cursor-not-allowed" : "hover:border-opacity-30"}`}
              style={{ borderColor: `${s.color}15` }}
            >
              <div className="h-0.5" style={{ background: `linear-gradient(90deg,${s.color},transparent)` }} />
              <div className="p-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xl">{s.icon}</span>
                  <div className="flex-1">
                    <div className="font-headline font-bold" style={{ color: s.color }}>
                      {s.title}
                    </div>
                    <div className="text-[10px] font-label" style={{ color: s.color }}>
                      {s.subtitle}
                    </div>
                  </div>
                  {disabled && (
                    <span className="text-[9px] font-label px-2 py-0.5 bg-fission-orange/10 text-fission-orange uppercase">
                      Needs LP
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">{s.desc}</p>
                <div className="flex gap-2">
                  <span
                    className="text-[9px] font-label px-2 py-0.5 uppercase"
                    style={{ background: `${s.color}12`, color: s.color }}
                  >
                    {s.risk} Risk
                  </span>
                </div>
              </div>
              <div className="h-14 opacity-50">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={charts[s.id]}>
                    <defs>
                      <linearGradient id={`gS${s.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={0.2} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      dataKey={s.id === "fixed" ? "price" : "v"}
                      stroke={s.color}
                      fill={`url(#gS${s.id})`}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Trade ───
function Trade({ mi, st, nav }: { mi: number; st: string; nav: (h: string) => void }) {
  const { party } = useWallet();
  const { data: markets } = useMarkets();
  const { data: portfolio } = usePortfolio();
  const mkts = useMemo(() => deriveMkts(markets), [markets]);
  const m = mkts[mi];
  const s = STRATS.find((x) => x.id === st) ?? STRATS[0];
  const mint = useMint();
  const swap = useSwap();
  const [amt, setAmt] = useState("");
  const [phase, setPhase] = useState<"idle" | "submitting" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  if (!m) return <Loading />;

  const apy = (parseFloat(m.market.impliedApy) * 100).toFixed(2);
  const sy = parseFloat(m.market.poolSyReserve);
  const pt = parseFloat(m.market.poolPtReserve);
  const tvl = sy + pt;
  const has = tvl > 0;
  const idx = parseFloat(m.market.currentIndex).toFixed(4);

  const positions = portfolio?.positions ?? [];
  const syHolding = positions.find((p) => p.kind === "SY" && p.instrumentId === "SY-USYC");
  const ptHolding = positions.find((p) => p.kind === "PT" && p.instrumentId === m.market.ptInstrumentId);
  const ytHolding = positions.find((p) => p.kind === "YT" && p.instrumentId === m.market.ytInstrumentId);
  const syBal = syHolding ? parseFloat(syHolding.amount).toFixed(4) : "0";
  const ptBal = ptHolding ? parseFloat(ptHolding.amount).toFixed(4) : "0";
  const ytBal = ytHolding ? parseFloat(ytHolding.amount).toFixed(4) : "0";

  const ptPrice = has ? (sy / (sy + pt)).toFixed(4) : "0.50";
  const ytPrice = has ? (1 - sy / (sy + pt)).toFixed(4) : "0.50";

  const rcv =
    s.id === "fixed"
      ? `PT-${m.label}`
      : s.id === "long"
        ? `YT-${m.label}`
        : s.id === "split"
          ? "PT + YT"
          : "Pool reserves";

  const out = amt
    ? (parseFloat(amt) * (s.id === "fixed" ? 1 / parseFloat(ptPrice || "0.97") : 1)).toFixed(4)
    : "0.0000";

  async function execute() {
    if (!amt || !party) return;
    setPhase("submitting");
    setErr(null);
    try {
      if (s.id === "split") {
        await mint.mutateAsync({
          marketAssetCode: m.market.assetCode,
          marketMaturityIso: m.market.maturity.iso,
          amount: amt,
        });
      } else if (s.id === "fixed") {
        await swap.mutateAsync({
          marketAssetCode: m.market.assetCode,
          marketMaturityIso: m.market.maturity.iso,
          kind: "SyToPt",
          amountIn: amt,
          minAmountOut: "0",
        });
      } else if (s.id === "long") {
        await swap.mutateAsync({
          marketAssetCode: m.market.assetCode,
          marketMaturityIso: m.market.maturity.iso,
          kind: "PtToSy",
          amountIn: amt,
          minAmountOut: "0",
        });
      } else {
        throw new Error(
          "Earn LP isn't exposed via the REST API in this build (the bootstrap script seeds LP).",
        );
      }
      setPhase("done");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setPhase("idle");
    }
  }

  return (
    <div className="pt-20 pb-20 px-6 max-w-[1100px] mx-auto">
      <button
        onClick={() => nav(`strategy/${mi}`)}
        className="text-xs font-label text-slate-500 hover:text-fission-green mb-5 block bg-transparent border-none p-0"
      >
        ← Back to Strategies
      </button>
      <div className="flex gap-6 flex-wrap">
        {/* LEFT — chart + details */}
        <div className="flex-1 min-w-[320px] space-y-4">
          <div className="frosted-console border border-fission-outline-var/15 p-5">
            <div className="flex justify-between items-center mb-4">
              <div className="flex gap-3 items-center">
                <div
                  className="w-8 h-8 bg-fission-surface-highest flex items-center justify-center font-headline font-bold text-sm"
                  style={{ color: m.accent }}
                >
                  {m.market.assetCode[0]}
                </div>
                <div>
                  <div className="font-headline font-bold">{m.market.ptInstrumentId}</div>
                  <div className="text-[10px] font-label text-slate-500">Hashnote/Circle USYC</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-headline font-bold" style={{ color: s.color }}>
                  {apy}%
                </div>
                <div className="text-[10px] font-label text-slate-500">Implied APY</div>
              </div>
            </div>
            <div className="text-[10px] font-label text-slate-500 uppercase tracking-widest mb-2">
              {st === "fixed" ? "PT Price Convergence" : "Yield Rate History"}
            </div>
            <ResponsiveContainer width="100%" height={200}>
              {st === "fixed" ? (
                <ComposedChart data={mkPT(parseFloat(ptPrice))}>
                  <defs>
                    <linearGradient id="gTr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.12} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="d" tick={false} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: "#54516A", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    domain={[0.93, 1.01]}
                  />
                  <Tooltip content={<ChartTip />} />
                  <Line
                    dataKey="target"
                    stroke="#54516A"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                  <Area
                    dataKey="price"
                    stroke={s.color}
                    fill="url(#gTr)"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              ) : (
                <ComposedChart data={mkYield(parseFloat(apy), 2)}>
                  <defs>
                    <linearGradient id="gTu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5C94FF" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#5C94FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="d" tick={false} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: "#54516A", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                    unit="%"
                  />
                  <Tooltip content={<ChartTip />} />
                  <Area
                    dataKey="underlying"
                    name="Underlying"
                    stroke="#5C94FF"
                    fill="url(#gTu)"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Area
                    dataKey="implied"
                    name="Implied"
                    stroke="#ff6b35"
                    fill="none"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Line
                    dataKey="fixed"
                    name="Fixed"
                    stroke="#00ff88"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>

          <div className="frosted-console border border-fission-outline-var/15 p-5">
            <div className="text-xs font-label text-slate-500 uppercase tracking-widest mb-3 font-bold">
              Market Details
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  ["Implied APY", `${apy}%`, "#5C94FF"],
                  ["PT Price", ptPrice, "#00ff88"],
                  ["YT Price", ytPrice, "#ff6b35"],
                  ["Maturity", `${m.market.maturity.daysToMaturity}d left`, "#E97880"],
                  ["TVL", has ? `${tvl.toFixed(0)} SY+PT` : "Empty", "#e4e1e9"],
                  ["PY-Index", idx, "#908DA0"],
                ] as [string, string, string][]
              ).map(([l, v, c]) => (
                <div key={l}>
                  <div className="text-[9px] font-label text-slate-600 uppercase tracking-widest mb-0.5">
                    {l}
                  </div>
                  <div className="text-xs font-headline font-bold" style={{ color: c }}>
                    {v}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {party && (parseFloat(ptBal) > 0 || parseFloat(ytBal) > 0) && (
            <div className="frosted-console border border-fission-outline-var/15 p-5">
              <div className="text-xs font-label text-slate-500 uppercase tracking-widest mb-3 font-bold">
                Your Positions
              </div>
              {[
                { t: m.market.ptInstrumentId, v: ptBal, c: "#00ff88" },
                { t: m.market.ytInstrumentId, v: ytBal, c: "#ff6b35" },
              ]
                .filter((p) => parseFloat(p.v) > 0)
                .map((p) => (
                  <div
                    key={p.t}
                    className="flex justify-between py-2 border-b border-fission-outline-var/10"
                  >
                    <span className="text-sm font-headline font-bold" style={{ color: p.c }}>
                      {p.t}
                    </span>
                    <span className="font-label text-sm">{parseFloat(p.v).toFixed(4)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* RIGHT — trade panel */}
        <div className="w-full md:w-[380px] flex-shrink-0">
          <div className="frosted-console border border-fission-outline-var/15 sticky top-20 overflow-hidden">
            <div
              className="flex items-center gap-3 px-5 py-4 border-b border-fission-outline-var/10"
              style={{ background: `${s.color}08` }}
            >
              <span className="text-xl">{s.icon}</span>
              <span className="font-headline font-bold" style={{ color: s.color }}>
                {s.title}
              </span>
              <span className="font-label text-xs font-bold ml-auto" style={{ color: s.color }}>
                {apy}% APY
              </span>
            </div>
            <div className="p-5 space-y-3">
              <div className="bg-fission-surface-high p-4">
                <div className="flex justify-between mb-2 text-[10px] font-label text-slate-500 uppercase tracking-wider">
                  <span>You pay</span>
                  <span className="cursor-pointer" onClick={() => setAmt(s.id === "long" ? ptBal : syBal)}>
                    Bal:{" "}
                    <span className="text-slate-400">
                      {parseFloat(s.id === "long" ? ptBal : syBal).toFixed(2)}
                    </span>{" "}
                    <span className="text-fission-green font-bold">MAX</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={amt}
                    onChange={(e) => setAmt(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-transparent border-none text-xl font-headline font-bold focus:ring-0 focus:outline-none placeholder:text-fission-surface-highest"
                  />
                  <div
                    className="px-3 py-1.5 bg-fission-bg font-headline font-bold text-sm"
                    style={{ color: m.accent }}
                  >
                    {s.id === "long" ? `PT-${m.label}` : "SY-USYC"}
                  </div>
                </div>
              </div>

              <div className="text-center text-fission-green text-lg">↓</div>

              <div className="bg-fission-bg/50 p-4">
                <div className="text-[10px] font-label text-slate-500 uppercase mb-2">You receive</div>
                <div className="flex items-center gap-2">
                  <span className="font-headline text-xl font-bold" style={{ color: s.color }}>
                    {out}
                  </span>
                  <span
                    className="ml-auto px-3 py-1 font-label text-xs font-bold"
                    style={{ color: s.color, background: `${s.color}12` }}
                  >
                    {rcv}
                  </span>
                </div>
              </div>

              <div className="text-xs">
                {(
                  [
                    ["APY", `${apy}%`, s.color],
                    ["Pool reserves", has ? `${sy.toFixed(0)} SY · ${pt.toFixed(0)} PT` : "Empty", "#908DA0"],
                    ["Settlement", s.id === "split" ? "Atomic (1 tx)" : "Sequencer batch", "#908DA0"],
                  ] as [string, string, string][]
                ).map(([l, v, c], i) => (
                  <div
                    key={l}
                    className="flex justify-between py-2"
                    style={{ borderBottom: i < 2 ? "1px solid rgba(59,75,61,0.2)" : "none" }}
                  >
                    <span className="text-slate-500">{l}</span>
                    <span className="font-label font-bold" style={{ color: c }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>

              {!party ? (
                <div className="w-full">
                  <WalletBtn />
                </div>
              ) : phase === "done" ? (
                <button
                  onClick={() => {
                    setPhase("idle");
                    setAmt("");
                  }}
                  className="w-full py-4 font-headline font-bold uppercase tracking-widest bg-fission-green text-fission-on-primary hover:brightness-110 border-none"
                >
                  ✓ Submitted — Trade Again
                </button>
              ) : (
                <button
                  onClick={execute}
                  disabled={!amt || parseFloat(amt) <= 0 || phase === "submitting"}
                  className="w-full py-4 font-headline font-bold uppercase tracking-widest hover:brightness-110 disabled:opacity-40 border-none"
                  style={{ background: s.color, color: "#003919" }}
                >
                  {phase === "submitting"
                    ? "Submitting…"
                    : !amt || parseFloat(amt) <= 0
                      ? "Enter amount above ↑"
                      : s.id === "split"
                        ? "Split SY → PT + YT"
                        : s.id === "fixed"
                          ? "Lock Fixed Yield"
                          : s.id === "long"
                            ? "Long Yield"
                            : "Add Liquidity (n/a)"}
                </button>
              )}

              {err && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 font-label break-all">
                  {err}
                </div>
              )}

              <div className="p-3 bg-fission-green/5 border border-fission-green/10 text-[10px] text-slate-400 leading-relaxed">
                {st === "split"
                  ? "POST /api/trade/mint → Daml MintPY: archives SY, mints PT + YT atomically. No AMM."
                  : st === "fixed"
                    ? "POST /api/trade/swap → SubmitSwap (SyToPt). The sequencer settles in batches."
                    : st === "long"
                      ? "POST /api/trade/swap → SubmitSwap (PtToSy). Convert PT, then split for YT."
                      : "AmmPool.ProvideLiquidity is exercised by the bootstrap script directly on the participant."}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Swap ───
function Swap() {
  const { party } = useWallet();
  const { data: markets } = useMarkets();
  const { data: portfolio } = usePortfolio();
  const mkts = useMemo(() => deriveMkts(markets), [markets]);
  const swap = useSwap();
  const [mki, setMki] = useState(0);
  const [dir, setDir] = useState<"SyToPt" | "PtToSy">("SyToPt");
  const [amt, setAmt] = useState("");
  const [phase, setPhase] = useState<"idle" | "submitting" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  if (mkts.length === 0) return <Loading />;
  const m = mkts[mki];
  const sy = parseFloat(m.market.poolSyReserve);
  const pt = parseFloat(m.market.poolPtReserve);
  const has = sy + pt > 0;
  const ptPrice = has ? (sy / (sy + pt)).toFixed(4) : "0.5000";
  const ytPrice = has ? (1 - sy / (sy + pt)).toFixed(4) : "0.5000";

  const positions = portfolio?.positions ?? [];
  const syBal =
    positions.find((p) => p.kind === "SY" && p.instrumentId === "SY-USYC")?.amount ?? "0";
  const ptBal =
    positions.find((p) => p.kind === "PT" && p.instrumentId === m.market.ptInstrumentId)?.amount ?? "0";

  const fBal = dir === "SyToPt" ? syBal : ptBal;
  const fSym = dir === "SyToPt" ? "SY-USYC" : m.market.ptInstrumentId;
  const tSym = dir === "SyToPt" ? m.market.ptInstrumentId : "SY-USYC";
  const outAmt = amt ? (parseFloat(amt) * 0.997).toFixed(4) : "0.0000";

  async function execute() {
    if (!amt || !party) return;
    setPhase("submitting");
    setErr(null);
    try {
      await swap.mutateAsync({
        marketAssetCode: m.market.assetCode,
        marketMaturityIso: m.market.maturity.iso,
        kind: dir,
        amountIn: amt,
        minAmountOut: "0",
      });
      setPhase("done");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setPhase("idle");
    }
  }

  return (
    <div className="pt-20 pb-20 px-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-headline font-bold tracking-tighter mb-1">Swap</h1>
      <p className="text-slate-400 text-sm mb-6">Trade PT against SY on the batch-sequenced AMM</p>
      {!has && (
        <div className="mb-4 p-3 bg-fission-orange/10 border border-fission-orange/20 text-xs text-fission-orange font-label">
          ⚠ AMM has no liquidity. Bootstrap seeds it on first run.
        </div>
      )}
      <div className="flex gap-2 mb-4">
        {mkts.map((mk, i) => (
          <button
            key={i}
            onClick={() => setMki(i)}
            className={`flex-1 py-2.5 font-label text-[10px] uppercase tracking-widest transition-all border ${mki === i ? "bg-fission-green/10 border-fission-green/20 text-fission-green" : "bg-fission-surface-low border-fission-outline-var/10 text-slate-500"}`}
          >
            {mk.market.ptInstrumentId}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-3 bg-fission-surface-low border-l-2 border-fission-green">
          <div className="text-[9px] font-label text-slate-500 uppercase mb-0.5">PT Price</div>
          <div className="text-lg font-headline font-bold">{ptPrice}</div>
        </div>
        <div className="p-3 bg-fission-surface-low border-l-2 border-fission-orange">
          <div className="text-[9px] font-label text-slate-500 uppercase mb-0.5">YT Price</div>
          <div className="text-lg font-headline font-bold text-fission-orange">{ytPrice}</div>
        </div>
      </div>
      <div className="frosted-console border border-fission-outline-var/15 overflow-hidden">
        <div className="flex border-b border-fission-outline-var/10">
          {(["SyToPt", "PtToSy"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDir(d)}
              className={`flex-1 py-3 font-label text-[10px] uppercase tracking-widest border-none bg-transparent ${dir === d ? (d === "SyToPt" ? "text-fission-green border-b-2 border-fission-green bg-fission-green/5" : "text-fission-orange border-b-2 border-fission-orange bg-fission-orange/5") : "text-slate-500"}`}
            >
              {d === "SyToPt" ? "Buy PT (SY → PT)" : "Sell PT (PT → SY)"}
            </button>
          ))}
        </div>
        <div className="p-6 space-y-4">
          <div>
            <div className="flex justify-between mb-2 text-[10px] font-label text-slate-500 uppercase">
              <span>You sell</span>
              <span className="cursor-pointer" onClick={() => setAmt(fBal)}>
                Bal: {parseFloat(fBal).toFixed(2)}{" "}
                <span className="text-fission-green font-bold">MAX</span>
              </span>
            </div>
            <div className="flex items-center gap-2 bg-fission-surface-high p-4">
              <span className="font-headline font-bold text-sm">{fSym}</span>
              <input
                type="number"
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-transparent border-none text-right text-xl font-headline font-bold focus:ring-0 focus:outline-none placeholder:text-fission-surface-highest"
              />
            </div>
          </div>
          <div className="text-center text-fission-green">↓</div>
          <div className="bg-fission-bg/50 p-4">
            <div className="text-[10px] font-label text-slate-500 uppercase mb-2">You receive</div>
            <div className="flex justify-between">
              <span className="font-headline font-bold text-sm">{tSym}</span>
              <span className="font-headline text-xl font-bold">{outAmt}</span>
            </div>
          </div>
          {!party ? (
            <WalletBtn />
          ) : phase === "done" ? (
            <button
              onClick={() => {
                setPhase("idle");
                setAmt("");
              }}
              className="w-full py-4 font-headline font-bold uppercase tracking-widest bg-fission-green text-fission-on-primary border-none"
            >
              ✓ Submitted — Swap Again
            </button>
          ) : (
            <button
              onClick={execute}
              disabled={!amt || parseFloat(amt) <= 0 || phase === "submitting"}
              className="w-full py-4 font-headline font-bold uppercase tracking-widest hover:brightness-110 disabled:opacity-40 border-none"
              style={{
                background: dir === "SyToPt" ? "#00ff88" : "#ff6b35",
                color: dir === "SyToPt" ? "#003919" : "#fff",
              }}
            >
              {phase === "submitting"
                ? "Submitting…"
                : !amt || parseFloat(amt) <= 0
                  ? "Enter amount above ↑"
                  : "Submit Swap"}
            </button>
          )}
          {err && (
            <div className="p-2 bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 font-label break-all">
              {err}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ───
function Dash() {
  const { party, displayName } = useWallet();
  const { data: portfolio } = usePortfolio();
  const claim = useClaim();

  if (!party)
    return (
      <div className="pt-20 pb-20 px-6 max-w-[900px] mx-auto text-center" style={{ paddingTop: "140px" }}>
        <div className="text-4xl mb-4">🛡</div>
        <h2 className="text-2xl font-headline font-bold mb-2">Connect Your Wallet</h2>
        <p className="text-slate-400 mb-6">View your positions and accrued yield.</p>
        <WalletBtn />
      </div>
    );

  const positions = portfolio?.positions ?? [];
  const totalSy = portfolio?.totalValueSy ?? "0";

  const colorBy: Record<Position["kind"], string> = {
    SY: "#e4e1e9",
    PT: "#00ff88",
    YT: "#ff6b35",
    LP: "#a855f7",
  };

  return (
    <div className="pt-20 pb-20 px-6 max-w-[900px] mx-auto">
      <h1 className="text-2xl font-headline font-bold tracking-tighter mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {(
          [
            ["Connected", displayName ?? party.split("::")[0], "#00ff88"],
            ["Positions", `${positions.length}`, "#e4e1e9"],
            ["Total Value", `${parseFloat(totalSy).toFixed(2)} SY`, "#5C94FF"],
            ["Network", "Canton LocalNet", "#a855f7"],
          ] as [string, string, string][]
        ).map(([l, v, c]) => (
          <div key={l} className="p-4 bg-fission-surface-low border border-fission-outline-var/10">
            <div className="text-[9px] font-label text-slate-600 uppercase tracking-widest mb-1">
              {l}
            </div>
            <div className="text-sm font-headline font-bold" style={{ color: c }}>
              {v}
            </div>
          </div>
        ))}
      </div>
      <div className="frosted-console border border-fission-outline-var/15 p-5 mb-4">
        <div className="font-headline font-bold mb-4">Active Positions</div>
        {positions.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            No positions yet. Go to Markets → Split to get started.
          </div>
        )}
        {positions.map((p) => (
          <div
            key={p.contractId}
            className="flex justify-between items-center py-3 border-b border-fission-outline-var/10"
          >
            <div className="flex gap-3 items-center">
              <div
                className="w-8 h-8 bg-fission-surface-highest flex items-center justify-center text-[10px] font-headline font-bold"
                style={{ color: colorBy[p.kind] }}
              >
                {p.kind}
              </div>
              <div>
                <div className="font-headline font-bold text-sm">{p.instrumentId}</div>
                <div className="text-[10px] font-label text-slate-500">
                  {p.kind === "PT"
                    ? "Fixed yield · redeemable 1:1 at maturity"
                    : p.kind === "YT"
                      ? "Variable yield · accrues against PY-Index"
                      : p.kind === "LP"
                        ? "Liquidity provider · earns swap fees"
                        : "Standardised yield wrapper"}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-headline font-bold" style={{ color: colorBy[p.kind] }}>
                {parseFloat(p.amount).toFixed(4)}
              </div>
              {p.kind === "YT" && p.claimableYield && parseFloat(p.claimableYield) > 0 && (
                <button
                  onClick={() => claim.mutate(p.contractId)}
                  disabled={claim.isPending}
                  className="text-[10px] font-label text-fission-green hover:brightness-110 bg-transparent border-none p-0 mt-0.5"
                >
                  {claim.isPending ? "Claiming…" : `Claim +${parseFloat(p.claimableYield).toFixed(4)}`}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="frosted-console border border-fission-outline-var/15 p-4">
        <div className="text-xs font-label text-slate-500 uppercase tracking-widest mb-1 font-bold">
          Party ID
        </div>
        <div className="font-label text-sm break-all">{party}</div>
        <div className="text-[10px] font-label text-slate-600 mt-1">Canton LocalNet · JSON Ledger API V2</div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="pt-32 px-6 max-w-[900px] mx-auto text-center text-slate-500 font-label uppercase tracking-widest text-xs">
      loading…
    </div>
  );
}
