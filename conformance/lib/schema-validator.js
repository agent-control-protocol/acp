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

let ajvInstance = null;
let compiledSchema = null;
let clientValidator = null;
let serverValidator = null;
let messageValidator = null;
let clientMessageTypes = null;
let serverMessageTypes = null;
let uiActions = null;
let fieldTypes = null;

/**
 * Extracts message type constants from a schema union definition.
 * Reads the "const" value of the "type" property from each referenced $def.
 */
function extractMessageTypes(defs, unionName) {
  const union = defs[unionName];
  if (!union?.oneOf) return [];
  return union.oneOf
    .map((ref) => {
      const defName = ref.$ref?.replace('#/$defs/', '');
      return defName && defs[defName]?.properties?.type?.const;
    })
    .filter(Boolean);
}

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

  // Derive message types, actions, and field types from schema
  clientMessageTypes = extractMessageTypes(defs, 'ClientMessage');
  serverMessageTypes = extractMessageTypes(defs, 'ServerMessage');
  uiActions = defs.UIAction?.properties?.do?.enum || [];
  fieldTypes = defs.FieldDescriptor?.properties?.type?.enum || [];

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
 * Returns ACP v1 message types derived from the schema.
 * @returns {{client: string[], server: string[]}}
 */
export function getMessageTypes() {
  if (!clientMessageTypes || !serverMessageTypes) {
    throw new Error('Schema not loaded. Call loadSchema() before getMessageTypes().');
  }
  return { client: [...clientMessageTypes], server: [...serverMessageTypes] };
}

/**
 * Returns all UI action types derived from the schema UIAction.do enum.
 * @returns {string[]}
 */
export function getUIActions() {
  if (!uiActions) {
    throw new Error('Schema not loaded. Call loadSchema() before getUIActions().');
  }
  return [...uiActions];
}

/**
 * Returns all field types derived from the schema FieldDescriptor.type enum.
 * @returns {string[]}
 */
export function getFieldTypes() {
  if (!fieldTypes) {
    throw new Error('Schema not loaded. Call loadSchema() before getFieldTypes().');
  }
  return [...fieldTypes];
}

/**
 * Returns the raw compiled schema object.
 * @returns {object|null}
 */
export function getSchema() {
  return compiledSchema;
}
