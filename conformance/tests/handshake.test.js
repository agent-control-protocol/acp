/**
 * Handshake Protocol Tests
 *
 * Validates the connection handshake flow using the mock server and test client.
 * Tests: config -> manifest -> status/chat sequence.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MockACPServer } from '../lib/mock-server.js';
import { TestClient } from '../lib/test-client.js';
import { loadSchema } from '../lib/schema-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/01-handshake.json');

let fixture;

before(async () => {
  await loadSchema();
  const raw = await readFile(FIXTURE_PATH, 'utf-8');
  fixture = JSON.parse(raw);
});

describe('Handshake protocol', () => {
  /** Runs a fixture and returns {server, client, results}, tracking servers for cleanup. */
  const servers = [];
  async function runHandshake() {
    const server = new MockACPServer(fixture, { messageDelay: 10 });
    servers.push(server);
    await server.start();
    const client = new TestClient(fixture, { url: server.url, timeout: 3000 });
    const results = await client.run();
    return { server, client, results };
  }

  after(async () => {
    for (const s of servers) { try { await s.stop(); } catch { /* ignore */ } }
  });

  it('should complete the full handshake sequence', async () => {
    const { results } = await runHandshake();
    assert.equal(results.failed, 0, `Failed steps: ${JSON.stringify(results.errors, null, 2)}`);
    assert.equal(results.passed, fixture.steps.length);
  });

  it('should send config as the first server message', async () => {
    const { client } = await runHandshake();
    const log = client.getExchangeLog();
    const firstReceived = log.find((e) => e.direction === 'received');
    assert.ok(firstReceived, 'Should have received at least one message');
    assert.equal(firstReceived.message.type, 'config');
    assert.ok(firstReceived.message.sessionId, 'Config must include sessionId');
  });

  it('should receive manifest as the first client message', async () => {
    const { server } = await runHandshake();
    const serverLog = server.getExchangeLog();
    const firstReceived = serverLog.find((e) => e.direction === 'received');
    assert.ok(firstReceived, 'Server should have received at least one message');
    assert.equal(firstReceived.message.type, 'manifest');
    assert.ok(firstReceived.message.screens, 'Manifest must include screens');
  });

  it('should have no validation errors on the server side', async () => {
    const { server } = await runHandshake();
    const validationErrors = server.getValidationErrors();
    assert.equal(validationErrors.length, 0, `Server validation errors: ${JSON.stringify(validationErrors, null, 2)}`);
  });

  it('should complete all fixture steps', async () => {
    const { server } = await runHandshake();
    assert.equal(server.completedSteps, fixture.steps.length);
  });
});
