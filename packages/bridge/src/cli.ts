import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTROLS,
  FEATURE_CONTROLS,
  decode,
  Device,
  PALETTE,
  PORT_DIRECTION,
  PORT_ROLES,
  parseBytes,
  type Gesture,
  type PortRole,
  type ServerMessage,
  type TrafficEntry,
} from '@lcxl3/core';
import { CaptureWriter } from './capture.ts';
import { loadConfig, type BridgeConfig } from './config.ts';
import { logMessage } from './logger.ts';
import { loadNonVolatile, saveNonVolatile } from './persist.ts';
import { PanelServer } from './server.ts';
import { listSystemPorts, VirtualPortSet } from './ports.ts';

const PANEL_DIST = join(dirname(fileURLToPath(import.meta.url)), '../../panel/dist');

const USAGE = `lcxl3 bridge - virtual Launch Control XL 3 ports

  npm run bridge -- start [--capture <file>] [--config <file>] [--no-panel]
  npm run bridge -- ports

While running, type:
  send <port> <bytes>   emit bytes from a device output port
                        e.g. send dawOut B0 05 7F   (or: send dawOut d176 d5 d127)
  daw on|off            shortcut for the DAW mode switch, bypassing the wire
  state                 print the current surface state
  features              print every feature control and its value
  ports                 list what CoreMIDI currently reports
  help
  quit
`;

const isPortRole = (value: string): value is PortRole => (PORT_ROLES as readonly string[]).includes(value);

const printSystemPorts = (): void => {
  const { sources, destinations } = listSystemPorts();
  console.log('\nCoreMIDI sources (things a host can read from):');
  for (const name of sources) console.log(`  ${name}`);
  console.log('\nCoreMIDI destinations (things a host can write to):');
  for (const name of destinations) console.log(`  ${name}`);
  console.log();
};

const printCreatedPorts = (config: BridgeConfig): void => {
  console.log('Created virtual ports:');
  for (const role of PORT_ROLES) {
    const direction = PORT_DIRECTION[role] === 'toDevice' ? 'host writes here' : 'host reads here';
    console.log(`  ${role.padEnd(8)} ${config.portNames[role].padEnd(24)} ${direction}`);
  }
  console.log(
    '\nIn Max, these should appear under exactly the names above. If they are\n' +
      'decorated with a client name, put what Max shows into lcxl3.config.json\n' +
      'under "portNames" - see PLAN.md phase 1.\n',
  );
};

const valueOf = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

