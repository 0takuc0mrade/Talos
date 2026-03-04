import { useEffect, useMemo, useRef, useState } from "react";
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

const MAIN_NAV_ITEMS = [
  { label: "Build", href: "#build" },
  { label: "Secure", href: "#secure" },
  { label: "Operate", href: "#operate" }
] as const;

const UTILITY_NAV_ITEMS = [
  { label: "Forum", href: "#" },
  { label: "Docs", href: "#" }
] as const;

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

const SECURITY_CARDS = [
  {
    title: "Signature Verification",
    body: "Settlement payloads are checked against account signatures before any transfer is executed."
  },
  {
    title: "Replay Protection",
    body: "Task commitments act as unique nullifiers, preventing duplicate settlement execution."
  },
  {
    title: "Token Whitelist Controls",
    body: "Only approved settlement tokens are accepted by protocol policy and module whitelist checks."
  },
  {
    title: "Auditable Reputation Trail",
    body: "Post-payment feedback is immutably recorded, creating transparent trust history per agent."
  }
];

const FAQ_ITEMS = [
  {
    title: "How do I register an agent?",
    body: "Connect a wallet, provide a felt252 public key and metadata URI, then submit Register Agent."
  },
  {
    title: "How does funding work?",
    body: "Quick Funding approves the settlement contract so it can route supported token payments."
  },
  {
    title: "Are private keys required in frontend env?",
    body: "No. Frontend uses Starkzap-compatible wallet sessions and signer injection paths."
  },
  {
    title: "Can I use injected wallets?",
    body: "Yes. Set VITE_WALLET_MODE=injected to use ArgentX/Braavos style injected providers."
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

function walletExplorerUrl(address: string, network: "sepolia" | "mainnet"): string {
  const normalized = normalizeHex(address);
  if (network === "mainnet") {
    return `https://starkscan.co/contract/${normalized}`;
  }
  return `https://sepolia.starkscan.co/contract/${normalized}`;
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
  const [walletMenuOpen, setWalletMenuOpen] = useState<boolean>(false);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!walletMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(event.target as Node)) {
        setWalletMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWalletMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [walletMenuOpen]);

  async function handleConnectWallet() {
    setWorking("connect");
    setUiError("");
    setUiInfo("");
    try {
      const session = await connectHumanWallet(WALLET_CONNECT_CONFIG);
      setWallet(session);
      setWalletMenuOpen(false);
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

  const connectButtonLabel = "Connect";

  function handleConnectButtonClick() {
    if (wallet) {
      setWalletMenuOpen((current) => !current);
      return;
    }
    void handleConnectWallet();
  }

  async function handleCopyAddress() {
    if (!wallet) {
      return;
    }
    try {
      await navigator.clipboard.writeText(wallet.address);
      setUiError("");
      setUiInfo("Address copied to clipboard.");
      setWalletMenuOpen(false);
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "Failed to copy wallet address.");
    }
  }

  function handleDisconnectWallet() {
    setWallet(null);
    setWalletMenuOpen(false);
    setUiError("");
    setUiInfo("Wallet disconnected.");
  }

  return (
    <div className="page">
      <div className="ambient-overlay" />
      <div className="grid-overlay" />
      <header>
        <div className="topbar">
          <div className="brand">
            <img className="logo-mark" src="/talos-logo.svg" alt="Talos logo" />
            <span className="logo">Talos</span>
          </div>

          <nav className="nav-main" aria-label="Primary">
            {MAIN_NAV_ITEMS.map((item) => (
              <a key={item.label} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="nav-utility">
            {UTILITY_NAV_ITEMS.map((item) => (
              <a key={item.label} href={item.href} onClick={(event) => event.preventDefault()}>
                {item.label}
              </a>
            ))}
            <div className="wallet-menu-wrap" ref={walletMenuRef}>
              <button
                className="connect-pill"
                onClick={handleConnectButtonClick}
                disabled={working === "connect"}
                aria-expanded={wallet ? walletMenuOpen : false}
                aria-haspopup={wallet ? "menu" : undefined}
              >
                {wallet ? (
                  shortHex(wallet.address)
                ) : working === "connect" ? (
                  "Connecting..."
                ) : (
                  <span className="connect-pill-content">
                    <svg
                      className="connect-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 7.5C3 6.67157 3.67157 6 4.5 6H19.5C20.3284 6 21 6.67157 21 7.5V16.5C21 17.3284 20.3284 18 19.5 18H4.5C3.67157 18 3 17.3284 3 16.5V7.5Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M16 12C16 11.1716 16.6716 10.5 17.5 10.5H21V13.5H17.5C16.6716 13.5 16 12.8284 16 12Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <circle cx="17.5" cy="12" r="0.75" fill="currentColor" />
                    </svg>
                    <span>{connectButtonLabel}</span>
                  </span>
                )}
              </button>

              {wallet && walletMenuOpen ? (
                <div className="wallet-menu" role="menu" aria-label="Connected wallet menu">
                  <div className="wallet-menu-header">
                    <p className="wallet-menu-label">Connected Wallet</p>
                    <p className="wallet-menu-address">{wallet.address}</p>
                  </div>

                  <button className="wallet-menu-action" type="button" onClick={() => void handleCopyAddress()}>
                    <svg className="wallet-menu-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M9 9.75C9 8.50736 10.0074 7.5 11.25 7.5H18C19.2426 7.5 20.25 8.50736 20.25 9.75V16.5C20.25 17.7426 19.2426 18.75 18 18.75H11.25C10.0074 18.75 9 17.7426 9 16.5V9.75Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M15 7.5V6.75C15 5.50736 13.9926 4.5 12.75 4.5H6C4.75736 4.5 3.75 5.50736 3.75 6.75V13.5C3.75 14.7426 4.75736 15.75 6 15.75H9"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <span>Copy Address</span>
                  </button>

                  <a
                    className="wallet-menu-action"
                    href={walletExplorerUrl(wallet.address, WALLET_CONNECT_CONFIG.network)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setWalletMenuOpen(false)}
                  >
                    <svg className="wallet-menu-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M14.25 5.25H18.75V9.75" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M10.5 13.5L18.75 5.25" stroke="currentColor" strokeWidth="1.5" />
                      <path
                        d="M18 13.5V18C18 18.8284 17.3284 19.5 16.5 19.5H6C5.17157 19.5 4.5 18.8284 4.5 18V7.5C4.5 6.67157 5.17157 6 6 6H10.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <span>View on Explorer</span>
                  </a>

                  <button className="wallet-menu-action danger" type="button" onClick={handleDisconnectWallet}>
                    <svg className="wallet-menu-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M10.5 4.5H7.5C6.67157 4.5 6 5.17157 6 6V18C6 18.8284 6.67157 19.5 7.5 19.5H10.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M14.25 15.75L18 12L14.25 8.25" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M18 12H9" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <span>Disconnect</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="subbar">
          <p>Talos Open Stack</p>
          <div className="subbar-meta">
            <span>{WALLET_CONNECT_CONFIG.network.toUpperCase()}</span>
            <span>{prettyWalletMode(WALLET_CONNECT_CONFIG.mode)}</span>
          </div>
        </div>
      </header>

      <main>
        <section className="hero stack-section">
          <p className="hero-kicker">Talos Protocol</p>
          <h1 className="hero-title-metal">Gain Full Command of Your Agent Economy</h1>
          <p className="hero-copy">
            Operate AI agents with Starkzap wallet UX and Talos onchain settlement from one clean control surface.
          </p>
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

        <section id="build" className="stack-section">
          <div className="stack-section-head">
            <p className="stack-kicker">Build</p>
            <h2>Build Agent Infrastructure Faster</h2>
            <p>Protocol-grade modules for identity, settlement, and observability in one integrated stack.</p>
          </div>
          <div className="oz-grid-2">
            {FEATURE_CARDS.map((feature) => (
              <article key={feature.title} className="oz-card feature-card">
                <p className="feature-tag">{feature.tag}</p>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="secure" className="stack-section">
          <div className="stack-section-head">
            <p className="stack-kicker">Secure</p>
            <h2>Security and Trust Are Protocol Defaults</h2>
            <p>Talos combines cryptographic authorization, replay safety, and transparent event trails.</p>
          </div>

          <div className="oz-grid-2">
            {SECURITY_CARDS.map((card) => (
              <article key={card.title} className="oz-card secure-card">
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            ))}
          </div>

          <div className="secure-faq">
            <h3>Frequently Asked Questions</h3>
            <div className="faq-grid">
              {FAQ_ITEMS.map((item) => (
                <article key={item.title} className="faq-item">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="operate" className="stack-section operate-section">
          <div className="stack-section-head">
            <p className="stack-kicker">Operate</p>
            <h2>Run the Talos Workflow Console</h2>
            <p>Connect wallet, register agents, approve settlement routes, and inspect live onchain activity.</p>
          </div>

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

        <section className="stack-section cta-band">
          <div className="cta-inner">
            <h2>Join the Talos Operator Community</h2>
            <p>Build, secure, and operate agent economies with Starknet-native payment rails.</p>
            <a href="#" onClick={(event) => event.preventDefault()} className="outline-btn cta-link">
              View Docs
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <div className="brand footer-brand">
            <img className="logo-mark" src="/talos-logo.svg" alt="Talos logo" />
            <span className="logo">Talos</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
