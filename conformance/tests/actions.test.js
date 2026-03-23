/**
 * UI Action Tests
 *
 * Validates all 14 UI actions by replaying action-specific fixtures
 * through the mock server and test client.
 */

import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MockACPServer } from '../lib/mock-server.js';
import { TestClient } from '../lib/test-client.js';
import { loadSchema, validateServerMessage } from '../lib/schema-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

const ACTION_FIXTURES = {
  'fill-actions': '02-fill-actions.json',
  'nav-actions': '03-nav-actions.json',
  'ui-actions': '04-ui-actions.json',
  'modal-actions': '05-modal-actions.json',
};

let fixtureMap = {};
let servers = [];

before(async () => {
  await loadSchema();

  for (const [key, file] of Object.entries(ACTION_FIXTURES)) {
    const raw = await readFile(path.join(FIXTURES_DIR, file), 'utf-8');
    fixtureMap[key] = JSON.parse(raw);
  }
});

afterEach(async () => {
  for (const s of servers) {
    try { await s.stop(); } catch { /* ignore */ }
  }
  servers = [];
});

/**
 * Runs a fixture through mock server + test client and returns results.
 */
async function runFixture(fixture) {
  const server = new MockACPServer(fixture, { messageDelay: 10 });
  servers.push(server);
  await server.start();

  const client = new TestClient(fixture, { url: server.url, timeout: 3000 });
  const results = await client.run();

  return { server, client, results };
}

/**
 * Extracts all actions of a specific type from a fixture.
 */
function getActionsOfType(fixture, actionType) {
  const actions = [];
  for (const step of fixture.steps) {
    if (step.message?.type === 'command' && step.message.actions) {
      for (const action of step.message.actions) {
        if (action.do === actionType) actions.push(action);
      }
    }
  }
  return actions;
}

describe('Fill, Clear, and Select actions', () => {
  it('should complete the fill-actions fixture without errors', async () => {
    const { results } = await runFixture(fixtureMap['fill-actions']);
    assert.equal(results.failed, 0, `Failures: ${JSON.stringify(results.errors, null, 2)}`);
  });

  it('should include fill actions with typewriter animation', () => {
    const fills = getActionsOfType(fixtureMap['fill-actions'], 'fill');
    const withTypewriter = fills.filter((a) => a.animate === 'typewriter');
    assert.ok(withTypewriter.length > 0, 'Should have at least one typewriter fill');
    assert.ok(withTypewriter[0].speed > 0, 'Typewriter fill should have speed > 0');
  });

  it('should include fill actions with count_up animation', () => {
    const fills = getActionsOfType(fixtureMap['fill-actions'], 'fill');
    const withCountUp = fills.filter((a) => a.animate === 'count_up');
    assert.ok(withCountUp.length > 0, 'Should have at least one count_up fill');
  });

  it('should include a select action', () => {
    const selects = getActionsOfType(fixtureMap['fill-actions'], 'select');
    assert.ok(selects.length > 0, 'Should have at least one select action');
    assert.ok(selects[0].field, 'Select action should have a field');
    assert.ok(selects[0].value !== undefined, 'Select action should have a value');
  });

  it('should include a clear action', () => {
    const clears = getActionsOfType(fixtureMap['fill-actions'], 'clear');
    assert.ok(clears.length > 0, 'Should have at least one clear action');
  });

  it('should validate all command messages in the fixture', () => {
    for (const step of fixtureMap['fill-actions'].steps) {
      if (step.direction === 'server_to_client') {
        const result = validateServerMessage(step.message);
        assert.ok(result.valid, `Invalid server message at "${step.description}": ${JSON.stringify(result.errors)}`);
      }
    }
  });
});

