# Steel Thread — Run Guide

The chain: **discover** a journey once on the React build → **compile** the recorded
trace into a deterministic Playwright test of record → **run** that same test against
both the React and Angular builds. If both pass, role + accessible-name locators are
framework-independent — the core claim of discovery over per-framework parsers.

```
agent-browser (discover.mjs) ──► generated/trace.analyst-transfer.json
                                        │
                       trace_compiler.mjs (Sonnet OR deterministic fallback)
                                        │
                ┌───────────────────────┼───────────────────────┐
        analyst-transfer.feature   pages/*.ts        analyst-transfer.spec.ts
                                                              │
                              playwright.config.ts ──► react (5173) + angular (4200)
```

## 0. One-time setup (in `thread/`)

```bash
npm install
npx playwright install chromium
```

`agent-browser` (v0.27) must be installed globally and on PATH:

```bash
npm i -g agent-browser && agent-browser install
```

## 1. Start the backends and both apps

Open four terminals (or background them). From `steel-thread/`:

```bash
# Terminal A — mock API (port 4000)
cd api && npm install && npm start

# Terminal B — React build (port 5173)
cd apps/react && npm install && npm run dev

# Terminal C — Angular build (port 4200)
cd apps/angular && npm install && npm start
```

Reset the API to seed state before a run if needed: `curl -X POST http://localhost:4000/api/reset`.

## 2. Discover the journey (React)

```bash
# in thread/
npm run discover
```

This drives `agent-browser` against `http://localhost:5173`, walking the
`analyst-transfer-happy-path` from `../shared/a11y-contract.md`. It:

- uses a dedicated `--session steel-thread` and `--allowed-domains localhost`;
- captures `snapshot -i --json` per step (incl. pre/post snapshots of the gating step);
- wraps the run in `network har start/stop` to record the `api_calls`;
- closes the session in a `finally` (`agent-browser close --all`);
- writes `generated/trace.analyst-transfer.json`.

**No browser/app?** It prints a clear reason and still writes a hand-authored
**reference trace** (transcribed from the contract) so compile + test stay exercisable.
Look for `source: "agent-browser"` vs `source: "reference"` in the trace.

## 3. Compile the trace → Playwright artifacts

The compiler calls the **model gateway** (provider-agnostic; it holds no provider key itself).
Start the gateway first for model-mode compilation; without it, the compiler emits correct
deterministic artifacts so the chain still works offline.

```bash
# Model mode — start the gateway (in toolkit/gateway), then compile:
(cd ../../toolkit/gateway && npm install && npm start &)   # http://localhost:4100
npm run compile

# Deterministic fallback (gateway down — emits correct artifacts, no model call):
npm run compile
```

Either way it writes three runnable artifacts to `generated/`:

- `analyst-transfer.feature` — Gherkin named from the trace intents.
- `pages/*.ts` — one Page Object per screen, **role + accessible name only**.
- `analyst-transfer.spec.ts` — the test of record, applying the **assertion bar**
  (`assertion-bar.md`): it asserts the state change the *Confirm transfer* click
  CAUSED — the receipt heading `Transfer Complete` + a populated `Transaction ID:` —
  not merely that the route loaded.

The console prints which mode ran (`mode = gateway (...)` or `deterministic fallback ...`).

Optional: confirm the generated TypeScript parses without running anything:

```bash
npx tsc --noEmit          # type-check generated/*.ts + playwright.config.ts
npx playwright test --list # parse + enumerate without launching browsers
```

## 4. Run the SAME spec against both frameworks

```bash
npm test               # both projects: react + angular
npm run test:react     # baseURL http://localhost:5173
npm run test:angular   # baseURL http://localhost:4200
```

## 5. Generate the POC evidence (plan §21.5)

The steel thread's actual deliverable is evidence, not just a green run. Committed scripts compute
the numbers from real artifacts (see `metrics/REPORT.md` for the writeup). The model-mode metrics
need the **gateway** running (`toolkit/gateway`):

```bash
npm run metrics:coverage    # → generated/coverage-manifest.json
                            #   UI journey coverage (§9 demonstrated-only denominator),
                            #   API surface vs. consumer usage, and spec-drift findings.
                            #   No servers needed; reads test-results/.last-run.json (run `npm test` first).

npm run metrics:ai-draft    # → generated/ai-draft-eval.json   (gateway up)
                            #   AI-draft false-positive rate: runs the real compiler in model mode
                            #   N times (STEEL_THREAD_AI_RUNS, default 5), scores each draft against
                            #   typecheck / locator-purity / assertion-bar / completeness gates.
                            #   Black-box and non-destructive: the committed artifacts are restored.

npm run metrics:healer      # → generated/healer-eval.json   (gateway up)
                            #   Healer false-positive rate: seeds 68 locator breakages from the
                            #   contract (synonym/truncation/case/role-swap/unhealable), heals each
                            #   via toolkit/agents/locator_healer (gateway fast tier / Haiku), and
                            #   scores at the 0.9 confidence threshold. HEALER_CONFIDENCE_THRESHOLD overrides.

npm run metrics:latency     # → generated/latency-eval.json   (gateway up)
                            #   Model-call latency: N fast-tier calls (STEEL_THREAD_LATENCY_RUNS,
                            #   default 30) through the gateway; reports p50/p95/p99 vs the §15 30s budget.
```

## How to read the result

- **Both projects green** → the compiled, role+name spec is framework-independent.
  One discovery + one compile produced a test of record that holds across React and
  Angular with zero edits. That is the experiment's positive result.
- **React green, Angular red** → the two builds diverge on the accessibility surface
  (a role or accessible name differs from `a11y-contract.md`). The failing assertion
  names the exact role + accessible name to reconcile — fix the app, not the test.
- **Receipt assertions fail but the URL changed** → the navigation happened but the
  caused state change did not. This is exactly the failure the assertion bar exists to
  catch (a route that loads while the money move silently failed). Not coverage theater.

## Boundaries (thread 1)

- The Anthropic key is used **only** by `trace_compiler.mjs`, on synthetic data — it
  never sees app source or real data.
- `agent-browser` is fenced to `localhost` and runs out-of-band (discovery), never as
  the test runner of record. Deterministic Playwright is the runner.
- No autonomy: no auto-merge, no auto-filed tickets.
