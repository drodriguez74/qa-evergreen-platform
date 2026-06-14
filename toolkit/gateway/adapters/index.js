// adapters/index.js — provider registry. One interface for every provider:
//   complete(neutralRequest) -> { output, usage }   and   ready() -> boolean
// Resolving a tier to an adapter is the only place provider names are mapped,
// keeping callers provider-agnostic (R1).

import * as anthropic from './anthropic.js';
import * as azureOpenai from './azure-openai.js';

const ADAPTERS = {
  anthropic,
  azure: azureOpenai,
};

export function getAdapter(provider) {
  const a = ADAPTERS[provider];
  if (!a) throw new Error(`unknown provider "${provider}" (have: ${Object.keys(ADAPTERS).join(', ')})`);
  return a;
}

export function providerReadiness() {
  return Object.fromEntries(Object.entries(ADAPTERS).map(([name, a]) => [name, a.ready()]));
}
