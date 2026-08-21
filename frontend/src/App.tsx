import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { WCPP_CODES, type TelemetryData } from '@cansat/shared';
import { useTelemetry } from './hooks/useTelemetry';
const CanSat3D = lazy(() => import('./components/CanSat3D').then((module) => ({ default: module.CanSat3D })));
const GNSSMap = lazy(() => import('./components/GNSSMap').then((module) => ({ default: module.GNSSMap })));

const PHASES = [
  [0, 'BOOT'], [1, 'STANDBY'], [2, 'LAUNCH'], [3, 'DEPLOY'],
  [4, 'LAND'], [5, 'RUN'], [6, 'FINISH'], [7, 'FAILSAFE'],
] as const;
const MODES = ['UNSELECTED', 'DEVELOPMENT', 'MISSION'];
const FAILSAFE_REASONS = ['NONE', 'LOW BATTERY', 'UNSAFE FLIGHT RESTART', 'SENSOR FAILURE'];
const RESET_REASONS = [
  'UNKNOWN', 'POWER ON', 'EXTERNAL RESET', 'SOFTWARE RESET', 'PANIC',
  'INTERRUPT WDT', 'TASK WDT', 'OTHER WDT', 'DEEP SLEEP', 'BROWNOUT',
  'SDIO', 'USB', 'JTAG', 'EFUSE', 'POWER GLITCH', 'CPU LOCKUP',
];
const TOOLTIP = {
  backgroundColor: '#10171e', border: '1px solid #36414a',
  borderRadius: '2px', color: '#d9e0e6', fontSize: '11px',
};

type LogKind = 'SYSTEM' | 'NETWORK' | 'SENSOR' | 'STATE' | 'COMMAND' | 'GNSS' | 'WARNING' | 'ERROR';
type LogEntry = { id: string; at: number; kind: LogKind; message: string };
type CommandRecord = {
  id: number; label: string; txAt: number; baselineAck?: number;
  ackAt?: number; ackSeq?: number; status: 'TX ONLY' | 'WAITING ACK' | 'ACK' | 'TIMEOUT';
};
type LogFilter = 'ALL' | 'STATE' | 'CMD' | 'WARN' | 'ERROR';
const STARTED_AT = Date.now();
const INITIAL_LOGS: LogEntry[] = [
  { id: 'ground-start', at: STARTED_AT, kind: 'SYSTEM', message: 'Ground station initialized' },
  { id: 'network-wait', at: STARTED_AT + 1, kind: 'NETWORK', message: 'Waiting for telemetry link' },
  { id: 'state-wait', at: STARTED_AT + 2, kind: 'STATE', message: 'Waiting for vehicle state' },
];

