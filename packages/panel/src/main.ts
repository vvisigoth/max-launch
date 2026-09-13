import './style.css';
import { FEATURE_CONTROLS, MODES } from '@lcxl3/core';
import type { ClientMessage, ControlDef, Gesture, ServerMessage, SurfaceState } from '@lcxl3/core';
import { Surface } from './surface.ts';
import { TrafficLog } from './log.ts';

const DEFAULT_BRIDGE_PORT = 7373;

/**
 * The bridge serves this page on its own port in production, and Vite serves it
 * on 5173 during development. Either way the WebSocket lives on the bridge.
 */
const bridgeUrl = (): string => {
  const override = new URLSearchParams(location.search).get('bridge');
  if (override !== null) return `ws://${override}`;
  const port = location.port === String(DEFAULT_BRIDGE_PORT) ? location.port : String(DEFAULT_BRIDGE_PORT);
  return `ws://${location.hostname}:${port}`;
};

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app is missing');

const left = document.createElement('div');
left.style.display = 'flex';
left.style.flexDirection = 'column';
left.style.minHeight = '0';

const header = document.createElement('div');
header.className = 'header';
const title = document.createElement('h1');
title.textContent = 'LAUNCH CONTROL XL 3';
const mode = document.createElement('span');
mode.className = 'mode';

/**
 * Standing in for the hardware's Mode button. Picking a mode here is a *user*
 * action, so the device reports it to the host - which is exactly the message a
 * patch is most likely to ignore.
 */
const modePicker = document.createElement('select');
modePicker.className = 'mode-picker';
for (const info of MODES) {
  const option = document.createElement('option');
  option.value = String(info.value);
  option.textContent = info.label;
  modePicker.append(option);
}
modePicker.addEventListener('change', () => {
  send({ kind: 'selectMode', mode: Number(modePicker.value) });
});

const link = document.createElement('span');
link.className = 'link-state';
header.append(title, mode, modePicker, link);

const notice = document.createElement('div');
notice.className = 'notice';
notice.hidden = true;

const log = new TrafficLog();
let surface: Surface | undefined;

/** A live readout of the feature controls, which are otherwise invisible. */
const features = document.createElement('details');
features.className = 'features';
const featuresSummary = document.createElement('summary');
featuresSummary.textContent = 'Feature controls';
const featuresGrid = document.createElement('div');
featuresGrid.className = 'features__grid';
features.append(featuresSummary, featuresGrid);

const featureValues = new Map<number, HTMLElement>();
for (const feature of FEATURE_CONTROLS) {
  const row = document.createElement('div');
  row.className = 'features__row';
  const name = document.createElement('span');
  name.textContent = feature.name;
  name.title = `CC ${feature.cc}${feature.nonVolatile ? ' — non-volatile' : ''}`;
  const value = document.createElement('b');
  value.textContent = '—';
  row.append(name, value);
  featureValues.set(feature.cc, value);
  featuresGrid.append(row);
}

const setConnection = (connected: boolean): void => {
  link.dataset['connected'] = String(connected);
  link.textContent = connected ? 'bridge connected' : 'bridge disconnected — is it running?';
};

const setState = (state: SurfaceState): void => {
  const onDawSurface = state.mode.kind !== 'custom';
  mode.dataset['daw'] = String(state.dawMode);
  mode.textContent = state.dawMode ? 'claimed' : 'standalone';
  if (modePicker.value !== String(state.mode.value)) modePicker.value = String(state.mode.value);

  notice.hidden = state.dawMode && onDawSurface;
  notice.textContent = !state.dawMode
    ? 'No host has claimed the device, so the surface sends nothing. Claim it by sending ' +
      'F0 00 20 29 02 15 02 7F F7 (or 9F 0C 7F) to LCXL3 1 DAW In.'
    : `A Custom Mode is selected (${state.mode.label}), so the surface sends through that mode's own ` +
      'mapping on the MIDI port rather than reporting on the DAW port. Pick a DAW mode above.';

  for (const [cc, node] of featureValues) node.textContent = String(state.features[cc] ?? 0);
  surface?.update(state);
};

let socket: WebSocket | undefined;

const send = (gesture: Gesture): void => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const message: ClientMessage = { type: 'gesture', gesture };
  socket.send(JSON.stringify(message));
};

const build = (controls: readonly ControlDef[]): void => {
  surface = new Surface(controls, send);
  left.replaceChildren(header, notice, surface.element, features);
};

const connect = (): void => {
  socket = new WebSocket(bridgeUrl());

  socket.addEventListener('open', () => setConnection(true));
  socket.addEventListener('close', () => {
    setConnection(false);
    setTimeout(connect, 1000);
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    switch (message.type) {
      case 'hello':
        build(message.controls);
        setState(message.state);
        for (const entry of message.recent) log.append(entry.message, entry.decoded);
        break;
      case 'state':
        setState(message.state);
        break;
      case 'midi':
        log.append(message.message, message.decoded);
        break;
    }
  });
};

left.replaceChildren(header, notice);
app.append(left, log.element);
setConnection(false);
connect();
