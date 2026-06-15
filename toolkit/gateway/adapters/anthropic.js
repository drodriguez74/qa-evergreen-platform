// adapters/anthropic.js — Anthropic provider adapter (built).
// Ported from steel-thread/thread/trace_compiler.mjs's direct SDK call so the
// compiler can stop importing a vendor SDK (R1/R3). Supports strict tool use
// (structured output, R7) and plain text completion.
//
// The key is obtained via the pluggable credential provider (credentials.js)
// rather than reading process.env directly, so the secret SOURCE is swappable
// (env now; Azure Key Vault / Azure AD later) without changing this adapter.

import * as credentials from '../credentials.js';

const KEY_NAME = 'ANTHROPIC_API_KEY';

let _client;

/** The provider key lives ONLY here, in the gateway process (R3). */
function client() {
  if (!_client) {
    // Lazy import so the gateway boots even if the SDK isn't installed yet.
    return import('@anthropic-ai/sdk').then(({ default: Anthropic }) => {
      _client = new Anthropic({ apiKey: credentials.get(KEY_NAME) });
      return _client;
    });
  }
  return Promise.resolve(_client);
}

export function ready() {
  return credentials.ready(KEY_NAME);
}

/**
 * @param {{model,system?,messages,tool?,tool_choice?,max_tokens?}} req
 * @returns {Promise<{output:any, usage:{input_tokens:number,output_tokens:number}}>}
 */
export async function complete(req) {
  const anthropic = await client();
  const params = {
    model: req.model,
    max_tokens: req.max_tokens || 4096,
    // messages pass straight through: content is either a plain string or an
    // array of native Anthropic content blocks (text/image), which the Messages
    // API accepts directly — so vision prompts work with no transformation here.
    messages: req.messages,
  };
  if (req.system) params.system = req.system;
  if (req.tool) {
    params.tools = [req.tool];
    params.tool_choice = req.tool_choice || { type: 'tool', name: req.tool.name };
  }

  const res = await anthropic.messages.create(params);
  const usage = {
    input_tokens: res.usage?.input_tokens ?? 0,
    output_tokens: res.usage?.output_tokens ?? 0,
  };

  if (req.tool) {
    const block = res.content.find((b) => b.type === 'tool_use' && b.name === req.tool.name);
    if (!block) throw new Error(`model did not return the "${req.tool.name}" tool call`);
    return { output: block.input, usage };
  }
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { output: text, usage };
}
