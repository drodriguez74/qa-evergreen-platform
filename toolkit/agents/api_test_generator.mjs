#!/usr/bin/env node
/**
 * api_test_generator.mjs — Layer 3 API-test generation (plan §10).
 *
 * Generic, PROFILE-DRIVEN. Reads the profile's OpenAPI spec and generates
 * @playwright/test API tests that assert BOTH the status code AND the response
 * schema (validated with zod) — which is what the plan counts toward strict API
 * coverage (§9). Model-driven via the gateway (reasoning tier): the gateway emits
 * the deterministic test files; the spec is the test of record.
 *
 * Output: <workDir>/api/*.api.spec.ts + <workDir>/api/api-coverage.json (manifest
 * of which operationIds got a schema-validating test — consumed by coverage.mjs).
 *
 * Usage: QA_PROFILE=fundflow node toolkit/agents/api_test_generator.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProfile } from '../profile.mjs';
import { callGateway } from '../gateway-client.mjs';

const profile = loadProfile();
if (!profile.api?.openapi) throw new Error(`profile ${profile.name} has no api.openapi`);
const WORK = profile.workDir;
const OUT = join(WORK, 'api');

const openapi = readFileSync(profile.api.openapi, 'utf8');
const baseURL = profile.api.baseURL;
const auth = profile.api.auth || null;

const TOOL = {
  name: 'emit_api_tests',
  description: 'Emit Playwright API tests (status + zod schema validation) for the OpenAPI spec.',
  input_schema: {
    type: 'object',
    properties: {
      specs: {
        type: 'array',
        description: 'One *.api.spec.ts file per tag/module.',
        items: {
          type: 'object',
          properties: { filename: { type: 'string' }, contents: { type: 'string' } },
          required: ['filename', 'contents'],
        },
      },
      covered: {
        type: 'array',
        description: 'Operations that got a status+schema test.',
        items: {
          type: 'object',
          properties: { operationId: { type: 'string' }, method: { type: 'string' }, path: { type: 'string' } },
          required: ['method', 'path'],
        },
      },
    },
    required: ['specs', 'covered'],
  },
};

function prompt() {
  return `You are the platform's API test generator. From this OpenAPI spec, emit @playwright/test API tests that validate BOTH the HTTP status code AND the response body SHAPE using zod. Call emit_api_tests once.

API base URL: ${baseURL}
${auth ? `Auth: POST ${auth.login} with { username: ${JSON.stringify(auth.username)}, password: ${JSON.stringify(auth.password)} } returns a token; send it as "Authorization: Bearer <token>" for endpoints with security. Do the login once in test.beforeAll and reuse the token.` : 'No auth configured.'}

OpenAPI spec:
${openapi}

RULES:
- Use @playwright/test: import { test, expect, request } from '@playwright/test'; and import { z } from 'zod'.
- Group tests by tag → one file per tag, filename "<tag>.api.spec.ts". Use an explicit APIRequestContext with baseURL '${baseURL}' (request.newContext).
- For EACH documented (method, path, status) on the happy path: call it (path params use realistic values discovered from a prior call, e.g. create a transfer then GET it by id), assert the exact status, and validate response JSON against a zod schema you DERIVE from the OpenAPI response schema ($ref → the component schema; object/array/string/number/boolean). Use .parse() and assert it doesn't throw.
- Deterministic and runnable. No external deps beyond @playwright/test and zod. Reset state first if a reset hook exists (${profile.api.resetPath ? `POST ${profile.api.resetPath}` : 'none'}).
- Populate "covered" with every operationId you wrote a status+schema test for.`;
}

async function main() {
  const data = await callGateway(profile.gateway.url, {
    repo: profile.name,
    tier: 'reasoning',
    messages: [{ role: 'user', content: prompt() }],
    tool: TOOL,
    tool_choice: { type: 'tool', name: 'emit_api_tests' },
    max_tokens: 8000,
    payload_types: ['openapi'],
  });
  const out = data.output;
  if (!out?.specs?.length) throw new Error('gateway returned no api specs');

  mkdirSync(OUT, { recursive: true });
  for (const s of out.specs) {
    writeFileSync(join(OUT, s.filename), s.contents.endsWith('\n') ? s.contents : s.contents + '\n');
    console.log(`  wrote ${join(OUT, s.filename)}`);
  }
  const manifest = { generatedAt: new Date().toISOString(), app: profile.name, openapi: profile.api.openapi, covered: out.covered || [] };
  writeFileSync(join(OUT, 'api-coverage.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  wrote ${join(OUT, 'api-coverage.json')} (${manifest.covered.length} operations)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
