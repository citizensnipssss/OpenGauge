// WebSocketProvider — CLAUDE.md "Data providers" / Phase 3.
// Connects to the ESP32 WebSocket endpoint, parses telemetry protocol messages,
// and publishes normalized samples into TelemetryStore.
// Gauge/layout code is unaffected — same interface as SimulatorProvider.

import type { TelemetryProvider } from './types';
import type { TelemetryStore } from './TelemetryStore';

// TELEMETRY_PROTOCOL.md message shapes
interface TelemetryMessage {
  type: 'telemetry';
  version: number;
  seq: number;
  ts: number;
  values: Record<string, number>;
}

interface StatusMessage {
  type: 'status';
  version: number;
  device: string;
  channels: Record<string, string>;
}

type WsMessage = TelemetryMessage | StatusMessage;

// How long without a message before we consider telemetry stale (ms)
const STALE_TIMEOUT_MS = 3000;
// Base reconnect delay, doubles each attempt up to MAX
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 15000;

export class WebSocketProvider implements TelemetryProvider {
  private store: TelemetryStore;
  private url: string;
  private ws: WebSocket | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private stopped = false;

  constructor(store: TelemetryStore, url: string) {
    this.store = store;
    this.url = url;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.store.setConnectionStatus('disconnected');
  }

  private connect() {
    this.store.setConnectionStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.store.setConnectionStatus('connected');
      this.resetStaleTimer();
    };

    this.ws.onmessage = (evt) => {
      this.resetStaleTimer();
      try {
        const msg = JSON.parse(evt.data as string) as WsMessage;
        this.handleMessage(msg);
      } catch {
        // Malformed message — ignore, keep connection alive
      }
    };

    this.ws.onclose = () => {
      this.store.setConnectionStatus('disconnected');
      if (!this.stopped) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onerror is always followed by onclose — reconnect handled there
    };
  }

  private handleMessage(msg: WsMessage) {
    if (msg.type === 'telemetry') {
      for (const [key, value] of Object.entries(msg.values)) {
        this.store.publish(key, value, 'good');
      }
    } else if (msg.type === 'status') {
      if (msg.device === 'connected') {
        this.store.setConnectionStatus('connected');
      } else if (msg.device === 'disconnected') {
        this.store.setConnectionStatus('disconnected');
      }
      // Per-channel status from device
      for (const [key, status] of Object.entries(msg.channels)) {
        if (status === 'good' || status === 'stale' || status === 'unavailable' || status === 'fault') {
          this.store.publishStatus(key, status);
        }
      }
    }
  }

  private resetStaleTimer() {
    if (this.staleTimer !== null) clearTimeout(this.staleTimer);
    this.store.setConnectionStatus('connected');
    this.staleTimer = setTimeout(() => {
      // Messages have stopped but socket is still open
      this.store.setConnectionStatus('stale');
    }, STALE_TIMEOUT_MS);
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private clearTimers() {
    if (this.staleTimer   !== null) clearTimeout(this.staleTimer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.staleTimer = null;
    this.reconnectTimer = null;
  }
}
