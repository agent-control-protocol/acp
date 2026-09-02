<!-- curadoria: kind="entry" keywords="[gate, e2e, arquitetura]" summary="Suite de conformidade ACP: 4 grupos de testes, fixtures 01-06 e o checker de servidor vivo" confirmed-useful="2026-09-02" -->
# ACP Conformance Test Suite

Validates that an implementation speaks the Agent Control Protocol: message schema, handshake, the
eight UI actions and a full session. 41 tests, all green as of 2026-09-02.

## Prerequisites

Node.js 20 or later, npm 10 or later. `npm install` once.

## Run

```bash
npm test                 # node --test tests/**/*.test.js (package.json:26)
npm run test:schema      # tests/schema-validation.test.js
npm run test:handshake   # tests/handshake.test.js
npm run test:actions     # tests/actions.test.js
npm run test:session     # tests/full-session.test.js
```

## Check a live server

The suite itself runs against fixtures. To exercise a running ACP server, use the checker; the URL is a
positional argument and the token an option (`bin/check-conformance.js:14-16,27-30`):

```bash
node bin/check-conformance.js ws://localhost:12900/connect
node bin/check-conformance.js ws://localhost:12900/connect --token=abc --timeout=15000 --json
```

It walks the whole cycle: connect, config, manifest, idle, text, thinking, commands and results, idle.
There is no `ACP_TARGET_URL` or `ACP_AUTH_TOKEN` environment variable.

## Fixtures

Flat files in `fixtures/`, one per scenario: `01-handshake.json`, `02-fill-actions.json`,
`03-nav-actions.json`, `04-ui-actions.json`, `05-modal-actions.json`, `06-full-session.json`.
A fixture is either a single message object (schema tests) or an ordered array of messages (sequence tests).
Schemas come from `../spec/acp-v2.json`; the validator is `lib/schema-validator.js`.

## What "ACP-compliant" means

An implementation is ACP-compliant when it passes every test in this suite without changing the fixtures:
outbound messages conform to the schema, handshake and session sequences complete in order, all eight
action types produce correct results, and malformed messages are rejected with the spec's error codes.
Partial compliance must be stated as such.
