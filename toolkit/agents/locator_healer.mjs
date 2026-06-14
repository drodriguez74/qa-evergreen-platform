// locator_healer.mjs — Layer 5 self-healing agent (plan §12, §5 toolkit tree).
//
// When a Playwright locator stops resolving (an accessible name/role drifted),
// the healer proposes the equivalent locator the screen *now* exposes, plus a
// CONFIDENCE score. A threshold (the plan's 90%) gates whether a heal is trusted
// — auto-merge stays off until the false-positive rate is measured (§21.4).
//
// Provider-agnostic by construction (plan R1): the model path goes through the
// model gateway's FAST tier (QA_MODEL_FAST — §17 tier table), never a vendor SDK.
// A deterministic string-similarity fallback runs when the gateway is down, so
// the agent is always exercisable — and the contrast between the two modes is
// itself informative (pure string matching can't resolve synonyms; the model can).

const GATEWAY_URL_DEFAULT = 'http://localhost:4100';

// --- string similarity (deterministic fallback) ----------------------------

function tokens(s) {
  return new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function levRatio(a, b) {
  a = String(a).toLowerCase(); b = String(b).toLowerCase();
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return m === n ? 1 : 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

function similarity(a, b) {
  return 0.6 * jaccard(a, b) + 0.4 * levRatio(a, b);
}

function healDeterministic(broken, candidates) {
  let best = null;
  for (const c of candidates) {
    let score = similarity(broken.name, c.name);
    if (broken.role && c.role && broken.role !== c.role) score *= 0.85; // role mismatch penalty
    if (!best || score > best.confidence) best = { role: c.role, name: c.name, confidence: score };
  }
  return { ...best, source: 'deterministic', reasoning: 'highest token+char similarity, role-matched' };
}

// --- model path (gateway, fast tier) ---------------------------------------

const HEAL_TOOL = {
  name: 'propose_heal',
  description: 'Propose the equivalent locator for a broken one, or abstain with low confidence.',
  input_schema: {
    type: 'object',
    properties: {
      role: { type: 'string', description: 'ARIA role of the chosen candidate, or empty if abstaining.' },
      name: { type: 'string', description: 'Accessible name of the chosen candidate, or empty if abstaining.' },
      confidence: { type: 'number', description: '0..1. Use < 0.5 when no candidate is a clear equivalent.' },
      reasoning: { type: 'string', description: 'One sentence.' },
    },
    required: ['role', 'name', 'confidence', 'reasoning'],
  },
};

async function healViaGateway(broken, candidates, gatewayUrl, repo) {
  const prompt = `A Playwright locator no longer resolves:
  getByRole('${broken.role}', { name: '${broken.name}' })

The screen currently exposes exactly these accessible nodes:
${candidates.map((c) => `  - role=${c.role} name="${c.name}"`).join('\n')}

Pick the SINGLE node that is the intended target of the broken locator (an accessible-name or role
drift of the same control). Return its role + accessible name and a calibrated confidence 0..1.
If none is a clear equivalent, set confidence below 0.5 (abstain). Call propose_heal once.`;

  const res = await fetch(`${gatewayUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: repo || 'fundflow',
      tier: 'fast',
      messages: [{ role: 'user', content: prompt }],
      tool: HEAL_TOOL,
      tool_choice: { type: 'tool', name: 'propose_heal' },
      max_tokens: 512,
      payload_types: ['locator', 'a11y-tree'],
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}`);
  const data = await res.json();
  const o = data.output;
  return {
    role: o.role, name: o.name,
    confidence: Math.max(0, Math.min(1, Number(o.confidence))),
    source: `gateway:${data.model}`, reasoning: o.reasoning,
  };
}

/**
 * Heal a broken locator against the candidate accessible nodes a screen exposes.
 * @param {{broken:{role,name}, candidates:Array<{role,name}>, gatewayUrl?:string, repo?:string, mode?:'auto'|'deterministic'}} opts
 * @returns {Promise<{role,name,confidence,source,reasoning}>}
 */
export async function heal({ broken, candidates, gatewayUrl = GATEWAY_URL_DEFAULT, repo, mode = 'auto' }) {
  if (mode !== 'deterministic') {
    try {
      return await healViaGateway(broken, candidates, gatewayUrl, repo);
    } catch {
      /* fall through to deterministic */
    }
  }
  return healDeterministic(broken, candidates);
}

export const _internals = { similarity, healDeterministic };
