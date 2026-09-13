import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, Gesture, ServerMessage } from '@lcxl3/core';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const isGesture = (value: unknown): value is Gesture => {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<Gesture>;
  if (g.kind === 'selectMode') return typeof (g as { mode?: unknown }).mode === 'number';
  if (typeof (g as { controlId?: unknown }).controlId !== 'string') return false;
  switch (g.kind) {
    case 'setValue':
      return typeof (g as { value?: unknown }).value === 'number';
    case 'turn':
      return typeof (g as { delta?: unknown }).delta === 'number';
    case 'press':
    case 'release':
    case 'grab':
    case 'letGo':
      return true;
    default:
      return false;
  }
};

export interface PanelServerOptions {
  readonly port: number;
  /** Directory of the built panel. Served only if it exists. */
  readonly staticDir?: string;
  readonly onGesture: (gesture: Gesture) => void;
  /** Called for each new client, to seed it with a `hello`. */
  readonly greet: () => ServerMessage;
}

/**
 * Serves the panel and carries the two-way stream it needs.
 *
 * The panel is a view: it sends gestures and receives state and traffic. It
 * never decides what bytes go on the wire, so a browser that is closed, slow or
 * absent cannot affect what Max sees.
 */
export class PanelServer {
  readonly #http: Server;
  readonly #wss: WebSocketServer;
  readonly #clients = new Set<WebSocket>();
  readonly #options: PanelServerOptions;

  constructor(options: PanelServerOptions) {
    this.#options = options;
    this.#http = createServer((request, response) => this.#serveStatic(request, response));
    this.#wss = new WebSocketServer({ server: this.#http });

    this.#wss.on('connection', (socket) => {
      this.#clients.add(socket);
      socket.send(JSON.stringify(options.greet()));
      socket.on('message', (raw) => this.#handle(raw.toString()));
      socket.on('close', () => this.#clients.delete(socket));
      socket.on('error', () => this.#clients.delete(socket));
    });
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  listen(): Promise<void> {
    return new Promise((done) => this.#http.listen(this.#options.port, done));
  }

  broadcast(message: ServerMessage): void {
    if (this.#clients.size === 0) return;
    const payload = JSON.stringify(message);
    for (const socket of this.#clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  async close(): Promise<void> {
    for (const socket of this.#clients) socket.close();
    this.#clients.clear();
    await new Promise<void>((done) => this.#wss.close(() => done()));
    await new Promise<void>((done) => this.#http.close(() => done()));
  }

  #handle(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const message = parsed as Partial<ClientMessage>;
    if (message.type === 'gesture' && isGesture(message.gesture)) {
      this.#options.onGesture(message.gesture);
    }
  }

  #serveStatic(request: IncomingMessage, response: ServerResponse): void {
    const root = this.#options.staticDir;
    if (root === undefined || !existsSync(root)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Panel is not built. Run `npm run panel` for the dev server, or `npm run panel:build`.\n');
      return;
    }

    const requested = (request.url ?? '/').split('?')[0] ?? '/';
    const relative = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, '');
    let path = resolve(join(root, relative));

    // Never serve outside the panel's own build output.
    if (!path.startsWith(resolve(root))) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
    if (!existsSync(path)) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(response);
  }
}
