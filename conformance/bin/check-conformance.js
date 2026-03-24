#!/usr/bin/env node

/**
 * ACP Protocol Conformance Checker
 *
 * Connects to a live ACP server and validates protocol compliance.
 * Language-agnostic — works with any server implementation.
 *
 * Completes the full protocol cycle:
 *   connect → config → manifest → idle → text → thinking →
 *   commands ↔ results → idle
 *
 * Usage:
 *   node bin/check-conformance.js ws://localhost:3099
 *   node bin/check-conformance.js ws://localhost:12900/connect --token=abc
 *   node bin/check-conformance.js ws://localhost:8080 --timeout=15000 --json
 */

import WebSocket from 'ws';
import { loadSchema, validateServerMessage, getUIActions } from '../lib/schema-validator.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const token = args.find((a) => a.startsWith('--token='))?.split('=')[1];
const timeout = parseInt(args.find((a) => a.startsWith('--timeout='))?.split('=')[1] || '10000', 10);
const jsonOutput = args.includes('--json');

if (!url) {
  console.error('Usage: check-conformance <ws-url> [--token=TOKEN] [--timeout=MS] [--json]');
  console.error('');
  console.error('Options:');
  console.error('  --token=TOKEN   Bearer token for authentication');
  console.error('  --timeout=MS    Timeout per check in milliseconds (default: 10000)');
  console.error('  --json          Output results as JSON (for CI)');
  console.error('');
  console.error('Examples:');
  console.error('  node bin/check-conformance.js ws://localhost:3099');
  console.error('  node bin/check-conformance.js ws://localhost:12900/connect --token=abc --json');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Test manifest
// ---------------------------------------------------------------------------

const TEST_MANIFEST = {
  type: 'manifest',
  app: 'acp-conformance-check',
  version: '1.0.0',
  currentScreen: 'contacts',
  screens: {
    contacts: {
      id: 'contacts',
      label: 'Contacts',
      route: '/contacts',
      fields: [
        { id: 'name', type: 'text', label: 'Name', required: true },
        { id: 'email', type: 'email', label: 'Email', required: true },
        { id: 'phone', type: 'phone', label: 'Phone' },
        { id: 'status', type: 'select', label: 'Status', options: [
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ]},
      ],
      actions: [
        { id: 'save', label: 'Save Contact' },
        { id: 'clear', label: 'Clear Form' },
      ],
      modals: [],
    },
  },
  user: { name: 'Test User', email: 'test@acp-protocol.org' },
  persona: {
    name: 'Aria',
    role: 'assistant',
    instructions: 'You help manage contacts. When asked to fill a form, use the fill action on fields. Always use UI commands, do not just describe what you would do.',
  },
};

const TEST_TEXT = {
  type: 'text',
  message: 'Fill the contact form with name John Doe and email john@example.com',
};

// ---------------------------------------------------------------------------
// Check results tracking
// ---------------------------------------------------------------------------

const checks = [];

function pass(name, detail) {
  checks.push({ status: 'PASS', name, detail });
}

function fail(name, detail) {
  checks.push({ status: 'FAIL', name, detail });
}

function warn(name, detail) {
  checks.push({ status: 'WARN', name, detail });
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS = {
  idle: new Set(['thinking']),
  thinking: new Set(['executing', 'idle']),
  executing: new Set(['thinking', 'idle']),
};

function validateStateMachine(statusHistory) {
  const errors = [];

  if (statusHistory.length === 0) {
    errors.push('No status messages received');
    return errors;
  }

  if (statusHistory[0] !== 'idle') {
    errors.push(`First status should be "idle", got "${statusHistory[0]}"`);
  }

  if (statusHistory[statusHistory.length - 1] !== 'idle') {
    errors.push(`Last status should be "idle", got "${statusHistory[statusHistory.length - 1]}"`);
  }

  for (let i = 1; i < statusHistory.length; i++) {
    const from = statusHistory[i - 1];
    const to = statusHistory[i];
    if (from === to) continue; // duplicate status is OK (e.g., idle → idle)
    const valid = VALID_TRANSITIONS[from];
    if (!valid || !valid.has(to)) {
      errors.push(`Invalid transition: "${from}" → "${to}" (at position ${i})`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function buildResult(command) {
  return {
    type: 'result',
    seq: command.seq,
    results: (command.actions || []).map((_, i) => ({ index: i, success: true })),
    state: {
      screen: 'contacts',
      fields: {},
      canSubmit: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Main conformance check
// ---------------------------------------------------------------------------

async function run() {
  await loadSchema();
  const validActions = new Set(getUIActions());

  if (!jsonOutput) {
    console.log(`\nACP Conformance Check`);
    console.log(`Target: ${url}`);
    console.log(`Timeout: ${timeout}ms`);
    console.log(`${'─'.repeat(60)}\n`);
  }

  // ---- Connect ----

  let ws;
  try {
    ws = await connect(url, token, timeout);
    pass('connection', `Connected to ${url}`);
  } catch (err) {
    fail('connection', `Failed to connect: ${err.message}`);
    return printResults();
  }

  const allServerMessages = [];
  const messageQueue = [];
  let queueResolve = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      allServerMessages.push(msg);
      messageQueue.push(msg);
      if (queueResolve) { const r = queueResolve; queueResolve = null; r(); }
    } catch (err) {
      fail('message_parse', `Failed to parse server message: ${err.message}`);
    }
  });

  const waitForMessage = (timeoutMs = timeout) => new Promise((resolve) => {
    if (messageQueue.length > 0) { resolve(messageQueue.shift()); return; }
    const timer = setTimeout(() => { queueResolve = null; resolve(null); }, timeoutMs);
    queueResolve = () => { clearTimeout(timer); resolve(messageQueue.shift() || null); };
  });

  // Drain all messages that arrive within a time window
  const collectMessages = async (timeoutMs, maxMessages = 100) => {
    const collected = [];
    for (let i = 0; i < maxMessages; i++) {
      const msg = await waitForMessage(timeoutMs);
      if (!msg) break;
      collected.push(msg);
    }
    return collected;
  };

  const statusHistory = [];
  let commandCount = 0;
  let resultsSent = 0;

  try {
    // ========= Phase 1: Config =========

    const configMsg = await waitForMessage(timeout);
    if (!configMsg) {
      fail('config_first', 'Server did not send any message after connection');
      return printResults();
    } else if (configMsg.type !== 'config') {
      fail('config_first', `First message should be type "config", got "${configMsg.type}"`);
    } else if (!configMsg.sessionId) {
      fail('config_first', 'Config message missing required field "sessionId"');
    } else {
      pass('config_first', `Received config with sessionId="${configMsg.sessionId}"`);
    }

    // ========= Phase 2: Manifest → idle =========

    ws.send(JSON.stringify(TEST_MANIFEST));

    let gotIdle = false;
    const idleWait = Math.min(timeout, 5000);

    for (let i = 0; i < 10; i++) {
      const msg = await waitForMessage(idleWait);
      if (!msg) break;
      if (msg.type === 'status') {
        statusHistory.push(msg.status);
        if (msg.status === 'idle') { gotIdle = true; break; }
      }
    }

    if (gotIdle) {
      pass('manifest_idle', 'Server sent status:idle after manifest');
    } else {
      fail('manifest_idle', 'Expected status:idle after receiving manifest');
    }

    // ========= Phase 3: Text → full protocol cycle =========

    ws.send(JSON.stringify(TEST_TEXT));

    // Use longer timeout for LLM processing
    const llmTimeout = Math.max(timeout, 15000);
    let gotFinalIdle = false;
    const seqs = [];
    const responseMessages = [];

    for (let i = 0; i < 200; i++) {
      const msg = await waitForMessage(llmTimeout);
      if (!msg) break;
      responseMessages.push(msg);

      if (msg.type === 'status') {
        statusHistory.push(msg.status);
        if (msg.status === 'idle' && statusHistory.length > 1) {
          gotFinalIdle = true;
          break;
        }
      }

      // Complete the protocol cycle: send result for each command
      if (msg.type === 'command') {
        commandCount++;
        if (typeof msg.seq === 'number') seqs.push(msg.seq);

        const result = buildResult(msg);
        ws.send(JSON.stringify(result));
        resultsSent++;
      }
    }

    // ---- Check: status:thinking after text ----
    const thinkingAfterIdle = statusHistory.indexOf('thinking');
    if (thinkingAfterIdle >= 0) {
      pass('status_thinking', 'Server sent status:thinking after receiving text');
    } else {
      fail('status_thinking', 'Server did not send status:thinking after text (required by spec)');
    }

    // ---- Check: server sent response content ----
    const hasContent = responseMessages.some(m =>
      m.type === 'chat' || m.type === 'chat_token' || m.type === 'command'
    );
    if (hasContent) {
      const types = [...new Set(responseMessages.map(m => m.type))];
      pass('response_content', `Server responded with: ${types.join(', ')}`);
    } else {
      fail('response_content', 'Server sent no chat, chat_token, or command after text');
    }

    // ---- Check: commands received (warn if none) ----
    if (commandCount > 0) {
      pass('commands_sent', `Server sent ${commandCount} command(s)`);
    } else {
      warn('commands_sent', 'Server sent 0 commands (chat-only response). Protocol is valid but form was not filled.');
    }

    // ---- Check: results sent back for every command ----
    if (commandCount > 0) {
      if (resultsSent === commandCount) {
        pass('results_sent', `Sent ${resultsSent} result(s) completing the command→result cycle`);
      } else {
        fail('results_sent', `Received ${commandCount} commands but only sent ${resultsSent} results`);
      }
    }

    // ---- Check: returns to idle ----
    if (gotFinalIdle) {
      pass('status_idle_final', 'Server returned to status:idle after processing');
    } else {
      fail('status_idle_final', 'Server did not return to status:idle after processing');
    }

    // ---- Check: state machine transitions ----
    const smErrors = validateStateMachine(statusHistory);
    if (smErrors.length === 0) {
      pass('state_machine', `Valid state transitions: ${statusHistory.join(' → ')}`);
    } else {
      for (const err of smErrors) {
        fail('state_machine', err);
      }
    }

    // ---- Check: schema compliance on all server messages ----
    const schemaErrors = [];
    for (let i = 0; i < allServerMessages.length; i++) {
      const result = validateServerMessage(allServerMessages[i]);
      if (!result.valid) {
        schemaErrors.push({
          index: i,
          type: allServerMessages[i]?.type,
          errors: result.errors,
        });
      }
    }

    if (schemaErrors.length === 0) {
      pass('schema_compliance', `All ${allServerMessages.length} server messages validate against acp-v1.json`);
    } else {
      for (const err of schemaErrors) {
        fail('schema_compliance', `Message #${err.index} (type="${err.type}"): ${err.errors.map(e => `${e.path}: ${e.message}`).join(', ')}`);
      }
    }

    // ---- Check: seq number consistency ----
    if (seqs.length > 1) {
      let seqOk = true;
      for (let i = 1; i < seqs.length; i++) {
        if (seqs[i] <= seqs[i - 1]) {
          fail('seq_monotonic', `Command seq numbers not monotonically increasing: ${seqs[i - 1]} → ${seqs[i]}`);
          seqOk = false;
          break;
        }
      }
      if (seqOk) {
        pass('seq_monotonic', `${seqs.length} commands with monotonically increasing seq: [${seqs.join(', ')}]`);
      }
    } else if (seqs.length === 1) {
      pass('seq_monotonic', `Single command with seq=${seqs[0]}`);
    }

    // ---- Check: action validity ----
    const commandMessages = responseMessages.filter(m => m.type === 'command');
    const invalidActions = [];

    for (const cmd of commandMessages) {
      if (!cmd.actions || !Array.isArray(cmd.actions)) {
        invalidActions.push({ seq: cmd.seq, error: 'Missing or non-array actions field' });
        continue;
      }
      for (const action of cmd.actions) {
        if (!action.do || !validActions.has(action.do)) {
          invalidActions.push({ seq: cmd.seq, action: action.do, error: `Unknown action type "${action.do}"` });
        }
      }
    }

    if (commandMessages.length > 0 && invalidActions.length === 0) {
      const actionTypes = new Set(commandMessages.flatMap(c => c.actions?.map(a => a.do) || []));
      pass('action_validity', `All actions are valid ACP types: [${[...actionTypes].join(', ')}]`);
    } else if (invalidActions.length > 0) {
      for (const inv of invalidActions) {
        fail('action_validity', `Command seq=${inv.seq}: ${inv.error}`);
      }
    }

    // ---- Check: chat streaming correctness ----
    const chatTokens = responseMessages.filter(m => m.type === 'chat_token');
    const finalChats = responseMessages.filter(m => m.type === 'chat' && m.final === true);

    if (chatTokens.length > 0 && finalChats.length === 0) {
      warn('chat_streaming', `${chatTokens.length} chat_tokens sent but no final chat message with final:true`);
    } else if (chatTokens.length > 0 && finalChats.length > 0) {
      pass('chat_streaming', `Streaming: ${chatTokens.length} tokens + final chat message`);
    } else if (finalChats.length > 0) {
      pass('chat_streaming', 'Non-streaming chat: final message sent directly');
    }

  } finally {
    try { ws.close(1000, 'Conformance check complete'); } catch { /* ignore */ }
  }

  printResults();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connect(wsUrl, authToken, timeoutMs) {
  return new Promise((resolve, reject) => {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const ws = new WebSocket(wsUrl, { headers });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function printResults() {
  const passed = checks.filter(c => c.status === 'PASS').length;
  const failed = checks.filter(c => c.status === 'FAIL').length;
  const warned = checks.filter(c => c.status === 'WARN').length;
  const compliant = failed === 0;

  if (jsonOutput) {
    console.log(JSON.stringify({ compliant, passed, failed, warned, checks }, null, 2));
    process.exit(compliant ? 0 : 1);
    return;
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('Results:\n');

  for (const check of checks) {
    const icon = check.status === 'PASS' ? ' PASS ' : check.status === 'FAIL' ? ' FAIL ' : ' WARN ';
    const color = check.status === 'PASS' ? '\x1b[32m' : check.status === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
    console.log(`${color}[${icon}]\x1b[0m ${check.name}: ${check.detail}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total: ${checks.length} checks | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m${warned ? ` | \x1b[33m${warned} warnings\x1b[0m` : ''}`);

  if (compliant) {
    console.log('\n\x1b[32mServer is ACP-compliant.\x1b[0m\n');
  } else {
    console.log('\n\x1b[31mServer is NOT ACP-compliant.\x1b[0m\n');
  }

  process.exit(compliant ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

run().catch((err) => {
  console.error(`\nFatal error: ${err.message}\n`);
  process.exit(2);
});
