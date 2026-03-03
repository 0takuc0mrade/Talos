import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Signer } from "starknet";

function readSncastPrivateKey() {
  const accountsFile =
    process.env.TALOS_SMOKE_ACCOUNTS_FILE ??
    path.join(os.homedir(), ".starknet_accounts", "starknet_open_zeppelin_accounts.json");
  const accountNetwork = process.env.TALOS_SMOKE_ACCOUNT_NETWORK ?? "alpha-sepolia";
  const accountName = process.env.TALOS_SMOKE_ACCOUNT_NAME ?? "talos_admin";

  if (!fs.existsSync(accountsFile)) {
    throw new Error(
      `accounts file not found at ${accountsFile}. ` +
        "Set TALOS_SMOKE_ACCOUNTS_FILE or create/import an sncast account first.",
    );
  }

  const parsed = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
  const byNetwork = parsed?.[accountNetwork];
  if (!byNetwork || typeof byNetwork !== "object") {
    throw new Error(
      `network '${accountNetwork}' not found in ${accountsFile}. ` +
        "Set TALOS_SMOKE_ACCOUNT_NETWORK to your sncast network key.",
    );
  }

  const account = byNetwork?.[accountName];
  if (!account || typeof account !== "object") {
    throw new Error(
      `account '${accountName}' not found under '${accountNetwork}' in ${accountsFile}. ` +
        "Set TALOS_SMOKE_ACCOUNT_NAME to your sncast account name.",
    );
  }

  const privateKey = account.private_key;
  if (!privateKey || typeof privateKey !== "string") {
    throw new Error(
      `private_key missing for account '${accountName}' in ${accountsFile}. ` +
        "Use a non-keystore sncast account or implement a custom signer adapter.",
    );
  }

  return privateKey;
}

// Default signer adapter for local smoke tests.
// Reads private key from your existing sncast account file (no key in .env).
export default async function createSigner() {
  const privateKey = readSncastPrivateKey();
  return new Signer(privateKey);
}
