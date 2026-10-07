// SimulatorProvider — CLAUDE.md "Data providers" / Phase 2.
// Permanent development infrastructure, not throwaway code.
// Publishes realistic Cummins 5.9 24V telemetry into TelemetryStore.
// Scenarios: idle, cruise, hard_pull, cool_down, sensor_fault, disconnect.

import type { TelemetryProvider, SimulatorScenario } from './types';
import type { TelemetryStore } from './TelemetryStore';

// Update rate: 10 Hz for fast channels (rpm, boost, egt), 2 Hz for slow (temps).
// Warning decisions use latest raw value; visual interpolation in the gauge
// itself is independent.
const FAST_HZ = 10;
const SLOW_HZ = 2;

interface ChannelTarget {
  /** Current rendered value — interpolated toward target each tick. */
  current: number;
  /** Destination value for this scenario. */
  target: number;
  /** How quickly to slew toward target (units/tick at FAST_HZ). */
  slew: number;
  /** Add sinusoidal variation: amplitude in units. */
  ripple?: number;
  /** Ripple frequency multiplier. */
  rippleFreq?: number;
}

// Scenario target values — realistic Cummins 5.9 24V at each operating mode.
// These are NOT real calibrated mappings — they are plausible demo values only.
const SCENARIO_TARGETS: Record<SimulatorScenario, Partial<Record<string, number>>> = {
  idle: {
    rpm: 720, boost: 0, egt: 380, fuel_pressure: 15, trans_temp: 155,
    oil_pressure: 38, coolant_temp: 185, voltage: 14.1, iat: 85,
    speed: 0, engine_load: 8,
  },
  cruise: {
    rpm: 1700, boost: 12, egt: 820, fuel_pressure: 14, trans_temp: 175,
    oil_pressure: 42, coolant_temp: 192, voltage: 14.3, iat: 95,
    speed: 65, engine_load: 42,
  },
  hard_pull: {
    rpm: 2800, boost: 28, egt: 1320, fuel_pressure: 11, trans_temp: 210,
    oil_pressure: 55, coolant_temp: 206, voltage: 13.8, iat: 108,
    speed: 45, engine_load: 88,
  },
  cool_down: {
    rpm: 800, boost: 0, egt: 680, fuel_pressure: 15, trans_temp: 220,
    oil_pressure: 36, coolant_temp: 210, voltage: 14.0, iat: 102,
    speed: 0, engine_load: 6,
  },
  // sensor_fault and disconnect are handled specially
  sensor_fault: {
    rpm: 720, boost: 0, egt: 380, fuel_pressure: 15, trans_temp: 155,
    oil_pressure: 38, coolant_temp: 185, voltage: 14.1, iat: 85,
    speed: 0, engine_load: 8,
  },
  disconnect: {
    rpm: 720, boost: 0, egt: 380, fuel_pressure: 15, trans_temp: 155,
    oil_pressure: 38, coolant_temp: 185, voltage: 14.1, iat: 85,
    speed: 0, engine_load: 8,
  },
};

// Slew rates (units per fast tick = 100ms) — how fast each channel moves
const SLEW: Record<string, number> = {
  rpm: 80, boost: 2, egt: 15, fuel_pressure: 0.5, trans_temp: 0.3,
  oil_pressure: 1, coolant_temp: 0.2, voltage: 0.05, iat: 0.3,
  speed: 2, engine_load: 3,
};

// Ripple (natural variation) per channel
const RIPPLE: Record<string, { amp: number; freq: number }> = {
  rpm: { amp: 25, freq: 1.3 },
  boost: { amp: 0.6, freq: 0.8 },
  egt: { amp: 8, freq: 0.5 },
  fuel_pressure: { amp: 0.4, freq: 1.1 },
  oil_pressure: { amp: 1.2, freq: 0.9 },
  voltage: { amp: 0.06, freq: 0.4 },
};

const ALL_CHANNELS = Object.keys(SCENARIO_TARGETS.idle);

export class SimulatorProvider implements TelemetryProvider {
  private store: TelemetryStore;
  private scenario: SimulatorScenario = 'idle';
  private state = new Map<string, ChannelTarget>();
  private fastTimer: ReturnType<typeof setInterval> | null = null;
  private slowTimer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private faultChannels = new Set<string>();

  constructor(store: TelemetryStore) {
    this.store = store;
    this.initState('idle');
  }

  private initState(scenario: SimulatorScenario) {
    const targets = SCENARIO_TARGETS[scenario];
    for (const key of ALL_CHANNELS) {
      const target = targets[key] ?? 0;
      const existing = this.state.get(key);
      this.state.set(key, {
        current: existing?.current ?? target,
        target,
        slew: SLEW[key] ?? 1,
        ripple: RIPPLE[key]?.amp,
        rippleFreq: RIPPLE[key]?.freq ?? 1,
      });
    }
  }

  setScenario(scenario: SimulatorScenario) {
    this.scenario = scenario;
    this.faultChannels.clear();

    if (scenario === 'disconnect') {
      this.store.setConnectionStatus('disconnected');
      // Stop publishing — last values stay but connection shows disconnected
      return;
    }

    this.store.setConnectionStatus('connected');

    if (scenario === 'sensor_fault') {
      // Run idle values but mark fuel_pressure and egt as faulted
      this.faultChannels.add('fuel_pressure');
      this.faultChannels.add('egt');
      this.initState('idle');
    } else {
      this.initState(scenario);
    }
  }

  start() {
    this.stop();
    this.store.setConnectionStatus('connected');

    // Fast tick: rpm, boost, egt, speed, oil_pressure, engine_load, fuel_pressure, voltage
    const fastKeys = ['rpm', 'boost', 'egt', 'speed', 'oil_pressure', 'engine_load', 'fuel_pressure', 'voltage'];
    this.fastTimer = setInterval(() => {
      if (this.scenario === 'disconnect') return;
      this.tick++;
      for (const key of fastKeys) {
        this.stepChannel(key);
      }
    }, 1000 / FAST_HZ);

    // Slow tick: temperature channels
    const slowKeys = ['coolant_temp', 'trans_temp', 'iat'];
    this.slowTimer = setInterval(() => {
      if (this.scenario === 'disconnect') return;
      for (const key of slowKeys) {
        this.stepChannel(key);
      }
    }, 1000 / SLOW_HZ);
  }

  stop() {
    if (this.fastTimer !== null) clearInterval(this.fastTimer);
    if (this.slowTimer !== null) clearInterval(this.slowTimer);
    this.fastTimer = null;
    this.slowTimer = null;
  }

  private stepChannel(key: string) {
    const ch = this.state.get(key);
    if (!ch) return;

    // Slew toward target
    const delta = ch.target - ch.current;
    const step = Math.min(Math.abs(delta), ch.slew);
    ch.current += Math.sign(delta) * step;

    // Add ripple
    let value = ch.current;
    if (ch.ripple) {
      value += ch.ripple * Math.sin(this.tick * 0.1 * (ch.rippleFreq ?? 1));
    }

    const status = this.faultChannels.has(key) ? 'fault' : 'good';
    this.store.publish(key, value, status);
  }
}
