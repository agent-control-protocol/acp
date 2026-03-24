/**
 * Schema Validation Tests
 *
 * Validates that all golden fixtures contain messages conforming to the ACP v1 schema.
 * This is the foundational test -- if fixtures do not match the schema, the schema
 * or fixtures need updating.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  loadSchema,
  validateClientMessage,
  validateServerMessage,
  getMessageTypes,
  getUIActions,
  getFieldTypes,
} from '../lib/schema-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

let fixtures = [];

before(async () => {
  await loadSchema();

  const files = await readdir(FIXTURES_DIR);
  const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();

  for (const file of jsonFiles) {
    const raw = await readFile(path.join(FIXTURES_DIR, file), 'utf-8');
    fixtures.push({ file, data: JSON.parse(raw) });
  }
});

describe('ACP v1 Schema', () => {
  it('should load and compile without errors', async () => {
    const ajv = await loadSchema();
    assert.ok(ajv, 'Ajv instance should be returned');
  });

  it('should define both client and server message types', () => {
    const types = getMessageTypes();
    assert.ok(types.client.length >= 7, `Expected >= 7 client types, got ${types.client.length}`);
    assert.ok(types.server.length >= 6, `Expected >= 6 server types, got ${types.server.length}`);
  });

  it('should reject messages without a type field', () => {
    const result = validateClientMessage({ message: 'hello' });
    assert.equal(result.valid, false);
  });

  it('should reject messages with an unknown type', () => {
    const result = validateClientMessage({ type: 'unknown_type', data: 123 });
    assert.equal(result.valid, false);
  });
});

describe('Fixture schema validation', () => {
  it('should have at least 5 fixture files', () => {
    assert.ok(fixtures.length >= 5, `Expected >= 5 fixtures, got ${fixtures.length}`);
  });

  for (const directionLabel of ['server_to_client', 'client_to_server']) {
    describe(`${directionLabel} messages`, () => {
      it(`should all validate against the schema`, () => {
        const errors = [];

        for (const { file, data } of fixtures) {
          for (let i = 0; i < data.steps.length; i++) {
            const step = data.steps[i];
            if (step.direction !== directionLabel) continue;

            const validate = directionLabel === 'client_to_server'
              ? validateClientMessage
              : validateServerMessage;

            const result = validate(step.message);
            if (!result.valid) {
              errors.push({
                file,
                step: i,
                type: step.message?.type,
                description: step.description,
                errors: result.errors,
              });
            }
          }
        }

        if (errors.length > 0) {
          const summary = errors.map((e) =>
            `  ${e.file} step ${e.step} (${e.type}): ${e.errors.map((err) => `${err.path}: ${err.message}`).join(', ')}`
          ).join('\n');
          assert.fail(`Schema validation failures:\n${summary}`);
        }
      });
    });
  }
});

describe('Action coverage', () => {
  it('should cover all UI actions defined in the schema across fixtures', () => {
    const ALL_ACTIONS = getUIActions();
    const coveredActions = new Set();

    for (const { data } of fixtures) {
      for (const step of data.steps) {
        if (step.message?.type === 'command' && step.message.actions) {
          for (const action of step.message.actions) {
            coveredActions.add(action.do);
          }
        }
      }
    }

    const missing = ALL_ACTIONS.filter((a) => !coveredActions.has(a));
    assert.equal(
      missing.length, 0,
      `Missing action coverage: ${missing.join(', ')}`
    );
  });
});

describe('Message type coverage', () => {
  // Types that are hard to fixture (config-only or error-only scenarios)
  const OPTIONAL_CLIENT_TYPES = new Set(['llm_config', 'response_lang_config', 'state']);
  const OPTIONAL_SERVER_TYPES = new Set(['error']);

  it('should cover all required client message types from the schema', () => {
    const covered = new Set();

    for (const { data } of fixtures) {
      for (const step of data.steps) {
        if (step.direction === 'client_to_server') {
          covered.add(step.message?.type);
        }
      }
    }

    const allClientTypes = getMessageTypes().client;
    const required = allClientTypes.filter((t) => !OPTIONAL_CLIENT_TYPES.has(t));
    const missing = required.filter((t) => !covered.has(t));
    assert.equal(missing.length, 0, `Missing client message types: ${missing.join(', ')}`);
  });

  it('should cover all required server message types from the schema', () => {
    const covered = new Set();

    for (const { data } of fixtures) {
      for (const step of data.steps) {
        if (step.direction === 'server_to_client') {
          covered.add(step.message?.type);
        }
      }
    }

    const allServerTypes = getMessageTypes().server;
    const required = allServerTypes.filter((t) => !OPTIONAL_SERVER_TYPES.has(t));
    const missing = required.filter((t) => !covered.has(t));
    assert.equal(missing.length, 0, `Missing server message types: ${missing.join(', ')}`);
  });
});

describe('Field type coverage', () => {
  it('should cover all field types defined in the schema across fixture manifests', () => {
    const ALL_FIELD_TYPES = getFieldTypes();
    const coveredTypes = new Set();

    for (const { data } of fixtures) {
      for (const step of data.steps) {
        if (step.message?.type !== 'manifest') continue;
        const screens = step.message.screens || {};
        for (const screen of Object.values(screens)) {
          for (const field of (screen.fields || [])) {
            coveredTypes.add(field.type);
          }
        }
      }
    }

    const missing = ALL_FIELD_TYPES.filter((t) => !coveredTypes.has(t));
    assert.equal(
      missing.length, 0,
      `Missing field type coverage in fixtures: ${missing.join(', ')}`
    );
  });
});
