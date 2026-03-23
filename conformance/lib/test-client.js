/**
 * ACP Protocol Test Client
 *
 * Plays the client role in an ACP fixture exchange against a mock server
 * (or a real engine). Connects via WebSocket, sends client-to-server messages,
 * receives and validates server-to-client messages using superset comparison.
 */

import WebSocket from 'ws';

/**
 * Deep superset comparison: every key in `expected` must exist in `actual`
 * with a matching value. `actual` may have additional keys.
 * @returns {{match: boolean, differences: string[]}}
 */
export function supersetCompare(expected, actual, path = '') {
  const differences = [];

  if (expected === null || expected === undefined) {
    if (actual !== expected) {
      differences.push(`${path || '(root)'}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
    }
    return { match: differences.length === 0, differences };
  }

  if (typeof expected !== typeof actual) {
    differences.push(`${path || '(root)'}: type mismatch - expected ${typeof expected} but got ${typeof actual}`);
    return { match: false, differences };
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      differences.push(`${path || '(root)'}: expected array but got ${typeof actual}`);
      return { match: false, differences };
    }
    if (actual.length < expected.length) {
      differences.push(`${path || '(root)'}: expected array length >= ${expected.length} but got ${actual.length}`);
    }
    for (let i = 0; i < expected.length; i++) {
      const sub = supersetCompare(expected[i], actual[i], `${path}[${i}]`);
      differences.push(...sub.differences);
    }
    return { match: differences.length === 0, differences };
  }

  if (typeof expected === 'object') {
    if (typeof actual !== 'object' || actual === null) {
      differences.push(`${path || '(root)'}: expected object but got ${JSON.stringify(actual)}`);
      return { match: false, differences };
    }
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) {
        differences.push(`${path ? path + '.' : ''}${key}: missing in actual`);
        continue;
      }
      const sub = supersetCompare(expected[key], actual[key], `${path ? path + '.' : ''}${key}`);
      differences.push(...sub.differences);
    }
    return { match: differences.length === 0, differences };
  }

  if (expected !== actual) {
    differences.push(`${path || '(root)'}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }

  return { match: differences.length === 0, differences };
}

export class TestClient {
  #fixture;
  #url;
  #timeout;
  #exchangeLog = [];
  #results = { passed: 0, failed: 0, total: 0, errors: [] };
  #ws = null;

  /**
   * @param {object} fixture - Parsed fixture JSON with a `steps` array
   * @param {{url?: string, timeout?: number}} options
   */
  constructor(fixture, options = {}) {
    this.#fixture = fixture;
    this.#url = options.url || 'ws://localhost:12900/connect';
    this.#timeout = options.timeout ?? 5000;
  }

  /**
   * Connects and executes the full fixture sequence.
   * @returns {Promise<{passed: number, failed: number, total: number, errors: Array}>}
   */
  async run() {
    const steps = this.#fixture.steps || [];
    this.#results.total = steps.length;

    // Message queue shared between connection and step processor
    const mq = { queue: [], resolve: null };

    try {
      this.#ws = await this.#connect(mq);

      const waitForServerMessage = () => new Promise((resolve) => {
        if (mq.queue.length > 0) { resolve(mq.queue.shift()); return; }
        const timer = setTimeout(() => { mq.resolve = null; resolve(null); }, this.#timeout);
        mq.resolve = () => { clearTimeout(timer); resolve(mq.queue.shift() || null); };
      });

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        if (step.direction === 'server_to_client') {
          const received = await waitForServerMessage();

          if (received === null) {
            this.#results.failed++;
            this.#results.errors.push({
              step: i, expected: step.message, actual: null,
              error: `Timeout waiting for server message (expected type: ${step.message?.type || 'unknown'})`,
            });
            this.#exchangeLog.push({ direction: 'received', message: null, expected: step.message, timestamp: Date.now(), step: i });
            continue;
          }

          this.#exchangeLog.push({ direction: 'received', message: received, expected: step.message, timestamp: Date.now(), step: i });

          const comparison = supersetCompare(step.message, received);
          if (comparison.match) {
            this.#results.passed++;
          } else {
            this.#results.failed++;
            this.#results.errors.push({
              step: i, expected: step.message, actual: received,
              error: `Message mismatch:\n  ${comparison.differences.join('\n  ')}`,
            });
          }
        } else if (step.direction === 'client_to_server') {
          try {
            this.#ws.send(JSON.stringify(step.message));
            this.#exchangeLog.push({ direction: 'sent', message: step.message, timestamp: Date.now(), step: i });
            this.#results.passed++;
          } catch (err) {
            this.#results.failed++;
            this.#results.errors.push({ step: i, expected: step.message, error: `Failed to send: ${err.message}` });
          }
        }
      }
    } finally {
      if (this.#ws) {
        try { this.#ws.close(1000, 'Test complete'); } catch { /* ignore */ }
        this.#ws = null;
      }
    }

    return this.#results;
  }

  getExchangeLog() { return [...this.#exchangeLog]; }
  getResults() { return { ...this.#results, errors: [...this.#results.errors] }; }

  /**
   * Opens a WebSocket and registers message buffering BEFORE the connection opens.
   * This prevents the race condition where the server sends config before we listen.
   * @private
   */
  #connect(mq) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.#url);
      const timer = setTimeout(() => { ws.close(); reject(new Error(`Connection timeout to ${this.#url}`)); }, this.#timeout);

      // Register message handler BEFORE open fires -- catches all messages from the start
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          mq.queue.push(message);
          if (mq.resolve) { const r = mq.resolve; mq.resolve = null; r(); }
        } catch (err) {
          this.#results.failed++;
          this.#results.errors.push({ step: -1, error: `Failed to parse server message: ${err.message}` });
        }
      });

      ws.on('error', (err) => {
        if (mq.resolve) { const r = mq.resolve; mq.resolve = null; r(); }
        clearTimeout(timer);
        reject(new Error(`Connection failed to ${this.#url}: ${err.message}`));
      });

      ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    });
  }
}
