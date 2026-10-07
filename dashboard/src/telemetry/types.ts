// Telemetry layer types — CLAUDE.md "TelemetryStore" and "Data providers".
// The frontend never knows how a logical channel is physically sourced.

export type ChannelStatus = 'good' | 'stale' | 'unavailable' | 'fault';
export type ConnectionStatus = 'connecting' | 'connected' | 'stale' | 'disconnected';

export interface TelemetrySample {
  value: number;
  status: ChannelStatus;
  /** Device-relative or wall-clock timestamp (ms). */
  ts: number;
}

/** Snapshot of all known channels at a point in time. */
export type TelemetrySnapshot = Record<string, TelemetrySample>;

export type TelemetryListener = (key: string, sample: TelemetrySample) => void;
export type ConnectionListener = (status: ConnectionStatus) => void;

export interface TelemetryProvider {
  /** Start publishing into the store. */
  start(): void;
  /** Stop publishing. */
  stop(): void;
}

// Simulator scenarios
export type SimulatorScenario = 'idle' | 'cruise' | 'hard_pull' | 'cool_down' | 'sensor_fault' | 'disconnect';
