// Central telemetry store — CLAUDE.md "TelemetryStore".
// Providers publish samples here; gauge components subscribe to logical keys.
// Warning decisions use the latest raw sample, never a cosmetically interpolated value.

import type { TelemetrySample, TelemetrySnapshot, TelemetryListener, ConnectionListener, ConnectionStatus } from './types';

export class TelemetryStore {
  private samples = new Map<string, TelemetrySample>();
  private channelListeners = new Map<string, Set<TelemetryListener>>();
  private wildcardListeners = new Set<TelemetryListener>();
  private connectionListeners = new Set<ConnectionListener>();
  private _connectionStatus: ConnectionStatus = 'disconnected';

  // --- Publishing (called by providers) ---

  publish(key: string, value: number, status: TelemetrySample['status'] = 'good') {
    const sample: TelemetrySample = { value, status, ts: Date.now() };
    this.samples.set(key, sample);
    this.channelListeners.get(key)?.forEach((fn) => fn(key, sample));
    this.wildcardListeners.forEach((fn) => fn(key, sample));
  }

  publishStatus(key: string, status: TelemetrySample['status']) {
    const existing = this.samples.get(key);
    const value = existing?.value ?? 0;
    this.publish(key, value, status);
  }

  setConnectionStatus(status: ConnectionStatus) {
    this._connectionStatus = status;
    this.connectionListeners.forEach((fn) => fn(status));
  }

  // --- Subscribing (called by UI components) ---

  /** Subscribe to a specific channel key. Returns an unsubscribe function. */
  subscribe(key: string, listener: TelemetryListener): () => void {
    if (!this.channelListeners.has(key)) {
      this.channelListeners.set(key, new Set());
    }
    this.channelListeners.get(key)!.add(listener);
    // Immediately deliver current value if available
    const current = this.samples.get(key);
    if (current) listener(key, current);
    return () => this.channelListeners.get(key)?.delete(listener);
  }

  /** Subscribe to all channel updates. Returns an unsubscribe function. */
  subscribeAll(listener: TelemetryListener): () => void {
    this.wildcardListeners.add(listener);
    return () => this.wildcardListeners.delete(listener);
  }

  subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this._connectionStatus);
    return () => this.connectionListeners.delete(listener);
  }

  // --- Reads ---

  get(key: string): TelemetrySample | undefined {
    return this.samples.get(key);
  }

  snapshot(): TelemetrySnapshot {
    return Object.fromEntries(this.samples);
  }

  get connectionStatus(): ConnectionStatus {
    return this._connectionStatus;
  }

  // --- Lifecycle ---

  /** Clear all samples (e.g. on disconnect). */
  clear() {
    this.samples.clear();
  }
}