describe('Navigate, Click, ScrollTo, and Focus actions', () => {
  it('should complete the nav-actions fixture without errors', async () => {
    const { results } = await runFixture(fixtureMap['nav-actions']);
    assert.equal(results.failed, 0, `Failures: ${JSON.stringify(results.errors, null, 2)}`);
  });

  it('should include navigate with screen target', () => {
    const navs = getActionsOfType(fixtureMap['nav-actions'], 'navigate');
    assert.ok(navs.length > 0);
    assert.ok(navs[0].screen, 'Navigate should have a screen');
  });

  it('should include click with action target', () => {
    const clicks = getActionsOfType(fixtureMap['nav-actions'], 'click');
    assert.ok(clicks.length > 0);
    assert.ok(clicks[0].action, 'Click should have an action');
  });

  it('should include scroll_to and focus actions', () => {
    const scrolls = getActionsOfType(fixtureMap['nav-actions'], 'scroll_to');
    const focuses = getActionsOfType(fixtureMap['nav-actions'], 'focus');
    assert.ok(scrolls.length > 0, 'Should have scroll_to');
    assert.ok(focuses.length > 0, 'Should have focus');
  });
});

describe('Highlight, Enable, Disable, and Toast actions', () => {
  it('should complete the ui-actions fixture without errors', async () => {
    const { results } = await runFixture(fixtureMap['ui-actions']);
    assert.equal(results.failed, 0, `Failures: ${JSON.stringify(results.errors, null, 2)}`);
  });

  it('should include highlight with duration', () => {
    const highlights = getActionsOfType(fixtureMap['ui-actions'], 'highlight');
    assert.ok(highlights.length > 0);
    assert.ok(highlights[0].duration > 0, 'Highlight should have duration');
  });

  it('should include enable and disable actions', () => {
    const enables = getActionsOfType(fixtureMap['ui-actions'], 'enable');
    const disables = getActionsOfType(fixtureMap['ui-actions'], 'disable');
    assert.ok(enables.length > 0, 'Should have enable');
    assert.ok(disables.length > 0, 'Should have disable');
  });

  it('should include show_toast with level and duration', () => {
    const toasts = getActionsOfType(fixtureMap['ui-actions'], 'show_toast');
    assert.ok(toasts.length > 0);
    const withLevel = toasts.filter((t) => t.level);
    assert.ok(withLevel.length > 0, 'At least one toast should have a level');
  });
});

describe('Modal and Confirm actions', () => {
  it('should complete the modal-actions fixture without errors', async () => {
    const { results } = await runFixture(fixtureMap['modal-actions']);
    assert.equal(results.failed, 0, `Failures: ${JSON.stringify(results.errors, null, 2)}`);
  });

  it('should include open_modal with modal id', () => {
    const modals = getActionsOfType(fixtureMap['modal-actions'], 'open_modal');
    assert.ok(modals.length > 0);
    assert.ok(modals[0].modal, 'open_modal should have a modal id');
  });

  it('should include close_modal', () => {
    const closes = getActionsOfType(fixtureMap['modal-actions'], 'close_modal');
    assert.ok(closes.length > 0);
  });

  it('should include ask_confirm', () => {
    const confirms = getActionsOfType(fixtureMap['modal-actions'], 'ask_confirm');
    assert.ok(confirms.length > 0);
    assert.ok(confirms[0].message, 'ask_confirm should have a message');
  });

  it('should have a confirm response in the fixture', () => {
    const confirmSteps = fixtureMap['modal-actions'].steps.filter(
      (s) => s.message?.type === 'confirm'
    );
    assert.ok(confirmSteps.length > 0, 'Should have a confirm message');
    assert.equal(typeof confirmSteps[0].message.confirmed, 'boolean');
  });
});

describe('Seq number consistency', () => {
  it('should have matching seq numbers between commands and results/confirms', () => {
    const errors = [];

    for (const [key, fixture] of Object.entries(fixtureMap)) {
      const commands = new Map();

      for (const step of fixture.steps) {
        if (step.message?.type === 'command') {
          commands.set(step.message.seq, step);
        }
        if (step.message?.type === 'result' || step.message?.type === 'confirm') {
          if (!commands.has(step.message.seq)) {
            errors.push(`${key}: ${step.message.type} seq=${step.message.seq} has no matching command`);
          }
        }
      }
    }

    assert.equal(errors.length, 0, `Seq mismatches:\n  ${errors.join('\n  ')}`);
  });
});
