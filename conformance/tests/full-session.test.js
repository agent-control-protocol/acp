/**
 * Full Session Replay Tests
 *
 * Validates a complete session that exercises all action types in a realistic
 * flow: handshake -> chat -> navigate -> fill -> confirm -> toast.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MockACPServer } from '../lib/mock-server.js';
import { TestClient } from '../lib/test-client.js';
import {
  loadSchema,
  validateClientMessage,
  validateServerMessage,
} from '../lib/schema-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/06-full-session.json');

let fixture;

before(async () => {
  await loadSchema();
  const raw = await readFile(FIXTURE_PATH, 'utf-8');
  fixture = JSON.parse(raw);
});

describe('Full session replay', () => {
  const servers = [];

  after(async () => {
    for (const s of servers) { try { await s.stop(); } catch { /* ignore */ } }
  });

  it('should complete the full session without errors', async () => {
    const server = new MockACPServer(fixture, { messageDelay: 10 });
    servers.push(server);
    await server.start();

    const client = new TestClient(fixture, { url: server.url, timeout: 5000 });
    const results = await client.run();

    assert.equal(results.failed, 0, `Failed steps: ${JSON.stringify(results.errors, null, 2)}`);
    assert.equal(results.passed, fixture.steps.length);
  });

  it('should have more than 20 steps (realistic session complexity)', () => {
    assert.ok(fixture.steps.length >= 20, `Expected >= 20 steps, got ${fixture.steps.length}`);
  });

  it('should validate every server message against the schema', () => {
    const errors = [];
    for (let i = 0; i < fixture.steps.length; i++) {
      const step = fixture.steps[i];
      if (step.direction !== 'server_to_client') continue;

      const result = validateServerMessage(step.message);
      if (!result.valid) {
        errors.push({ step: i, type: step.message?.type, errors: result.errors });
      }
    }
    assert.equal(errors.length, 0, `Invalid server messages: ${JSON.stringify(errors, null, 2)}`);
  });

  it('should validate every client message against the schema', () => {
    const errors = [];
    for (let i = 0; i < fixture.steps.length; i++) {
      const step = fixture.steps[i];
      if (step.direction !== 'client_to_server') continue;

      const result = validateClientMessage(step.message);
      if (!result.valid) {
        errors.push({ step: i, type: step.message?.type, errors: result.errors });
      }
    }
    assert.equal(errors.length, 0, `Invalid client messages: ${JSON.stringify(errors, null, 2)}`);
  });

  it('should include chat_token streaming followed by a final chat message', () => {
    const tokens = fixture.steps.filter((s) => s.message?.type === 'chat_token');
    assert.ok(tokens.length >= 2, 'Should have at least 2 streaming tokens');

    const chats = fixture.steps.filter((s) => s.message?.type === 'chat' && s.message?.final === true);
    assert.ok(chats.length >= 1, 'Should have at least 1 final chat message');
  });

  it('should follow the correct status lifecycle', () => {
    const statuses = fixture.steps
      .filter((s) => s.message?.type === 'status')
      .map((s) => s.message.status);

    // Should start with idle, go through thinking/executing, and end with idle
    assert.equal(statuses[0], 'idle', 'First status should be idle');
    assert.equal(statuses[statuses.length - 1], 'idle', 'Last status should be idle');
    assert.ok(statuses.includes('thinking'), 'Should include thinking status');
    assert.ok(statuses.includes('executing'), 'Should include executing status');
  });

  it('should have sequential command seq numbers', () => {
    const seqs = fixture.steps
      .filter((s) => s.message?.type === 'command')
      .map((s) => s.message.seq);

    for (let i = 1; i < seqs.length; i++) {
      assert.ok(seqs[i] > seqs[i - 1], `Seq numbers should be increasing: ${seqs[i - 1]} -> ${seqs[i]}`);
    }
  });

  it('should have every command answered by a result or confirm', () => {
    const commandSeqs = new Set();
    const responseSeqs = new Set();

    for (const step of fixture.steps) {
      if (step.message?.type === 'command') commandSeqs.add(step.message.seq);
      if (step.message?.type === 'result') responseSeqs.add(step.message.seq);
      if (step.message?.type === 'confirm') responseSeqs.add(step.message.seq);
    }

    for (const seq of commandSeqs) {
      assert.ok(responseSeqs.has(seq), `Command seq=${seq} has no response`);
    }
  });

  it('should include all action categories in the full session', () => {
    const actionTypes = new Set();
    for (const step of fixture.steps) {
      if (step.message?.type === 'command') {
        for (const action of step.message.actions) {
          actionTypes.add(action.do);
        }
      }
    }

    // The full session should cover the major action categories
    const required = ['navigate', 'fill', 'select', 'highlight', 'scroll_to', 'focus', 'click', 'ask_confirm', 'show_toast'];
    const missing = required.filter((a) => !actionTypes.has(a));
    assert.equal(missing.length, 0, `Missing actions in full session: ${missing.join(', ')}`);
  });

  it('should exercise the mock server without validation errors', async () => {
    const server = new MockACPServer(fixture, { messageDelay: 10 });
    servers.push(server);
    await server.start();

    const client = new TestClient(fixture, { url: server.url, timeout: 5000 });
    await client.run();

    const serverErrors = server.getValidationErrors();
    assert.equal(
      serverErrors.length, 0,
      `Server validation errors: ${JSON.stringify(serverErrors, null, 2)}`
    );
  });
});
