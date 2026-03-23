/**
 * Mock ACP WebSocket Server
 *
 * Replays fixture files to simulate an ACP engine for conformance testing.
 * Walks through fixture steps, sending server-to-client messages and waiting
 * for (and validating) client-to-server messages.
 *
 * Contract mode options (for testing real SDK clients):
 *   - supersetValidation: validate client messages with superset compare
 *   - drainUnexpected: ignore unexpected message types and keep waiting
 */

import { WebSocketServer } from 'ws';
import { EventEmitter } from 'node:events';
import { supersetCompare } from './test-client.js';

export class MockACPServer extends EventEmitter {
  #fixture;
  #requestedPort;
  #messageDelay;
  #clientTimeout;
  #supersetValidation;
  #drainUnexpected;
  #wss = null;
  #actualPort = null;
  #exchangeLog = [];
  #validationErrors = [];
  #connections = new Set();
  #completedSteps = 0;
  #readyResolve = null;
  #readyPromise;
  #completeResolve = null;
  #completePromise;

  /**
   * @param {object} fixture - Parsed fixture JSON with a `steps` array
   * @param {{port?: number, messageDelay?: number, clientTimeout?: number, supersetValidation?: boolean, drainUnexpected?: boolean}} options
   */
  constructor(fixture, options = {}) {
    super();
    this.#fixture = fixture;
    this.#requestedPort = options.port || 0;
    this.#messageDelay = options.messageDelay ?? 50;
    this.#clientTimeout = options.clientTimeout ?? 5000;
    this.#supersetValidation = options.supersetValidation ?? false;
    this.#drainUnexpected = options.drainUnexpected ?? false;
    this.#readyPromise = new Promise((resolve) => { this.#readyResolve = resolve; });
    this.#completePromise = new Promise((resolve) => { this.#completeResolve = resolve; });
  }

