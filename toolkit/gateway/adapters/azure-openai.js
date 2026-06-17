// adapters/azure-openai.js — Azure OpenAI provider adapter (built & functional).
//
// Uses the Responses API (POST /openai/responses) with Bearer auth. Supports a
// corporate proxy via AZURE_OPENAI_PROXY for environments behind an outbound
// HTTP proxy. The neutral request (string OR text/image content blocks, R7
// structured output) maps to the Responses API shape, so flipping
// QA_MODEL_REASONING to `azure:<deployment>` needs zero caller changes (R1).
//
// Keys are obtained via the pluggable credential provider (credentials.js) so the
// secret SOURCE is swappable (env now; Azure Key Vault / Azure AD later) without
// changing this adapter.

import * as credentials from '../credentials.js';
import { HttpsProxyAgent } from 'https-proxy-agent';

const ENDPOINT = () => credentials.get('AZURE_OPENAI_ENDPOINT');   // e.g. https://<resource>.openai.azure.com
const API_KEY = () => credentials.get('AZURE_OPENAI_API_KEY');     // Bearer token
const API_VERSION = () => credentials.get('AZURE_OPENAI_API_VERSION') || '2025-04-01-preview';
const PROXY = () => credentials.get('AZURE_OPENAI_PROXY');         // e.g. http://corp-proxy.example.com:8080

export function ready() {
  return Boolean(ENDPOINT() && API_KEY());
}

// Azure strict json_schema requires additionalProperties:false on every object
// node. Inject it recursively before sending (the neutral tool schema may omit it).
function enforceAdditionalProperties(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(enforceAdditionalProperties);
  const out = { ...schema };
  if (out.type === 'object' && !('additionalProperties' in out)) {
    out.additionalProperties = false;
  }
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, enforceAdditionalProperties(v)]),
    );
  }
  if (out.items) out.items = enforceAdditionalProperties(out.items);
  return out;
}

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

function buildInput(messages) {
  return messages.map((m) => ({ role: m.role, content: mapContent(m.content) }));
}

export async function complete(req) {
  if (!ready()) {
    throw new Error('azure-openai not configured (set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY)');
  }

  const url = `${ENDPOINT()}/openai/responses?api-version=${API_VERSION()}`;

  const body = {
    model: req.model,
    input: buildInput(req.messages),
    max_output_tokens: req.max_tokens || 4096,
  };
  if (req.system) body.instructions = req.system;

  // R7: strict structured output via json_schema response format.
  if (req.tool) {
    body.text = {
      format: {
        type: 'json_schema',
        name: req.tool.name,
        schema: enforceAdditionalProperties(req.tool.input_schema),
        strict: true,
      },
    };
  }

  const fetchOptions = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY()}`,
    },
    body: JSON.stringify(body),
  };

  const proxy = PROXY();
  if (proxy) fetchOptions.agent = new HttpsProxyAgent(proxy);

  const res = await fetch(url, fetchOptions);
  if (!res.ok) {
    throw new Error(`azure-openai HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();

  const usage = {
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
  };

  // Extract text from the Responses API output structure.
  let text = '';
  if (data.output_text) {
    text = data.output_text;
  } else if (data.output) {
    for (const item of data.output) {
      if (item.type === 'message') {
        for (const block of item.content || []) {
          if (block.type === 'output_text') text += block.text;
        }
      }
    }
  }

  if (data.status === 'failed') {
    throw new Error(`azure-openai response failed: ${JSON.stringify(data.error || 'unknown')}`);
  }

  const output = req.tool ? JSON.parse(text) : text;
  return { output, usage };
}
