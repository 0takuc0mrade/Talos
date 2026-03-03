import { useEffect, useMemo, useState } from "react";
import {
  approveToken,
  checkTokenSupported,
  connectHumanWallet,
  getAgentCount,
  getRecentActivity,
  makeProvider,
  normalizeHex,
  registerAgent,
  shortHex,
  type ActivityEvent,
  type HumanWalletConnectConfig,
  type TalosAddresses,
  type TalosTokens,
  type WalletMode,
  type WalletSession
} from "./lib/talos";

interface TokenOption {
  symbol: keyof TalosTokens;
  address: string;
}

interface UiTx {
  hash: string;
  label: string;
}

function nowMetadataUri(): string {
  return `ipfs://talos/agent/${Date.now()}`;
}

const env = import.meta.env;

function parseWalletMode(value: string | undefined): WalletMode {
  if (value === "starkzap_signer" || value === "starkzap_cartridge" || value === "injected") {
    return value;
  }
  return "starkzap_cartridge";
}

function parseStarknetNetwork(value: string | undefined): "sepolia" | "mainnet" {
  return value?.toLowerCase() === "mainnet" ? "mainnet" : "sepolia";
}

function parseFeeMode(value: string | undefined): "user_pays" | "sponsored" {
  return value === "sponsored" ? "sponsored" : "user_pays";
}

const ADDRESSES: TalosAddresses = {
  identity: env.VITE_IDENTITY_ADDRESS ?? "",
  settlement: env.VITE_SETTLEMENT_ADDRESS ?? "",
  reputation: env.VITE_REPUTATION_ADDRESS ?? "",
  core: env.VITE_CORE_ADDRESS ?? ""
};

const TOKENS: TalosTokens = {
  STRK: env.VITE_TOKEN_STRK_ADDRESS,
  USDC: env.VITE_TOKEN_USDC_ADDRESS,
  WBTC: env.VITE_TOKEN_WBTC_ADDRESS,
  STRKBTC: env.VITE_TOKEN_STRKBTC_ADDRESS
};

const REQUIRED_ENV = [
  "VITE_RPC_URL",
  "VITE_IDENTITY_ADDRESS",
  "VITE_SETTLEMENT_ADDRESS",
  "VITE_REPUTATION_ADDRESS",
  "VITE_CORE_ADDRESS"
] as const;

const WALLET_CONNECT_CONFIG: HumanWalletConnectConfig = {
  mode: parseWalletMode(env.VITE_WALLET_MODE),
  rpcUrl: env.VITE_RPC_URL ?? "",
  network: parseStarknetNetwork(env.VITE_STARKZAP_NETWORK ?? env.VITE_NETWORK),
  feeMode: parseFeeMode(env.VITE_STARKZAP_FEE_MODE),
  autoEnsureReady: String(env.VITE_STARKZAP_AUTO_ENSURE_READY ?? "false").toLowerCase() === "true"
};

const NAV_ITEMS = ["Dashboard", "Agents", "Funding", "Activity", "FAQ"];

const FEATURE_CARDS = [
  {
    title: "Starkzap Wallet UX",
    body: "Starkzap-first wallet onboarding with secure signer abstractions for humans.",
    tag: "Web3 Onboarding"
  },
  {
    title: "Atomic A2A Settlement",
    body: "Execute payment + reputation in one protocol transaction through Talos Core.",
    tag: "Protocol Safety"
  },
  {
    title: "Token Flexibility",
    body: "Approve and route supported settlement tokens with live whitelist checks.",
    tag: "Multi-Token"
  },
  {
    title: "Onchain Traceability",
    body: "Inspect recent protocol activity directly from Identity, Settlement, Reputation, and Core.",
    tag: "Ops Visibility"
  }
];

function getEnvIssues(): string[] {
  const issues: string[] = [];
  for (const key of REQUIRED_ENV) {
    if (!env[key]) {
      issues.push(`Missing ${key}`);
    }
  }
  return issues;
}