const start = async (argv: readonly string[]): Promise<void> => {
  const capturePath = valueOf(argv, '--capture');
  const config = loadConfig(valueOf(argv, '--config') ?? 'lcxl3.config.json');
  const ports = new VirtualPortSet(config.portNames);
  const device = new Device();
  device.restoreNonVolatile(loadNonVolatile());
  let savedNonVolatile = JSON.stringify(device.nonVolatile);

  ports.open();
  printCreatedPorts(config);

  const capture = capturePath === undefined ? undefined : new CaptureWriter(capturePath, config, 'emulator');
  if (capture) console.log(`Recording to ${capturePath}\n`);

  const RECENT_LIMIT = 200;
  const recent: TrafficEntry[] = [];

  const greet = (): ServerMessage => ({
    type: 'hello',
    controls: CONTROLS,
    palette: PALETTE,
    portNames: config.portNames,
    state: device.state,
    recent,
  });

  const panel: PanelServer | undefined =
    argv.includes('--no-panel') === true
      ? undefined
      : new PanelServer({
          port: config.wsPort,
          staticDir: PANEL_DIST,
          greet,
          onGesture: (gesture: Gesture) => {
            device.tick(ports.now());
            try {
              for (const out of device.apply(gesture)) ports.send(out.port, out.bytes);
            } catch (error) {
              console.error(`gesture: ${(error as Error).message}`);
              return;
            }
            panel?.broadcast({ type: 'state', state: device.state });
          },
        });

  if (panel) {
    await panel.listen();
    console.log(`Panel server on http://localhost:${config.wsPort}`);
    console.log('For the dev panel with live reload, run `npm run panel` in another terminal.\n');
  }

  // Temporary displays expire on their own, so the device needs a clock. Time
  // is passed in rather than read ambiently, which keeps the model deterministic.
  const clock = setInterval(() => {
    if (device.tick(ports.now())) panel?.broadcast({ type: 'state', state: device.state });
  }, 100);

  ports.onMessage((message) => {
    device.tick(ports.now());
    logMessage(message);
    capture?.record(message);

    const entry: TrafficEntry = { message, decoded: decode(message.bytes, message.direction) };
    recent.push(entry);
    if (recent.length > RECENT_LIMIT) recent.shift();
    panel?.broadcast({ type: 'midi', ...entry });

    if (message.direction !== 'toDevice') return;

    const before = JSON.stringify(device.state);
    for (const out of device.receive(message.port, message.bytes)) ports.send(out.port, out.bytes);
    if (JSON.stringify(device.state) !== before) panel?.broadcast({ type: 'state', state: device.state });

    const nonVolatile = JSON.stringify(device.nonVolatile);
    if (nonVolatile !== savedNonVolatile) {
      savedNonVolatile = nonVolatile;
      saveNonVolatile(device.nonVolatile);
    }
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
  console.log('Listening. Type "help" for commands, "quit" to stop.\n');

  const handleCommand = (line: string): boolean => {
    const [command, ...rest] = line.trim().split(/\s+/);
    if (command === undefined || command === '') return true;

    switch (command) {
      case 'quit':
      case 'exit':
        return false;
      case 'help':
        console.log(USAGE);
        return true;
      case 'ports':
        printSystemPorts();
        return true;
      case 'state': {
        const { dawMode, mode, values, pressed, leds } = device.state;
        console.log(`  connection: ${dawMode ? 'claimed by a host' : 'standalone'}`);
        console.log(`  surface mode: ${mode.label} (CC 30 value ${mode.value})`);
        console.log(`  lit LEDs: ${Object.keys(leds).length}`);
        console.log(`  non-zero: ${Object.entries(values).filter(([, v]) => v !== 0).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`);
        console.log(`  held: ${Object.keys(pressed).join(', ') || '(none)'}`);
        return true;
      }
      case 'features': {
        for (const feature of FEATURE_CONTROLS) {
          const flags = [feature.nonVolatile ? '*' : '', feature.alwaysOn ? '#' : ''].join('');
          console.log(`  ${String(feature.cc).padStart(3)} ${feature.name.padEnd(24)} ${device.state.features[feature.cc] ?? 0}${flags ? `  ${flags}` : ''}`);
        }
        return true;
      }
      case 'daw': {
        // A shortcut, not a simulation: it moves the device's own state without
        // any bytes crossing the wire. Use `send`-style host traffic on dawIn to
        // exercise what a patch actually does.
        const on = rest[0] !== 'off';
        device.receive('dawIn', on ? [0x9f, 0x0c, 0x7f] : [0x9f, 0x0c, 0x00]);
        console.log(`  device is now in ${device.state.dawMode ? 'DAW' : 'standalone'} mode (shortcut)`);
        panel?.broadcast({ type: 'state', state: device.state });
        return true;
      }
      case 'send': {
        const [role, ...byteTokens] = rest;
        if (role === undefined || !isPortRole(role)) {
          console.error(`send: first argument must be one of ${PORT_ROLES.join(', ')}`);
          return true;
        }
        try {
          ports.send(role, parseBytes(byteTokens.join(' ')));
        } catch (error) {
          console.error(`send: ${(error as Error).message}`);
        }
        return true;
      }
      default:
        console.error(`unknown command: ${command} (try "help")`);
        return true;
    }
  };

  await new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      if (!handleCommand(line)) rl.close();
    });
    rl.on('close', resolve);
    process.on('SIGINT', () => rl.close());
  });

  clearInterval(clock);
  ports.close();
  await panel?.close();
  await capture?.close();
  console.log('\nPorts closed.');
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const command = argv[0];

  switch (command) {
    case 'start':
      await start(argv);
      return;
    case 'ports':
      printSystemPorts();
      return;
    default:
      console.log(USAGE);
      process.exitCode = command === undefined || command === 'help' ? 0 : 1;
  }
};

await main();