  get port() { return this.#actualPort; }
  get url() { return `ws://localhost:${this.#actualPort}/connect`; }
  get ready() { return this.#readyPromise; }
  get completedSteps() { return this.#completedSteps; }

  /** Promise that resolves when the fixture completes. Returns {errors}. */
  waitForComplete(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Fixture did not complete within ${timeoutMs}ms (completed ${this.#completedSteps} steps)`));
      }, timeoutMs);
      this.#completePromise.then((result) => { clearTimeout(timer); resolve(result); });
    });
  }

  /** Starts the mock server. @returns {Promise<number>} The assigned port */
  async start() {
    return new Promise((resolve, reject) => {
      this.#wss = new WebSocketServer({ port: this.#requestedPort, path: '/connect' });

      this.#wss.on('listening', () => {
        this.#actualPort = this.#wss.address().port;
        this.#readyResolve?.();
        resolve(this.#actualPort);
      });

      this.#wss.on('error', reject);

      this.#wss.on('connection', (ws) => {
        this.#connections.add(ws);
        ws.on('close', () => this.#connections.delete(ws));
        this.#handleConnection(ws);
      });
    });
  }

  /** Stops the server and closes all connections. */
  async stop() {
    for (const ws of this.#connections) {
      try { ws.close(1000, 'Server shutting down'); } catch { /* ignore */ }
    }
    this.#connections.clear();

    return new Promise((resolve) => {
      if (!this.#wss) { resolve(); return; }
      this.#wss.close(() => { this.#wss = null; resolve(); });
    });
  }

  getExchangeLog() { return [...this.#exchangeLog]; }
  getValidationErrors() { return [...this.#validationErrors]; }

  /** @private */
  async #handleConnection(ws) {
    const steps = this.#fixture.steps || [];
    const messageQueue = [];
    let queueResolve = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        messageQueue.push(message);
        if (queueResolve) { const r = queueResolve; queueResolve = null; r(); }
      } catch (err) {
        this.#validationErrors.push({
          step: this.#completedSteps,
          description: `Failed to parse client message: ${err.message}`,
        });
      }
    });

    ws.on('error', (err) => {
      this.#validationErrors.push({
        step: this.#completedSteps,
        description: `WebSocket error: ${err.message}`,
      });
      if (queueResolve) { const r = queueResolve; queueResolve = null; r(); }
    });

    const waitForClientMessage = () => new Promise((resolve) => {
      if (messageQueue.length > 0) { resolve(messageQueue.shift()); return; }
      const timer = setTimeout(() => { queueResolve = null; resolve(null); }, this.#clientTimeout);
      queueResolve = () => { clearTimeout(timer); resolve(messageQueue.shift() || null); };
    });

    const delay = () => new Promise((r) => setTimeout(r, this.#messageDelay));

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (ws.readyState !== 1) {
        this.#validationErrors.push({ step: i, description: 'Connection closed before all steps processed' });
        break;
      }

      if (step.direction === 'server_to_client') {
        try {
          ws.send(JSON.stringify(step.message));
          this.#exchangeLog.push({ direction: 'sent', message: step.message, timestamp: Date.now(), step: i });
          this.#completedSteps = i + 1;
        } catch (err) {
          this.#validationErrors.push({ step: i, description: `Failed to send: ${err.message}`, expected: step.message });
          break;
        }
        if (i < steps.length - 1 && steps[i + 1].direction === 'server_to_client') await delay();
      } else if (step.direction === 'client_to_server') {
        // Emit awaiting-app-action when we need text or confirm from the app
        if (step.message?.type === 'text' || step.message?.type === 'confirm') {
          this.emit('awaiting-app-action', { type: step.message.type, message: step.message.message });
        }
        let received = await waitForClientMessage();

        if (received === null) {
          this.#validationErrors.push({
            step: i,
            description: `Timeout waiting for client message (expected type: ${step.message?.type || 'unknown'})`,
            expected: step.message,
          });
          break;
        }

        // Drain unexpected messages if enabled
        if (this.#drainUnexpected && step.message?.type && received.type !== step.message.type) {
          let drained = 0;
          const maxDrain = 20;
          while (received && received.type !== step.message.type && drained < maxDrain) {
            this.#exchangeLog.push({ direction: 'drained', message: received, timestamp: Date.now(), step: i });
            drained++;
            received = await waitForClientMessage();
          }
          if (received === null) {
            this.#validationErrors.push({
              step: i,
              description: `Timeout waiting for client message after draining ${drained} unexpected messages (expected type: ${step.message.type})`,
              expected: step.message,
            });
            break;
          }
        }

        this.#exchangeLog.push({ direction: 'received', message: received, timestamp: Date.now(), step: i });

        if (step.message?.type && received.type !== step.message.type) {
          this.#validationErrors.push({
            step: i,
            description: `Expected type "${step.message.type}" but received "${received.type}"`,
            expected: step.message, actual: received,
          });
        } else if (this.#supersetValidation && step.message) {
          // Superset compare with relaxed contract rules:
          // - 'state' is optional in result messages (SDKs may not include it)
          // - 'seq' in result/confirm is verified by type match, not exact value
          //   (SDKs track their own seq counters which may differ from fixture)
          const relaxed = { ...step.message };
          if (relaxed.type === 'result') {
            delete relaxed.state; // state is optional in result messages
            delete relaxed.seq;   // seq tracking is SDK-internal
          }
          if (relaxed.type === 'confirm') {
            delete relaxed.seq;   // seq tracking is SDK-internal
          }
          const comparison = supersetCompare(relaxed, received);
          if (!comparison.match) {
            this.#validationErrors.push({
              step: i,
              description: `Superset validation failed:\n  ${comparison.differences.join('\n  ')}`,
              expected: step.message, actual: received,
            });
          }
        }

        this.#completedSteps = i + 1;
        await delay();
      }
    }

    this.emit('fixture-complete');
    this.#completeResolve?.({ errors: this.#validationErrors });
  }
}
