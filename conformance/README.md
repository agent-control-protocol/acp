# ACP Conformance Test Suite

This directory contains the conformance test suite for the Agent Control Protocol (ACP). Use it to validate that your implementation correctly speaks ACP.

## What the Suite Tests

The conformance suite covers three areas:

- **Schema compliance.** Every message your implementation sends or receives must conform to the ACP JSON Schema definitions. The suite validates message structure, required fields, type constraints, and format rules (such as ISO 8601 timestamps and UUID session identifiers).

- **Message exchange sequences.** ACP defines specific handshake and lifecycle sequences (e.g., `config` / `manifest`, session establishment, graceful disconnect). The suite replays these sequences against your implementation and verifies that responses arrive in the correct order with the expected content.

- **Action coverage.** Each action type defined in the spec (e.g., `fill`, `clear`, `select`, `click`, `navigate`, `highlight`, `focus`, `scroll_to`, `enable`, `disable`, `show_toast`, `ask_confirm`, `open_modal`, `close_modal`) has dedicated test cases that exercise both the happy path and common error conditions. The suite verifies that your implementation handles action requests, emits proper action results, and rejects malformed payloads with appropriate error codes.

## Prerequisites

- Node.js 20 or later
- npm 10 or later

## Installation

```bash
npm install
```

## Running the Full Suite

```bash
npm test
```

This runs all conformance tests: schema validation, handshake sequences, action coverage, and session lifecycle.

## Running Individual Test Groups

You can run specific subsets of the suite:

```bash
# Schema validation only
npm run test:schema

# Handshake and connection lifecycle
npm run test:handshake

# Action request/response coverage
npm run test:actions

# Session management (create, resume, destroy)
npm run test:session
```

## Testing Your Implementation

By default, the suite validates against its built-in fixture data. To test a live ACP implementation, point the contract server at your engine by setting the `ACP_TARGET_URL` environment variable:

```bash
ACP_TARGET_URL=ws://localhost:12900/connect npm test
```

The suite will open a WebSocket connection to the specified URL, run the full protocol exchange, and report which tests pass or fail.

If your engine requires authentication or custom headers, you can supply them via:

```bash
ACP_TARGET_URL=ws://localhost:12900/connect \
ACP_AUTH_TOKEN=your-token-here \
npm test
```

## Fixture Format

Test fixtures live in subdirectories organized by test group:

```
conformance/
  fixtures/
    schema/          # Individual message samples for schema validation
    handshake/       # Ordered sequences of messages for lifecycle tests
    actions/         # Action-specific request/response pairs
    session/         # Session create, resume, and destroy sequences
```

Each fixture is a JSON file containing either:

- A **single message object** (for schema tests), with a top-level `"type"` field indicating the message type.
- An **ordered array of message objects** (for sequence tests), representing the expected exchange from first message to last.

Fixture files are named descriptively, e.g., `01-handshake.json`, `02-fill-actions.json`, `03-nav-actions.json`, `04-ui-actions.json`, `05-modal-actions.json`, `06-full-session.json`.

## What "ACP-Compliant" Means

An implementation is considered ACP-compliant when it passes **all** schema and conformance tests in this suite without modifications to the test fixtures. Specifically:

1. Every outbound message conforms to the ACP JSON Schema.
2. The implementation correctly executes all handshake and session lifecycle sequences.
3. All defined action types are supported and produce correct results.
4. Malformed or invalid messages are rejected with the appropriate error codes as defined in the spec.

Partial compliance (e.g., passing schema tests but failing action tests) should be documented clearly if you choose to advertise ACP support.
