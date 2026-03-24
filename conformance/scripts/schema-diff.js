#!/usr/bin/env node

/**
 * ACP Schema Diff — Breaking Change Detector
 *
 * Compares two versions of the ACP JSON Schema and reports
 * additive (SAFE) vs breaking (BREAK) changes.
 *
 * Usage:
 *   node scripts/schema-diff.js --old v1.0.0.json --new acp-v1.json
 *   node scripts/schema-diff.js --new spec/acp-v1.json              (auto: --old from git HEAD)
 *   node scripts/schema-diff.js --old ../spec/acp-v1.json --new ./modified.json --json
 *
 * Exit codes:
 *   0 — No breaking changes (or no changes at all)
 *   1 — Breaking changes detected
 *   2 — Usage error or file not found
 */

import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const oldPath = getArg('--old');
const newPath = getArg('--new');
const jsonOutput = args.includes('--json');

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

if (!newPath) {
  console.error('Usage: schema-diff [--old <old-schema.json>] --new <new-schema.json> [--json]');
  console.error('');
  console.error('If --old is omitted, compares against the version in git HEAD.');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/schema-diff.js --old spec/acp-v1.0.0.json --new spec/acp-v1.json');
  console.error('  node scripts/schema-diff.js --new spec/acp-v1.json   # auto: old from git HEAD');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Change tracking
// ---------------------------------------------------------------------------

const changes = [];

function safe(location, detail) {
  changes.push({ level: 'SAFE', location, detail });
}

function breaking(location, detail) {
  changes.push({ level: 'BREAK', location, detail });
}

function warning(location, detail) {
  changes.push({ level: 'WARN', location, detail });
}

// ---------------------------------------------------------------------------
// Diff logic
// ---------------------------------------------------------------------------

function diffSchemas(oldSchema, newSchema) {
  const oldDefs = oldSchema.$defs || {};
  const newDefs = newSchema.$defs || {};

  const oldDefNames = new Set(Object.keys(oldDefs));
  const newDefNames = new Set(Object.keys(newDefs));

  for (const name of newDefNames) {
    if (!oldDefNames.has(name)) {
      safe(`$defs.${name}`, 'Added new definition');
    }
  }

  for (const name of oldDefNames) {
    if (!newDefNames.has(name)) {
      breaking(`$defs.${name}`, 'Removed definition');
    }
  }

  for (const name of oldDefNames) {
    if (!newDefNames.has(name)) continue;
    diffDefinition(`$defs.${name}`, oldDefs[name], newDefs[name]);
  }

  diffUnion('ClientMessage', oldDefs.ClientMessage, newDefs.ClientMessage);
  diffUnion('ServerMessage', oldDefs.ServerMessage, newDefs.ServerMessage);
}

function diffUnion(name, oldUnion, newUnion) {
  if (!oldUnion || !newUnion) return;

  const oldRefs = (oldUnion.oneOf || []).map(r => r.$ref).filter(Boolean);
  const newRefs = (newUnion.oneOf || []).map(r => r.$ref).filter(Boolean);
  const oldSet = new Set(oldRefs);
  const newSet = new Set(newRefs);

  for (const ref of newRefs) {
    if (!oldSet.has(ref)) {
      safe(name, `Added message type: ${ref.replace('#/$defs/', '')}`);
    }
  }

  for (const ref of oldRefs) {
    if (!newSet.has(ref)) {
      breaking(name, `Removed message type: ${ref.replace('#/$defs/', '')}`);
    }
  }
}

function diffDefinition(defPath, oldDef, newDef) {
  diffEnum(defPath, oldDef, newDef);
  diffProperties(defPath, oldDef, newDef);
  diffRequired(defPath, oldDef, newDef);
  diffAdditionalProperties(defPath, oldDef, newDef);
  diffConditionals(defPath, oldDef, newDef);

  // Recurse into properties
  const oldProps = oldDef.properties || {};
  const newProps = newDef.properties || {};

  for (const prop of Object.keys(oldProps)) {
    if (!newProps[prop]) continue;
    const propPath = `${defPath}.${prop}`;

    diffEnum(propPath, oldProps[prop], newProps[prop]);
    diffType(propPath, oldProps[prop], newProps[prop]);
    diffRef(propPath, oldProps[prop], newProps[prop]);
    diffConstraints(propPath, oldProps[prop], newProps[prop]);
    diffAdditionalProperties(propPath, oldProps[prop], newProps[prop]);

    // Recurse into nested object properties
    if (oldProps[prop].properties && newProps[prop].properties) {
      diffDefinition(propPath, oldProps[prop], newProps[prop]);
    }
  }
}

// --- Enum diff ---

function diffEnum(defPath, oldDef, newDef) {
  if (!oldDef.enum && !newDef.enum) return;

  if (!oldDef.enum && newDef.enum) {
    warning(defPath, `Added enum constraint: [${newDef.enum.join(', ')}]`);
    return;
  }

  if (oldDef.enum && !newDef.enum) {
    safe(defPath, 'Removed enum constraint (now accepts any value)');
    return;
  }

  const oldValues = new Set(oldDef.enum);
  const newValues = new Set(newDef.enum);

  for (const v of newValues) {
    if (!oldValues.has(v)) safe(defPath, `Added enum value "${v}"`);
  }

  for (const v of oldValues) {
    if (!newValues.has(v)) breaking(defPath, `Removed enum value "${v}"`);
  }
}

// --- Properties diff ---

function diffProperties(defPath, oldDef, newDef) {
  const oldProps = oldDef.properties || {};
  const newProps = newDef.properties || {};
  const newRequired = new Set(newDef.required || []);

  for (const prop of Object.keys(newProps)) {
    if (!oldProps[prop]) {
      if (newRequired.has(prop)) {
        breaking(defPath, `Added required property "${prop}" (existing messages will fail validation)`);
      } else {
        safe(defPath, `Added optional property "${prop}"`);
      }
    }
  }

  for (const prop of Object.keys(oldProps)) {
    if (!newProps[prop]) {
      breaking(defPath, `Removed property "${prop}"`);
    }
  }
}

// --- Required diff ---

function diffRequired(defPath, oldDef, newDef) {
  const oldRequired = new Set(oldDef.required || []);
  const newRequired = new Set(newDef.required || []);
  const oldProps = oldDef.properties || {};

  for (const field of newRequired) {
    if (!oldRequired.has(field) && oldProps[field]) {
      breaking(defPath, `Property "${field}" is now required (was optional)`);
    }
  }

  for (const field of oldRequired) {
    if (!newRequired.has(field)) {
      safe(defPath, `Property "${field}" is now optional (was required)`);
    }
  }
}

// --- Type diff ---

function diffType(propPath, oldProp, newProp) {
  const oldType = oldProp.type;
  const newType = newProp.type;

  if (oldType && newType && oldType !== newType) {
    breaking(propPath, `Type changed from "${oldType}" to "${newType}"`);
  }

  if (oldProp.const !== undefined && newProp.const !== undefined && oldProp.const !== newProp.const) {
    breaking(propPath, `Const value changed from "${oldProp.const}" to "${newProp.const}"`);
  }
}

// --- $ref diff ---

function diffRef(propPath, oldProp, newProp) {
  const oldRef = oldProp.$ref;
  const newRef = newProp.$ref;

  if (oldRef && newRef && oldRef !== newRef) {
    breaking(propPath, `$ref changed from "${oldRef}" to "${newRef}"`);
  }

  if (oldRef && !newRef) {
    warning(propPath, `$ref removed (was "${oldRef}")`);
  }

  if (!oldRef && newRef) {
    warning(propPath, `$ref added: "${newRef}"`);
  }

  // Check $ref in items (for arrays)
  const oldItems = oldProp.items;
  const newItems = newProp.items;
  if (oldItems?.$ref && newItems?.$ref && oldItems.$ref !== newItems.$ref) {
    breaking(`${propPath}.items`, `$ref changed from "${oldItems.$ref}" to "${newItems.$ref}"`);
  }

  // Check $ref in additionalProperties
  const oldAP = oldProp.additionalProperties;
  const newAP = newProp.additionalProperties;
  if (oldAP?.$ref && newAP?.$ref && oldAP.$ref !== newAP.$ref) {
    breaking(`${propPath}.additionalProperties`, `$ref changed from "${oldAP.$ref}" to "${newAP.$ref}"`);
  }
}

// --- Constraints diff ---

const CONSTRAINT_FIELDS = [
  { key: 'minLength', stricter: 'higher' },
  { key: 'maxLength', stricter: 'lower' },
  { key: 'minimum', stricter: 'higher' },
  { key: 'maximum', stricter: 'lower' },
  { key: 'minItems', stricter: 'higher' },
  { key: 'maxItems', stricter: 'lower' },
  { key: 'exclusiveMinimum', stricter: 'higher' },
  { key: 'exclusiveMaximum', stricter: 'lower' },
];

function diffConstraints(propPath, oldProp, newProp) {
  for (const { key, stricter } of CONSTRAINT_FIELDS) {
    const oldVal = oldProp[key];
    const newVal = newProp[key];

    if (oldVal === undefined && newVal === undefined) continue;

    if (oldVal === undefined && newVal !== undefined) {
      warning(propPath, `Added constraint ${key}=${newVal}`);
      continue;
    }

    if (oldVal !== undefined && newVal === undefined) {
      safe(propPath, `Removed constraint ${key} (was ${oldVal})`);
      continue;
    }

    if (oldVal === newVal) continue;

    const isStricter = stricter === 'higher' ? newVal > oldVal : newVal < oldVal;
    if (isStricter) {
      breaking(propPath, `Constraint ${key} made stricter: ${oldVal} → ${newVal}`);
    } else {
      safe(propPath, `Constraint ${key} made more lenient: ${oldVal} → ${newVal}`);
    }
  }
}

// --- additionalProperties diff ---

function diffAdditionalProperties(defPath, oldDef, newDef) {
  const oldAP = oldDef.additionalProperties;
  const newAP = newDef.additionalProperties;

  if (oldAP === undefined && newAP === undefined) return;
  if (oldAP === newAP) return;

  // true → false is BREAK (restricts what can be sent)
  if (oldAP === true && newAP === false) {
    breaking(defPath, 'additionalProperties changed from true to false (restricts extensibility)');
  }

  // false → true is SAFE (relaxes)
  if (oldAP === false && newAP === true) {
    safe(defPath, 'additionalProperties changed from false to true (allows extensions)');
  }

  // undefined → false means going from unrestricted to restricted
  if (oldAP === undefined && newAP === false) {
    warning(defPath, 'additionalProperties set to false (was unspecified)');
  }

  // object $ref changes are handled by diffRef() — skip here to avoid duplicates
}

// --- Conditional rules (allOf if/then) diff ---

function diffConditionals(defPath, oldDef, newDef) {
  const oldAllOf = oldDef.allOf || [];
  const newAllOf = newDef.allOf || [];

  function extractRules(allOf) {
    const rules = {};
    for (const rule of allOf) {
      const doValue = rule.if?.properties?.do?.const;
      if (doValue && rule.then?.required) {
        rules[doValue] = new Set(rule.then.required);
      }
    }
    return rules;
  }

  const oldRules = extractRules(oldAllOf);
  const newRules = extractRules(newAllOf);

  for (const [action, newRequired] of Object.entries(newRules)) {
    const oldRequired = oldRules[action];
    if (!oldRequired) {
      safe(defPath, `Added validation rule for action "${action}": requires [${[...newRequired].join(', ')}]`);
      continue;
    }

    for (const field of newRequired) {
      if (!oldRequired.has(field)) {
        breaking(defPath, `Action "${action}" now requires field "${field}"`);
      }
    }

    for (const field of oldRequired) {
      if (!newRequired.has(field)) {
        safe(defPath, `Action "${action}" no longer requires field "${field}"`);
      }
    }
  }

  for (const action of Object.keys(oldRules)) {
    if (!newRules[action]) {
      safe(defPath, `Removed validation rule for action "${action}" (more permissive)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Git integration
// ---------------------------------------------------------------------------

function loadFromGit(filePath) {
  try {
    const resolved = path.resolve(filePath);
    // Find git root
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    const relative = path.relative(gitRoot, resolved);
    const raw = execSync(`git show HEAD:${relative}`, { encoding: 'utf-8' });
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  let oldSchema, newSchema;
  let oldLabel = oldPath || 'git HEAD';

  // Load new schema
  try {
    const newRaw = await readFile(path.resolve(newPath), 'utf-8');
    newSchema = JSON.parse(newRaw);
  } catch (err) {
    console.error(`Failed to load new schema (${newPath}): ${err.message}`);
    process.exit(2);
  }

  // Load old schema (from file or git)
  if (oldPath) {
    try {
      const oldRaw = await readFile(path.resolve(oldPath), 'utf-8');
      oldSchema = JSON.parse(oldRaw);
    } catch (err) {
      console.error(`Failed to load old schema (${oldPath}): ${err.message}`);
      process.exit(2);
    }
  } else {
    oldSchema = loadFromGit(newPath);
    if (!oldSchema) {
      console.error(`Could not load ${newPath} from git HEAD. Use --old to specify the baseline.`);
      process.exit(2);
    }
  }

  if (!jsonOutput) {
    console.log(`\nACP Schema Diff`);
    console.log(`Old: ${oldLabel}`);
    console.log(`New: ${newPath}`);
    console.log(`${'─'.repeat(60)}\n`);
  }

  diffSchemas(oldSchema, newSchema);

  // Sort: BREAK first, then WARN, then SAFE
  const order = { BREAK: 0, WARN: 1, SAFE: 2 };
  changes.sort((a, b) => order[a.level] - order[b.level]);

  const breakCount = changes.filter(c => c.level === 'BREAK').length;
  const warnCount = changes.filter(c => c.level === 'WARN').length;
  const safeCount = changes.filter(c => c.level === 'SAFE').length;

  if (jsonOutput) {
    console.log(JSON.stringify({
      breaking: breakCount > 0,
      changes: { total: changes.length, safe: safeCount, warnings: warnCount, breaking: breakCount },
      details: changes,
    }, null, 2));
    process.exit(breakCount > 0 ? 1 : 0);
    return;
  }

  if (changes.length === 0) {
    console.log('No changes detected.\n');
    process.exit(0);
  }

  for (const change of changes) {
    const color = change.level === 'SAFE' ? '\x1b[32m' : change.level === 'BREAK' ? '\x1b[31m' : '\x1b[33m';
    console.log(`${color}[${change.level.padEnd(5)}]\x1b[0m ${change.location}: ${change.detail}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total: ${changes.length} changes | \x1b[32m${safeCount} safe\x1b[0m | \x1b[33m${warnCount} warnings\x1b[0m | \x1b[31m${breakCount} breaking\x1b[0m`);

  if (breakCount > 0) {
    console.log('\n\x1b[31mBreaking changes detected. This is a MAJOR version bump.\x1b[0m\n');
    process.exit(1);
  } else if (warnCount > 0) {
    console.log('\n\x1b[33mWarnings detected. Review before releasing.\x1b[0m\n');
  } else {
    console.log('\n\x1b[32mAll changes are backward-compatible.\x1b[0m\n');
  }
}

run().catch((err) => {
  console.error(`\nFatal error: ${err.message}\n`);
  process.exit(2);
});