function value(input: number | undefined, digits = 1) {
  return input === undefined || !Number.isFinite(input) ? '---' : input.toFixed(digits);
}
function elapsed(input: number | undefined) {
  if (input === undefined) return '--:--.-';
  const minute = Math.floor(input / 60);
  return String(minute).padStart(2, '0') + ':' +
    (input - minute * 60).toFixed(1).padStart(4, '0');
}
function clock(input: number) {
  const date = new Date(input);
  const base = date.toLocaleTimeString('ja-JP', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return base + '.' + String(date.getMilliseconds()).padStart(3, '0');
}
function phaseName(state: number | undefined) {
  return PHASES.find(([number]) => number === state)?.[1] ?? 'NO STATE';
}
function resetName(reason: number | undefined) {
  return reason === undefined ? 'NO DATA' : RESET_REASONS[reason] ?? 'CODE ' + reason;
}

function PanelHeader({ overline, title, status, statusClass = '' }: {
  overline: string; title: string; status?: string; statusClass?: string;
}) {
  return <header className="section-header">
    <div><span>{overline}</span><h2>{title}</h2></div>
    {status ? <b className={statusClass}>{status}</b> : null}
  </header>;
}

function MissionSequence({ state }: { state: number | undefined }) {
  const active = PHASES.findIndex(([number]) => number === state);
  return <section className="sequence-panel">
    <div className="sequence-current">
      <span>State {state === undefined ? '--' : String(state).padStart(2, '0')}</span>
      <strong>{phaseName(state)}</strong>
    </div>
    <ol className="mission-sequence" aria-label="Mission state sequence">
      {PHASES.map(([number, label], index) => {
        const status = index < active ? 'complete' : index === active ? 'active' : 'pending';
        return <li className={'sequence-step sequence-step--' + status} key={number}>
          <span>{String(number).padStart(2, '0')}</span><strong>{label}</strong>
          <small>{status === 'active' ? 'CURRENT' : status.toUpperCase()}</small>
        </li>;
      })}
    </ol>
  </section>;
}

function Instrument({ label, reading, unit, detail, tone = 'normal' }: {
  label: string; reading: string; unit?: string; detail: string;
  tone?: 'normal' | 'nominal' | 'warning' | 'critical' | 'unknown';
}) {
  return <div className={'instrument instrument--' + tone}>
    <span>{label}</span><p><strong>{reading}</strong>{unit ? <b>{unit}</b> : null}</p>
    <small>{detail}</small>
  </div>;
}

function SensorRow({ name, type, valid, hasTelemetry, age }: {
  name: string; type: string; valid: boolean | undefined;
  hasTelemetry: boolean; age: string;
}) {
  const tone = !hasTelemetry ? 'status-unknown' : valid ? 'status-nominal' : 'status-critical';
  const status = !hasTelemetry ? 'NO DATA' : valid ? 'NOMINAL' : 'OFFLINE';
  return <div className="sensor-row">
    <strong>{name}</strong><span>{type}</span>
    <em className={tone}><i />{status}</em><small>{age}</small>
  </div>;
}

function SensorBus({ current, ageSeconds }: {
  current: TelemetryData | null; ageSeconds: number | undefined;
}) {
  const hasTelemetry = current !== null;
  const age = ageSeconds === undefined ? '--' : ageSeconds.toFixed(1) + 's';
  const gnssModuleTone = !hasTelemetry ? 'status-unknown' : current.gnssValid ? 'status-nominal' : 'status-critical';
  const fixTone = !hasTelemetry ? 'status-unknown' : current.gnssValid && !current.gnssFix ? 'status-warning' : current.gnssFix ? 'status-nominal' : 'status-unknown';
  return <section className="console-panel sensor-panel">
    <PanelHeader overline="Health monitoring" title="Sensor bus" status="SBUS-01" />
    <div className="sensor-table">
      <div className="sensor-table-head"><span>Device</span><span>Type</span><span>Status</span><span>Age</span></div>
      <SensorRow name="QMI8658" type="IMU" valid={current?.imuValid} hasTelemetry={hasTelemetry} age={age} />
      <SensorRow name="MMC5603" type="MAG" valid={current?.magValid} hasTelemetry={hasTelemetry} age={age} />
      <SensorRow name="HP203B" type="BARO" valid={current?.baroValid} hasTelemetry={hasTelemetry} age={age} />
      <div className="sensor-row">
        <strong>MAX-M10M</strong><span>GNSS</span>
        <em className={gnssModuleTone}><i />{!hasTelemetry ? 'NO DATA' : current.gnssValid ? 'ONLINE' : 'OFFLINE'}</em><small>{age}</small>
      </div>
      <div className="gnss-detail-row"><span>Position fix</span><b className={fixTone}>{!hasTelemetry ? 'NO DATA' : current.gnssValid ? current.gnssFix ? 'FIX VALID' : 'NO FIX' : 'NOT AVAILABLE'}</b><small>{hasTelemetry && current.gnssValid ? current.satellites + ' SAT' : '-- SAT'}</small></div>
    </div>
    <div className="vector-table">
      <div><span>ACC</span><b>{value(current?.accelX, 2)}</b><b>{value(current?.accelY, 2)}</b><b>{value(current?.accelZ, 2)}</b><small>m/s²</small></div>
      <div><span>GYRO</span><b>{value(current?.gyroX)}</b><b>{value(current?.gyroY)}</b><b>{value(current?.gyroZ)}</b><small>°/s</small></div>
      <div><span>MAG</span><b>{value(current?.magX)}</b><b>{value(current?.magY)}</b><b>{value(current?.magZ)}</b><small>µT</small></div>
    </div>
    <dl className="diagnostic-list">
      <div><dt>CanSat reset</dt><dd>{resetName(current?.resetReason)} / {current?.resetReason ?? '--'}</dd></div>
      <div><dt>Ground reset</dt><dd>{resetName(current?.receiverResetReason)} / {current?.receiverResetReason ?? '--'}</dd></div>
    </dl>
  </section>;
}

function deriveLogs(data: TelemetryData[]) {
  const logs: LogEntry[] = [];
  let previous: TelemetryData | undefined;
  const seen = { imu: false, mag: false, baro: false };
  for (const item of data) {
    const at = item.serverTime ?? Date.now();
    if (!previous) logs.push({ id: 'system-' + at, at, kind: 'SYSTEM', message: 'Telemetry stream acquired' });
    if (previous && item.state !== previous.state) {
      logs.push({ id: 'state-' + at, at, kind: 'STATE', message: phaseName(previous.state) + ' → ' + phaseName(item.state) });
    }
    if (item.imuValid && !seen.imu) {
      logs.push({ id: 'imu-' + at, at, kind: 'SENSOR', message: 'QMI8658 nominal' }); seen.imu = true;
    }
    if (item.magValid && !seen.mag) {
      logs.push({ id: 'mag-' + at, at, kind: 'SENSOR', message: 'MMC5603 nominal' }); seen.mag = true;
    }
    if (item.baroValid && !seen.baro) {
      logs.push({ id: 'baro-' + at, at, kind: 'SENSOR', message: 'HP203B nominal' }); seen.baro = true;
    }
    if (previous && item.gnssFix !== previous.gnssFix) {
      logs.push({ id: 'gnss-' + at, at, kind: 'GNSS', message: item.gnssFix ? 'Position fix acquired' : 'Position fix lost' });
    }
    if (previous && item.resetReason !== previous.resetReason) {
      logs.push({ id: 'reset-' + at, at, kind: 'WARNING', message: 'CanSat reset: ' + resetName(item.resetReason) });
    }
    previous = item;
  }
  return logs;
}

function EventLog({ logs, filter, setFilter }: {
  logs: LogEntry[]; filter: LogFilter; setFilter: (filter: LogFilter) => void;
}) {
  const visible = logs.filter((entry) => {
    if (filter === 'ALL') return true;
    if (filter === 'CMD') return entry.kind === 'COMMAND';
    if (filter === 'WARN') return entry.kind === 'WARNING';
    return entry.kind === filter;
  });
  const filters: LogFilter[] = ['ALL', 'STATE', 'CMD', 'WARN', 'ERROR'];
  return <section className="console-panel event-panel">
    <header className="section-header event-header">
      <div><span>Chronological record</span><h2>Event log</h2></div>
      <nav className="log-filters" aria-label="Event log filters">
        {filters.map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}
      </nav>
    </header>
    <div className="event-table" role="log" aria-live="polite">
      {visible.length === 0 ? <p className="empty-state">No events in this category.</p> : null}
      {visible.slice(0, 12).map((entry) => <div className="event-row" key={entry.id}>
        <time>{clock(entry.at)}</time>
        <span className={'event-kind event-kind--' + entry.kind.toLowerCase()}>{entry.kind}</span>
        <p>{entry.message}</p>
      </div>)}
    </div>
  </section>;
}

function MissionControl({ connected, state, mode, batteryVoltage, failsafeReason, command, send, addLog }: {
  connected: boolean; state: number | undefined; mode: number | undefined;
  batteryVoltage: number | undefined; failsafeReason: number | undefined;
  command: CommandRecord | null;
  send: (action: number, label: string) => void; addLog: (message: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const canSelect = connected && state === WCPP_CODES.MISSION_STATE.BOOT;
  const interlockClear = connected && state === WCPP_CODES.MISSION_STATE.LAUNCH_STANDBY &&
    mode === WCPP_CODES.OPERATION_MODE.MISSION;
  useEffect(() => { if (!interlockClear) setArmed(false); }, [interlockClear]);

  const disabledReason = !connected ? 'Requires telemetry link'
    : mode !== WCPP_CODES.OPERATION_MODE.MISSION ? 'Requires Mission mode'
      : state !== WCPP_CODES.MISSION_STATE.LAUNCH_STANDBY ? 'Requires State 01 / Standby'
        : !armed ? 'Requires ARM' : 'Ready';
  const modeCommand = (action: number, label: string) => {
    send(action, 'MODE ' + label); addLog('Mode command transmitted: ' + label);
  };
  const statusTone = command?.status === 'ACK' ? 'status-nominal'
    : command?.status === 'TIMEOUT' ? 'status-critical'
      : command?.status === 'WAITING ACK' ? 'status-warning' : 'status-unknown';

  return <section className="console-panel command-panel">
    <PanelHeader overline="Protected operation" title="Mission control"
      status={connected ? 'LINK READY' : 'INTERLOCKED'}
      statusClass={connected ? 'status-nominal' : 'status-critical'} />
    <dl className="command-status">
      <div><dt>Mode</dt><dd>{MODES[mode ?? 0] ?? 'UNKNOWN'}</dd></div>
      <div><dt>State</dt><dd>{phaseName(state)}</dd></div>
      <div><dt>Link</dt><dd className={connected ? 'status-nominal' : 'status-critical'}>{connected ? 'READY' : 'NOT READY'}</dd></div>
      <div><dt>Arm</dt><dd className={armed ? 'status-warning' : 'status-muted'}>{armed ? 'ARMED' : 'DISARMED'}</dd></div>
      <div><dt>Interlock</dt><dd className={interlockClear ? 'status-nominal' : 'status-warning'}>{interlockClear ? 'CLEAR' : 'INHIBIT'}</dd></div>
    </dl>
    <div className="mode-control"><span>Mode select</span>
      <button disabled={!canSelect} onClick={() => modeCommand(WCPP_CODES.ACTION.SELECT_DEVELOPMENT_MODE, 'DEVELOPMENT')}>Development</button>
      <button disabled={!canSelect} onClick={() => modeCommand(WCPP_CODES.ACTION.SELECT_MISSION_MODE, 'MISSION')}>Mission</button>
    </div>
    <div className="protected-control">
      <button className={armed ? 'arm-button arm-button--active' : 'arm-button'}
        disabled={!interlockClear} onClick={() => {
          setArmed((wasArmed) => !wasArmed);
          addLog(armed ? 'Launch control disarmed' : 'Launch control armed');
        }}>{armed ? 'Disarm' : 'Arm'}</button>
      <button className="launch-command" disabled={!armed || !interlockClear} onClick={() => {
        send(WCPP_CODES.ACTION.START_LAUNCH, 'LAUNCH / STATE 2');
        addLog('LAUNCH command transmitted'); setArmed(false);
      }}>Launch / State 2</button>
    </div>
    <p className={'command-hint ' + (disabledReason === 'Ready' ? 'status-nominal' : '')}>{disabledReason === 'Ready' ? 'LAUNCH ENABLED' : 'LAUNCH DISABLED — ' + disabledReason}</p>
    {state === WCPP_CODES.MISSION_STATE.FAILSAFE ? <div className="failsafe-control">
      <span>Reason <b>{FAILSAFE_REASONS[failsafeReason ?? 0] ?? 'UNKNOWN'}</b></span>
      <button disabled={!connected || batteryVoltage === undefined || batteryVoltage < 3.5}
        onClick={() => { send(WCPP_CODES.ACTION.CLEAR_FAILSAFE, 'CLEAR FAILSAFE'); addLog('Failsafe clear requested'); }}>Clear failsafe</button>
      <small>Requires ≥3.5 V stable for 10 s</small>
    </div> : null}
    <div className="command-feedback">
      <span>Command <b>{command ? '#' + String(command.id).padStart(4, '0') : '----'}</b></span>
      <span>Type <b>{command?.label ?? 'NO COMMAND'}</b></span>
      <span>TX <b>{command ? clock(command.txAt) : '--'}</b></span>
      <span>ACK <b>{command?.ackSeq === undefined ? 'UNAVAILABLE' : '#' + command.ackSeq}</b></span>
      <span>RTT <b>{command?.ackAt ? command.ackAt - command.txAt + ' ms' : '--'}</b></span>
      <span>Status <b className={statusTone}>{command?.status ?? 'NO DATA'}</b></span>
    </div>
  </section>;
}

function App() {
  const { data, isConnected, sendCommand, latestDataRef } = useTelemetry('ws://localhost:8080');
  const [now, setNow] = useState(Date.now());
  const [commandLogs, setCommandLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogFilter>('ALL');
  const [command, setCommand] = useState<CommandRecord | null>(null);
  const commandCounter = useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const current = data.at(-1) ?? null;
  const lastRxAge = current?.serverTime === undefined ? undefined : Math.max(0, (now - current.serverTime) / 1000);
  const linkHealthy = isConnected && lastRxAge !== undefined && lastRxAge < 2.5;
  const verticalSpeed = useMemo(() => {
    if (data.length < 2) return undefined;
    const latest = data.at(-1)!;
    const previous = data.at(-2)!;
    const dt = latest.time - previous.time;
    return dt > 0 ? (latest.altitude - previous.altitude) / dt : undefined;
  }, [data]);
  const packetRate = useMemo(() => {
    const recent = data.filter((item) => item.serverTime && now - item.serverTime < 5000);
    if (recent.length < 2) return 0;
    const span = ((recent.at(-1)?.serverTime ?? 0) - (recent[0].serverTime ?? 0)) / 1000;
    return span > 0 ? (recent.length - 1) / span : 0;
  }, [data, now]);
  const markers = useMemo(() => {
    const seen = new Set<number>();
    return data.flatMap((item) => {
      if (seen.has(item.state)) return [];
      seen.add(item.state);
      return [{ time: item.time, label: phaseName(item.state) }];
    });
  }, [data]);
  const logs = useMemo(() => [...commandLogs, ...deriveLogs(data), ...INITIAL_LOGS]
    .sort((a, b) => b.at - a.at), [commandLogs, data]);

  const send = (action: number, label: string) => {
    const txAt = Date.now();
    const record: CommandRecord = {
      id: ++commandCounter.current, label, txAt, baselineAck: current?.ackSeq,
      status: current?.ackSeq === undefined ? 'TX ONLY' : 'WAITING ACK',
    };
    setCommand(record);
    sendCommand({ unit: WCPP_CODES.UNIT.CANSAT, component: WCPP_CODES.COMPONENT.MAIN, action });
    setCommandLogs((previous) => [{ id: 'tx-' + txAt, at: txAt, kind: 'COMMAND' as const, message: `Command #${record.id} TX: ${label}` }, ...previous].slice(0, 30));
  };
  const addLog = (message: string) => {
    const at = Date.now();
    setCommandLogs((previous) => [
      { id: 'command-' + at + '-' + previous.length, at, kind: 'COMMAND' as const, message },
      ...previous,
    ].slice(0, 30));
  };

  useEffect(() => {
    if (current?.ackSeq === undefined) return;
    setCommand((pending) => {
      if (!pending || pending.status !== 'WAITING ACK' || pending.baselineAck === undefined || current.ackSeq! <= pending.baselineAck) return pending;
      const ackAt = current.serverTime ?? Date.now();
      setCommandLogs((previous) => [{ id: 'ack-' + ackAt, at: ackAt, kind: 'COMMAND' as const, message: `ACK #${current.ackSeq} received for command #${pending.id}` }, ...previous].slice(0, 30));
      return { ...pending, status: 'ACK', ackAt, ackSeq: current.ackSeq };
    });
  }, [current?.ackSeq, current?.serverTime]);
  useEffect(() => {
    if (!command || command.status !== 'WAITING ACK') return;
    const timer = window.setTimeout(() => setCommand((pending) => {
      if (!pending || pending.id !== command.id || pending.status !== 'WAITING ACK') return pending;
      const at = Date.now();
      setCommandLogs((previous) => [{ id: 'timeout-' + at, at, kind: 'ERROR' as const, message: `ACK timeout for command #${pending.id}` }, ...previous].slice(0, 30));
      return { ...pending, status: 'TIMEOUT' };
    }), Math.max(0, command.txAt + 3000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [command]);

  const gnss = !current ? 'NO DATA' : current.gnssValid ? current.gnssFix ? 'FIX VALID' : 'NO FIX' : 'OFFLINE';
  const mode = MODES[current?.operationMode ?? 0] ?? 'UNKNOWN';
  const lastFix = data.filter((item) => item.gnssValid && item.gnssFix).at(-1);
  const lastFixAge = lastFix?.serverTime === undefined ? undefined : Math.max(0, (now - lastFix.serverTime) / 1000);
  const altitudeValues = data.map((item) => item.altitude).filter(Number.isFinite);
  const chartData = data.length ? data : [{ time: -30 }, { time: 0 }];

  return <main className="flight-console">
    <header className="operations-header">
      <div className="operations-title"><span>WASA / REGULUS</span><h1>Flight Control</h1></div>
      <dl className="header-telemetry">
        <div><dt>Link</dt><dd className={linkHealthy ? 'status-nominal' : current ? 'status-warning' : 'status-unknown'}><i />{linkHealthy ? 'ONLINE' : current ? 'STALE' : isConnected ? 'WAITING' : 'NO LINK'}</dd></div>
        <div><dt>RX rate</dt><dd>{packetRate.toFixed(1)} Hz</dd></div>
        <div><dt>RSSI</dt><dd>--- dBm</dd></div>
        <div><dt>Last RX</dt><dd className={lastRxAge === undefined ? 'status-unknown' : lastRxAge < 2.5 ? '' : 'status-warning'}>{lastRxAge === undefined ? '--' : lastRxAge.toFixed(1) + ' s'}</dd></div>
        <div><dt>Battery</dt><dd className={current?.batteryVoltage === undefined ? 'status-unknown' : current.batteryVoltage <= 3.3 ? 'status-critical' : current.batteryVoltage <= 3.5 ? 'status-warning' : 'status-nominal'}>{current?.batteryVoltage === undefined ? '--- V' : current.batteryVoltage.toFixed(2) + ' V'}</dd></div>
        <div><dt>Mode</dt><dd>{mode}</dd></div>
      </dl>
      <div className="header-clock"><span>Mission elapsed time</span><strong>T+ {elapsed(current?.time)}</strong></div>
    </header>

    <MissionSequence state={current?.state} />
    <section className="telemetry-strip">
      <Instrument label="Altitude" reading={value(current?.altitude)} unit="m" detail={value(current?.pressure) + ' hPa'} tone={!current ? 'unknown' : current.baroValid ? 'normal' : 'critical'} />
      <Instrument label="Vertical speed" reading={(verticalSpeed !== undefined && verticalSpeed >= 0 ? '+' : '') + value(verticalSpeed, 2)} unit="m/s" detail="BAROMETRIC" tone={verticalSpeed === undefined ? 'unknown' : 'normal'} />
      <Instrument label="Temperature" reading={value(current?.temperature)} unit="°C" detail="HP203B" tone={!current ? 'unknown' : current.baroValid ? 'normal' : 'critical'} />
      <Instrument label="Heading" reading={value(current?.heading)} unit="°" detail="MMC5603" tone={!current ? 'unknown' : current.magValid ? 'normal' : 'critical'} />
      <Instrument label="GNSS" reading={gnss} detail={current?.gnssValid ? current.satellites + ' SAT' : '-- SAT'} tone={!current ? 'unknown' : !current.gnssValid ? 'critical' : current.gnssFix ? 'nominal' : 'warning'} />
    </section>

    <section className="workspace-grid">
      <section className="console-panel attitude-panel">
        <PanelHeader overline="Vehicle orientation" title={(current?.state ?? 0) <= 2 ? 'Regulus launch vehicle' : 'REGULUS CanSat'} status={current?.imuValid ? 'LIVE ATTITUDE' : 'REFERENCE VIEW'} statusClass={current?.imuValid ? 'status-nominal' : 'status-unknown'} />
        <div className="model-stage"><Suspense fallback={<div className="stage-loading">Loading 3D model…</div>}><CanSat3D dataRef={latestDataRef} state={current?.state ?? 0} attitudeValid={Boolean(current?.imuValid)} /></Suspense>{!current?.imuValid ? <span className="stage-message">ATTITUDE DATA UNAVAILABLE</span> : null}</div>
        <div className="readout-strip"><span>Pitch <b>{current?.imuValid ? value(current.orientationX) + '°' : '---'}</b></span><span>Roll <b>{current?.imuValid ? value(current.orientationY) + '°' : '---'}</b></span><span>Yaw <b>{current?.imuValid ? value(current.orientationZ) + '°' : '---'}</b></span></div>
      </section>
      <section className="console-panel recovery-panel">
        <PanelHeader overline="Recovery navigation" title="GNSS position" status={gnss} statusClass={!current ? 'status-unknown' : current.gnssFix ? 'status-nominal' : current.gnssValid ? 'status-warning' : 'status-critical'} />
        <div className="map-stage"><Suspense fallback={<div className="stage-loading">Loading map…</div>}><GNSSMap data={data} /></Suspense></div>
        <div className="fix-readout"><span>Current fix <b>{current?.gnssFix ? 'VALID' : 'NONE'}</b></span><span>Last fix <b>{lastFix ? `${value(lastFix.latitude, 6)}, ${value(lastFix.longitude, 6)}` : '---'}</b></span><span>Age <b>{lastFixAge === undefined ? '---' : lastFixAge.toFixed(1) + ' s'}</b></span></div>
      </section>
      <aside className="operations-column">
        <SensorBus current={current} ageSeconds={lastRxAge} />
        <MissionControl connected={linkHealthy} state={current?.state} mode={current?.operationMode} batteryVoltage={current?.batteryVoltage} failsafeReason={current?.failsafeReason} command={command} send={send} addLog={addLog} />
      </aside>
      <section className="console-panel chart-panel altitude-chart">
        <div className="chart-heading"><PanelHeader overline="Telemetry history" title="Barometric altitude" /><div><span>Current <b>{value(current?.altitude)} m</b></span><span>Min <b>{value(altitudeValues.length ? Math.min(...altitudeValues) : undefined)} m</b></span><span>Max <b>{value(altitudeValues.length ? Math.max(...altitudeValues) : undefined)} m</b></span><span>V/S <b>{value(verticalSpeed, 2)} m/s</b></span></div></div>
        <div className="chart-stage"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#222d36" vertical={false} /><XAxis dataKey="time" domain={data.length ? undefined : [-30, 0]} tick={{ fontSize: 10 }} stroke="#718096" tickLine={false} axisLine={false} /><YAxis domain={data.length ? undefined : [0, 60]} tick={{ fontSize: 10 }} stroke="#718096" tickLine={false} axisLine={false} /><Tooltip contentStyle={TOOLTIP} />
          {markers.map((marker) => <ReferenceLine key={marker.label + marker.time} x={marker.time} stroke="#687580" strokeDasharray="3 3" label={{ value: marker.label, fill: '#87939d', fontSize: 9 }} />)}
          <Line type="monotone" dataKey="altitude" stroke="#36cff5" strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>{!data.length ? <div className="chart-empty"><b>NO TELEMETRY DATA</b><span>Waiting for HP203B…</span></div> : null}</div>
      </section>
      <section className="console-panel chart-panel angular-chart">
        <div className="chart-heading"><PanelHeader overline="Telemetry history" title="Angular rate" /><div><span>X <b>{value(current?.gyroX)} °/s</b></span><span>Y <b>{value(current?.gyroY)} °/s</b></span><span>Z <b>{value(current?.gyroZ)} °/s</b></span></div></div>
        <div className="chart-stage"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#222d36" vertical={false} /><XAxis dataKey="time" domain={data.length ? undefined : [-30, 0]} tick={{ fontSize: 10 }} stroke="#718096" tickLine={false} axisLine={false} /><YAxis domain={data.length ? undefined : [-10, 10]} tick={{ fontSize: 10 }} stroke="#718096" tickLine={false} axisLine={false} /><Tooltip contentStyle={TOOLTIP} />
          {markers.map((marker) => <ReferenceLine key={marker.label + marker.time} x={marker.time} stroke="#687580" strokeDasharray="3 3" />)}
          <Line type="monotone" dataKey="gyroX" name="X" stroke="#ff6673" strokeWidth={1.2} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="gyroY" name="Y" stroke="#45d6a1" strokeWidth={1.2} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="gyroZ" name="Z" stroke="#8999ff" strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>{!data.length ? <div className="chart-empty"><b>NO TELEMETRY DATA</b><span>Waiting for QMI8658…</span></div> : null}</div>
      </section>
      <EventLog logs={logs} filter={logFilter} setFilter={setLogFilter} />
    </section>
  </main>;
}

export default App;