# Talos Frontend (Human UX)

Crypto-fintech style human dashboard for Talos (dark neon layout inspired by your reference).

## What it does

- Starkzap-first wallet connect (`starkzap_signer` or `starkzap_cartridge`)
- Fallback injected wallet mode (`injected`)
- Register agents (`identity.register_agent`)
- Approve settlement allowance for funding
- Live onchain activity feed from Talos modules

## Setup

1. Copy env file:

```bash
cp frontend/.env.example frontend/.env
```

2. Fill required values in `frontend/.env`:

- `VITE_RPC_URL`
- `VITE_IDENTITY_ADDRESS`
- `VITE_SETTLEMENT_ADDRESS`
- `VITE_REPUTATION_ADDRESS`
- `VITE_CORE_ADDRESS`

3. Pick wallet mode:

- `VITE_WALLET_MODE=starkzap_cartridge` (default)
- `VITE_WALLET_MODE=starkzap_signer`
- `VITE_WALLET_MODE=injected`

4. Install + run:

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

Frontend runs on `http://localhost:5174`.

## Starkzap integration notes

### `starkzap_signer` mode

Inject signer before user clicks connect:

```ts
window.__TALOS_STARKZAP_SIGNER__ = {
  getPubKey: async () => "0x...",
  signRaw: async (hash: string) => ["0x...", "0x..."]
};
```

This is where your Privy/Cartridge/KMS adapter should bridge into Starkzap signer interface.

### `starkzap_cartridge` mode

Optional cartridge options can be provided on window:

```ts
window.__TALOS_STARKZAP_CARTRIDGE_OPTIONS__ = {
  // cartridge connect options
};
```

## Notes

- No private key env variable is required for frontend mode.
- Funding action currently performs ERC20 `approve(settlement, amount)`.
- Amount input is raw smallest-unit amount.
- Starkzap dependency is patched postinstall for current ESM compatibility (`scripts/patch-starkzap.mjs`).
