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
  private freshKeys = new Set<string>();
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: TelemetryStore, url: string) {
    this.store = store;
    this.url = url;
  }

  start() {
    this.stop();
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      this.ws.close();
    }
    this.ws = null;
    this.store.setConnectionStatus('disconnected');
  }

  private connect() {
    this.freshKeys.clear();
    for(const key of Object.keys(this.store.snapshot())) this.store.publishStatus(key,'stale');
    this.store.setConnectionStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.store.setConnectionStatus('disconnected');
      this.scheduleReconnect();
      return;
    }

    const socket=this.ws;
    this.connectTimer=setTimeout(()=>{if(this.ws===socket && socket.readyState!==WebSocket.OPEN){socket.onopen=socket.onmessage=socket.onclose=socket.onerror=null;socket.close();this.ws=null;this.connectTimer=null;this.store.setConnectionStatus('disconnected');this.scheduleReconnect();}},8000);
    this.ws.onopen = () => {
      if(this.connectTimer!==null) clearTimeout(this.connectTimer);this.connectTimer=null;
      // A socket opening does not make cached readings fresh.
      this.resetStaleTimer(false);
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as WsMessage;
        if (!msg || msg.version !== 1 || (msg.type !== 'telemetry' && msg.type !== 'status')) return;
        const entries = msg.type === 'telemetry' ? msg.values : msg.channels;
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
        if(msg.type === 'telemetry' && (!Number.isInteger(msg.seq) || !Number.isFinite(msg.ts) || Object.values(entries).some(v=>typeof v!=='number'||!Number.isFinite(v)))) return;
        if(msg.type === 'status' && !['connected','disconnected'].includes(msg.device)) return;
        if(msg.type === 'telemetry') {this.reconnectDelay=RECONNECT_BASE_MS;this.resetStaleTimer();}
        this.handleMessage(msg);
      } catch {
        // Malformed message — ignore, keep connection alive
      }
    };

    this.ws.onclose = () => {
      if (this.staleTimer !== null) clearTimeout(this.staleTimer);this.staleTimer=null;
      if(this.connectTimer!==null) clearTimeout(this.connectTimer);this.connectTimer=null;
      this.ws=null;
      this.store.setConnectionStatus('disconnected');
      if (!this.stopped) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onerror is always followed by onclose — reconnect handled there
    };
  }

  private handleMessage(msg: WsMessage) {
    if (msg.type === 'telemetry') {
      this.freshKeys=new Set(Object.keys(msg.values));
      for(const [key,sample] of Object.entries(this.store.snapshot())) if(!this.freshKeys.has(key) && sample.status==='good') this.store.publishStatus(key,'stale');
      for (const [key, value] of Object.entries(msg.values)) {
        if (typeof value === 'number' && Number.isFinite(value)) this.store.publish(key, value, 'good');
      }
    } else if (msg.type === 'status') {
      if (msg.device === 'disconnected') {
        this.store.setConnectionStatus('disconnected');
      }
      // Per-channel status from device
      for (const [key, status] of Object.entries(msg.channels)) {
        if (status === 'good' || status === 'stale' || status === 'unavailable' || status === 'fault') {
          this.store.publishStatus(key, status==='good' && !this.freshKeys.has(key) ? 'stale' : status);
        } else {
          this.store.publishStatus(key,'unavailable');
        }
      }
    }
  }

  private resetStaleTimer(fresh = true) {
    if (this.staleTimer !== null) clearTimeout(this.staleTimer);
    if(fresh) this.store.setConnectionStatus('connected');
    this.staleTimer = setTimeout(() => {
      // Messages have stopped but socket is still open
      this.store.setConnectionStatus('stale');
      const socket=this.ws;
      if(socket){socket.onopen=socket.onmessage=socket.onclose=socket.onerror=null;socket.close();this.ws=null;}
      this.scheduleReconnect();
    }, STALE_TIMEOUT_MS);
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer !== null) return;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer=null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private clearTimers() {
    if (this.staleTimer   !== null) clearTimeout(this.staleTimer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if(this.connectTimer!==null) clearTimeout(this.connectTimer);this.connectTimer=null;
    this.staleTimer = null;
    this.reconnectTimer = null;
  }
}
