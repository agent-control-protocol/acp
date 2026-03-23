/**
 * ACP Protocol v1 Schema Validator
 *
 * Loads the ACP v1 JSON Schema and provides validation functions
 * for client-to-server and server-to-client message types.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '../../spec/acp-v1.json');

const CLIENT_MESSAGE_TYPES = [
  'manifest', 'text', 'state', 'result', 'confirm',
  'llm_config', 'response_lang_config',
];

const SERVER_MESSAGE_TYPES = [
  'config', 'command', 'chat', 'chat_token', 'status', 'error',
];

let ajvInstance = null;
let compiledSchema = null;
let clientValidator = null;
let serverValidator = null;
let messageValidator = null;

/**
 * Loads the ACP v1 JSON Schema and compiles Ajv validators.
 * Results are cached after the first call.
 * @returns {Promise<Ajv>}
 */
export async function loadSchema() {
  if (ajvInstance) return ajvInstance;

  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  compiledSchema = JSON.parse(raw);

  ajvInstance = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajvInstance);

  // Compile validators with $defs available for $ref resolution
  const defs = compiledSchema.$defs || {};

  if (defs.ClientMessage) {
    clientValidator = ajvInstance.compile({ $defs: defs, ...defs.ClientMessage });
  }

  if (defs.ServerMessage) {
    serverValidator = ajvInstance.compile({ $defs: defs, ...defs.ServerMessage });
  }

  messageValidator = ajvInstance.compile({
    $defs: defs,
    oneOf: [
      ...(defs.ClientMessage?.oneOf || []),
      ...(defs.ServerMessage?.oneOf || []),
    ],
  });

  return ajvInstance;
}

function formatErrors(errors) {
  if (!errors || errors.length === 0) return [];
  return errors.map((err) => ({
    path: err.instancePath || '/',
    message: err.message || 'unknown error',
    params: err.params || {},
    keyword: err.keyword,
    schemaPath: err.schemaPath,
  }));
}

/**
 * Validates any ACP message (client or server) against the schema.
 * @param {object} message
 * @returns {{valid: boolean, errors: Array|null}}
 */
export function validateMessage(message) {
  if (!messageValidator) {
    throw new Error('Schema not loaded. Call loadSchema() before validating.');
  }
  const valid = messageValidator(message);
  return { valid, errors: valid ? null : formatErrors(messageValidator.errors) };
}

/**
 * Validates a client-to-server message.
 * @param {object} message
 * @returns {{valid: boolean, errors: Array|null}}
 */
export function validateClientMessage(message) {
  if (!clientValidator) {
    throw new Error('Schema not loaded or ClientMessage not defined.');
  }
  const valid = clientValidator(message);
  return { valid, errors: valid ? null : formatErrors(clientValidator.errors) };
}

/**
 * Validates a server-to-client message.
 * @param {object} message
 * @returns {{valid: boolean, errors: Array|null}}
 */
export function validateServerMessage(message) {
  if (!serverValidator) {
    throw new Error('Schema not loaded or ServerMessage not defined.');
  }
  const valid = serverValidator(message);
  return { valid, errors: valid ? null : formatErrors(serverValidator.errors) };
}

/**
 * Returns the known ACP v1 message types grouped by direction.
 * @returns {{client: string[], server: string[]}}
 */
export function getMessageTypes() {
  return { client: [...CLIENT_MESSAGE_TYPES], server: [...SERVER_MESSAGE_TYPES] };
}
