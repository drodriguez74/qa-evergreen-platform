// credentials.js — pluggable CREDENTIAL-PROVIDER abstraction (PILOT seam, R3).
//
// The gateway already holds the provider key in-process and never returns it.
// This module makes the *source* of that key swappable WITHOUT touching adapters:
// adapters call credentials.get('ANTHROPIC_API_KEY') instead of reading
// process.env directly, so the same adapter code works whether the secret comes
// from an env file today or Azure Key Vault / Azure AD later.
//
//   Interface (every provider implements):
//     get(keyName)   -> string | undefined     // the secret value, or undefined if absent
//     ready(keyName) -> boolean                 // is THIS keyName resolvable right now?
//
// Active provider is selected by QA_CRED_PROVIDER (default 'env'). This is the
// verifiable seam for PILOT-grade secret handling — it is NOT a commitment to
// Azure. The owner deferred that decision; the default stays `env`.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- shared .env loading cascade ------------------------------------------
// Preserves server.js's historical behavior EXACTLY: process.env wins, then the
// gateway's own .env, then steel-thread/.env (where the POC key already lives).
// Moved here so the `env` credential provider owns env materialization and
// `npm start` still works out of the box (no regression).
//
// Original cascade only loaded files when ANTHROPIC_API_KEY was still unset;
// we keep that guard so we never clobber an explicitly-exported process.env.
let _envLoaded = false;
function loadEnvCascade() {
  if (_envLoaded) return;
  _envLoaded = true;
  for (const envPath of [join(__dirname, '.env'), join(__dirname, '..', '..', 'steel-thread', '.env')]) {
    if (!process.env.ANTHROPIC_API_KEY && typeof process.loadEnvFile === 'function') {
      try { process.loadEnvFile(envPath); } catch { /* optional */ }
    }
  }
}

// --- provider: env (DEFAULT) ----------------------------------------------
// Returns process.env[keyName], after running the historical .env cascade.
const envProvider = {
  name: 'env',
  get(keyName) {
    loadEnvCascade();
    return process.env[keyName];
  },
  ready(keyName) {
    return Boolean(this.get(keyName));
  },
};

// --- provider: azure-keyvault (INTERFACE-COMPLETE, pending real Azure) -----
// Modeled on adapters/azure-openai.js: the interface is real and reviewable,
// the request shaping against the Key Vault REST API is real, but it is NOT
// wired to a live tenant. It returns not-ready (and get() returns undefined)
// unless AZURE_KEY_VAULT_URL plus an auth mechanism are configured.
//
// Auth: a bearer token is required for the Key Vault data-plane. In a real
// PILOT this comes from Azure AD (managed identity / client credentials /
// DefaultAzureCredential). To avoid adding an npm dependency we accept a
// pre-acquired token via AZURE_KEY_VAULT_TOKEN as the explicit, marked stub
// for the AD step; the live token-acquisition flow is the documented follow-up.
//
// NOTE: synchronous get()/ready() is required by the adapter contract (ready()
// is sync). The Key Vault REST call is async, so this provider populates an
// in-memory cache on first ready()/preload and serves get() from it. Until a
// real tenant + token exist, the cache stays empty and ready() reports false —
// which is exactly the "seam switches cleanly" behavior we verify.
const AZ_KV_URL = () => process.env.AZURE_KEY_VAULT_URL;            // e.g. https://my-vault.vault.azure.net
const AZ_KV_TOKEN = () => process.env.AZURE_KEY_VAULT_TOKEN;        // PILOT: replace with Azure AD token acquisition
const AZ_KV_API_VERSION = () => process.env.AZURE_KEY_VAULT_API_VERSION || '7.4';

const _kvCache = new Map(); // keyName -> secret value

// Map a gateway key name (UPPER_SNAKE) to a Key Vault secret name (kebab-case).
// Key Vault secret names allow only alphanumerics and dashes.
function kvSecretName(keyName) {
  return keyName.toLowerCase().replace(/_/g, '-');
}

const azureKeyVaultProvider = {
  name: 'azure-keyvault',
  configured() {
    return Boolean(AZ_KV_URL() && AZ_KV_TOKEN());
  },
  // Real REST shaping (not exercised without a live tenant + token). Caches the
  // resolved value so the sync get()/ready() contract can be satisfied.
  async fetchSecret(keyName) {
    if (!this.configured()) return undefined;
    const url = `${AZ_KV_URL()}/secrets/${kvSecretName(keyName)}?api-version=${AZ_KV_API_VERSION()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${AZ_KV_TOKEN()}` },
    });
    if (!res.ok) {
      throw new Error(`azure-keyvault HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    const value = data.value;
    if (value) _kvCache.set(keyName, value);
    return value;
  },
  get(keyName) {
    // Served from cache; populate via preload()/fetchSecret() before sync reads.
    return _kvCache.get(keyName);
  },
  ready(keyName) {
    // Not configured → cleanly not ready (the seam switches without crashing).
    if (!this.configured()) return false;
    // Configured but secret not yet cached → not ready until preloaded.
    return _kvCache.has(keyName);
  },
};

// --- registry --------------------------------------------------------------
const PROVIDERS = {
  env: envProvider,
  'azure-keyvault': azureKeyVaultProvider,
};

const ACTIVE_NAME = process.env.QA_CRED_PROVIDER || 'env';
const active = PROVIDERS[ACTIVE_NAME];
if (!active) {
  throw new Error(
    `unknown QA_CRED_PROVIDER "${ACTIVE_NAME}" (have: ${Object.keys(PROVIDERS).join(', ')})`,
  );
}

/** Name of the active credential provider (for /healthz surfacing). */
export function providerName() {
  return active.name;
}

/** Resolve a secret by key name through the active provider. */
export function get(keyName) {
  return active.get(keyName);
}

/** Is a given key resolvable through the active provider right now? */
export function ready(keyName) {
  return active.ready(keyName);
}

/**
 * Optional async warm-up for providers whose backing store is remote
 * (e.g. azure-keyvault). For the env provider this is a no-op. Safe to call at
 * boot; failures are swallowed so a misconfigured vault degrades to not-ready
 * rather than crashing the gateway.
 */
export async function preload(keyNames = []) {
  if (typeof active.fetchSecret !== 'function') return;
  for (const keyName of keyNames) {
    try { await active.fetchSecret(keyName); } catch { /* stays not-ready */ }
  }
}