function formatDateTime(date: Date): string {
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatModuleName(module: ActivityEvent["module"]): string {
  if (module === "identity") {
    return "Identity";
  }
  if (module === "settlement") {
    return "Settlement";
  }
  if (module === "reputation") {
    return "Reputation";
  }
  return "Core";
}

function prettyWalletMode(mode: WalletMode): string {
  if (mode === "starkzap_signer") {
    return "Starkzap Signer";
  }
  if (mode === "starkzap_cartridge") {
    return "Starkzap Cartridge";
  }
  return "Injected";
}

function App() {
  const envIssues = useMemo(getEnvIssues, []);
  const provider = useMemo(() => (env.VITE_RPC_URL ? makeProvider(env.VITE_RPC_URL) : null), []);

  const tokens = useMemo<TokenOption[]>(() => {
    const out: TokenOption[] = [];
    for (const [symbol, address] of Object.entries(TOKENS) as Array<[keyof TalosTokens, string | undefined]>) {
      if (address && address.trim()) {
        out.push({ symbol, address: normalizeHex(address) });
      }
    }
    return out;
  }, []);

  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [agentCount, setAgentCount] = useState<string>("-");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [tokenSupported, setTokenSupported] = useState<Record<string, boolean>>({});
  const [registerPubKey, setRegisterPubKey] = useState<string>("");
  const [metadataUri, setMetadataUri] = useState<string>(nowMetadataUri());
  const [fundToken, setFundToken] = useState<string>(tokens[0]?.address ?? "");
  const [fundAmountRaw, setFundAmountRaw] = useState<string>("1");
  const [working, setWorking] = useState<"connect" | "register" | "fund" | "refresh" | null>(null);
  const [uiError, setUiError] = useState<string>("");
  const [uiInfo, setUiInfo] = useState<string>("");
  const [lastTx, setLastTx] = useState<UiTx | null>(null);

  async function refreshReadState() {
    if (!provider) {
      return;
    }
    setWorking("refresh");
    setUiError("");
    try {
      const [count, activity] = await Promise.all([
        getAgentCount(provider, ADDRESSES.identity),
        getRecentActivity(provider, ADDRESSES)
      ]);
      setAgentCount(count.toString());
      setEvents(activity);

      const supportPairs = await Promise.all(
        tokens.map(async (token) => ({
          symbol: token.symbol,
          supported: await checkTokenSupported(provider, ADDRESSES.settlement, token.address)
        }))
      );

      const supportMap: Record<string, boolean> = {};
      for (const pair of supportPairs) {
        supportMap[pair.symbol] = pair.supported;
      }
      setTokenSupported(supportMap);
    } catch (error) {
      setUiError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(null);
    }
  }

  useEffect(() => {
    void refreshReadState();
  }, []);

  async function handleConnectWallet() {
    setWorking("connect");
    setUiError("");
    setUiInfo("");
    try {
      const session = await connectHumanWallet(WALLET_CONNECT_CONFIG);
      setWallet(session);
      if (!registerPubKey) {
        setRegisterPubKey(session.address);
      }
    } catch (error) {
      setUiError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(null);
    }
  }

  async function handleRegisterAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider || !wallet) {
      setUiError("Connect wallet first.");
      return;
    }

    setWorking("register");
    setUiError("");
    setUiInfo("");

    try {
      const txHash = await registerAgent(wallet.account, ADDRESSES.identity, registerPubKey, metadataUri);
      await provider.waitForTransaction(txHash, {
        retries: 24,
        retryInterval: 2000,
        lifeCycleRetries: 4
      });
      setLastTx({ hash: txHash, label: "register_agent" });
      setUiInfo(`Agent registered in tx ${shortHex(txHash, 8, 6)}`);
      setMetadataUri(nowMetadataUri());
      await refreshReadState();
    } catch (error) {
      setUiError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(null);
    }
  }

  async function handleFundApprove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider || !wallet) {
      setUiError("Connect wallet first.");
      return;
    }
    if (!fundToken) {
      setUiError("Select a token.");
      return;
    }

    const amountRaw = fundAmountRaw.trim();
    if (!amountRaw) {
      setUiError("Enter amount in raw token units.");
      return;
    }

    setWorking("fund");
    setUiError("");
    setUiInfo("");

    try {
      const txHash = await approveToken(wallet.account, fundToken, ADDRESSES.settlement, BigInt(amountRaw));
      await provider.waitForTransaction(txHash, {
        retries: 24,
        retryInterval: 2000,
        lifeCycleRetries: 4
      });
      setLastTx({ hash: txHash, label: "approve" });
      setUiInfo(`Token approval sent in tx ${shortHex(txHash, 8, 6)}`);
      await refreshReadState();
    } catch (error) {
      setUiError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(null);
    }
  }

  const connectButtonLabel =
    WALLET_CONNECT_CONFIG.mode === "injected"
      ? "Connect Injected Wallet"
      : WALLET_CONNECT_CONFIG.mode === "starkzap_cartridge"
        ? "Connect Starkzap Cartridge"
        : "Connect Starkzap";

  return (
    <div className="page">
      <div className="ambient-overlay" />
      <div className="grid-overlay" />
      <header className="site-header">
        <div className="logo">Talos</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <a key={item} href="#" onClick={(event) => event.preventDefault()}>
              {item}
            </a>
          ))}
        </nav>
        <button className="outline-btn">Human UX Console</button>
      </header>

      <main>
        <section className="hero section">
          <p className="hero-kicker">Talos Protocol</p>
          <h1 className="hero-title-metal">Gain Full Command of Your Agent Economy</h1>
          <p className="hero-copy">
            Operate AI agents with Starkzap wallet UX and Talos onchain settlement from one clean control surface.
          </p>
          <button
            className="connect-pill"
            onClick={handleConnectWallet}
            disabled={working === "connect"}
          >
            {wallet ? `Connected ${shortHex(wallet.address)}` : working === "connect" ? "Connecting..." : connectButtonLabel}
          </button>
          <div className="hero-meta">
            <span>Trusted by modern A2A builders</span>
            <span>{WALLET_CONNECT_CONFIG.network.toUpperCase()} · {prettyWalletMode(WALLET_CONNECT_CONFIG.mode)}</span>
          </div>
        </section>

        {envIssues.length > 0 ? (
          <section className="banner error">
            <strong>Frontend env incomplete</strong>
            <ul>
              {envIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {uiError ? <section className="banner error">{uiError}</section> : null}
        {uiInfo ? <section className="banner info">{uiInfo}</section> : null}

        <section className="section">
          <div className="section-head">
            <h2>Why Talos Stands Out</h2>
            <p>Built for fast, safe, and composable agent-to-agent commerce on Starknet.</p>
          </div>
          <div className="feature-grid">
            {FEATURE_CARDS.map((feature) => (
              <article key={feature.title} className="feature-card">
                <p className="feature-tag">{feature.tag}</p>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section console-section">
          <div className="console-shell">
            <div className="console-main">
              <div className="hud-strip">
                <article className="hud-item">
                  <p className="hud-label">Registered Agents</p>
                  <h3 className="hud-value">{agentCount}</h3>
                </article>
                <article className="hud-item">
                  <p className="hud-label">Connected Wallet</p>
                  <h3 className="hud-value">{wallet ? shortHex(wallet.address, 8, 6) : "Not connected"}</h3>
                </article>
                <article className="hud-item">
                  <p className="hud-label">Last Transaction</p>
                  <h3 className="hud-value">{lastTx ? `${lastTx.label} ${shortHex(lastTx.hash, 8, 6)}` : "-"}</h3>
                </article>
                <article className="hud-item">
                  <p className="hud-label">Updated</p>
                  <h3 className="hud-value">{formatDateTime(new Date())}</h3>
                </article>
              </div>

              <div className="split-panels">
                <article className="card form-card">
                  <h3>Register Agent</h3>
                  <p className="card-copy">Add a new agent to Talos identity registry.</p>
                  <form onSubmit={handleRegisterAgent} className="form-stack">
                    <label>
                      <span className="field-label">Agent Public Key (felt252)</span>
                      <input
                        className="mono-input"
                        value={registerPubKey}
                        onChange={(event) => setRegisterPubKey(event.target.value)}
                        placeholder="0x..."
                        required
                      />
                    </label>
                    <label>
                      <span className="field-label">Metadata URI</span>
                      <input
                        className="mono-input"
                        value={metadataUri}
                        onChange={(event) => setMetadataUri(event.target.value)}
                        placeholder="ipfs://..."
                        required
                      />
                    </label>
                    <button className="cta-btn" disabled={working === "register" || !wallet}>
                      {working === "register" ? "Registering..." : "Register Agent"}
                    </button>
                  </form>
                </article>

                <article className="card form-card">
                  <h3>Quick Funding (Approve)</h3>
                  <p className="card-copy">Approve settlement contract to route x402 payments.</p>
                  <form onSubmit={handleFundApprove} className="form-stack">
                    <label>
                      <span className="field-label">Token</span>
                      <select value={fundToken} onChange={(event) => setFundToken(event.target.value)}>
                        {tokens.map((token) => (
                          <option key={token.symbol} value={token.address}>
                            {token.symbol} {tokenSupported[token.symbol] ? "(supported)" : "(not whitelisted)"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="field-label">Amount (raw smallest units)</span>
                      <input
                        value={fundAmountRaw}
                        onChange={(event) => setFundAmountRaw(event.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]+"
                        required
                      />
                    </label>
                    <button className="cta-btn" disabled={working === "fund" || !wallet}>
                      {working === "fund" ? "Approving..." : "Approve Settlement"}
                    </button>
                  </form>
                </article>
              </div>

              <article className="card activity-card">
                <div className="activity-head">
                  <div>
                    <h3>Recent Onchain Activity</h3>
                    <p className="card-copy">Identity · Settlement · Reputation · Core</p>
                  </div>
                  <button className="outline-btn" onClick={() => void refreshReadState()} disabled={working === "refresh"}>
                    {working === "refresh" ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Module</th>
                        <th>Block</th>
                        <th>Tx</th>
                        <th>From</th>
                        <th>Keys</th>
                        <th>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.length === 0 ? (
                        <tr>
                          <td colSpan={6}>No recent events yet.</td>
                        </tr>
                      ) : (
                        events.map((event) => (
                          <tr key={`${event.module}-${event.txHash}-${event.keys[0] ?? "k"}`}>
                            <td>{formatModuleName(event.module)}</td>
                            <td>{event.blockNumber}</td>
                            <td>{event.txHash ? shortHex(event.txHash, 8, 6) : "-"}</td>
                            <td>{shortHex(event.fromAddress, 8, 6)}</td>
                            <td>{event.keys.length}</td>
                            <td>{event.data.length}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="section faq-section">
          <div className="section-head">
            <h2>Frequently Asked Questions</h2>
            <p>Quick operational answers for Talos human operators.</p>
          </div>
          <div className="faq-grid">
            <div className="faq-item"><strong>How do I register?</strong><span>Connect wallet, input pub key + metadata URI, submit.</span></div>
            <div className="faq-item"><strong>How do I fund?</strong><span>Use approve to grant settlement allowance in selected token.</span></div>
            <div className="faq-item"><strong>Do I need private keys in env?</strong><span>No. Starkzap signer injection is supported in-browser.</span></div>
            <div className="faq-item"><strong>Can I use injected wallet?</strong><span>Yes, set <code>VITE_WALLET_MODE=injected</code>.</span></div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <p className="logo">Talos</p>
        </div>
        <div>
          <ul>
            <li>Identity</li>
            <li>Settlement</li>
            <li>Reputation</li>
            <li>Core Router</li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

export default App;
