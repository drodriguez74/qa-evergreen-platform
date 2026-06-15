// adapters/azure-openai.js — Azure OpenAI provider adapter (interface-complete,
// pending an in-tenant credential; plan §21.2 bake-off candidate).
//
// Deliberately uses fetch against the Azure REST API rather than adding an
// uninstalled SDK dependency: the request *shaping* is real and reviewable, and
// the bake-off runs the moment AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY land.
// A neutral `tool` (R7) maps to OpenAI structured outputs (json_schema response
// format); the adapter exposes the SAME complete()/ready() contract as anthropic.js,
// so flipping QA_MODEL_REASONING to `azure:gpt-5.2` needs zero caller changes (R1).
//
// Keys are obtained via the pluggable credential provider (credentials.js) so the
// secret SOURCE is swappable (env now; Azure Key Vault / Azure AD later) without
// changing this adapter.

import * as credentials from '../credentials.js';

const ENDPOINT = () => credentials.get('AZURE_OPENAI_ENDPOINT'); // e.g. https://x.openai.azure.com
const API_KEY = () => credentials.get('AZURE_OPENAI_API_KEY');   // PILOT: replace with Azure AD token
const API_VERSION = () => credentials.get('AZURE_OPENAI_API_VERSION') || '2024-10-21';

export function ready() {
  return Boolean(ENDPOINT() && API_KEY());
}

// Map a neutral message's content to OpenAI chat format. A plain string passes
// through unchanged (historical path); a content-block array (multimodal) is
// translated to OpenAI's parts shape so vision prompts work for contract parity:
//   {type:'text', text}                         -> {type:'text', text}
//   {type:'image', source:{base64, media_type}} -> {type:'image_url', image_url:{url:'data:<media_type>;base64,<data>'}}
function mapContent(content) {
  if (typeof content === 'string') return content;
  return content.map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if (b.type === 'image') {
      const { media_type, data } = b.source;
      return { type: 'image_url', image_url: { url: `data:${media_type};base64,${data}` } };
    }
    throw new Error(`azure-openai: unsupported content block type "${b.type}"`);
  });
}

export async function complete(req) {
  if (!ready()) {
    throw new Error('azure-openai not configured (set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY)');
  }
  // Map neutral messages → OpenAI chat format (system as a leading message).
  const messages = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  for (const m of req.messages) messages.push({ role: m.role, content: mapContent(m.content) });

  const body = { messages, max_completion_tokens: req.max_tokens || 4096 };
  // R7: strict structured output from the neutral tool's input_schema.
  if (req.tool) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: req.tool.name, schema: req.tool.input_schema, strict: true },
    };
  }

  const url = `${ENDPOINT()}/openai/deployments/${req.model}/chat/completions?api-version=${API_VERSION()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': API_KEY() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`azure-openai HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();

  const choice = data.choices?.[0]?.message?.content ?? '';
  const usage = {
    input_tokens: data.usage?.prompt_tokens ?? 0,
    output_tokens: data.usage?.completion_tokens ?? 0,
  };
  const output = req.tool ? JSON.parse(choice) : choice;
  return { output, usage };
}
