import { Agent, ClientRequestArgs } from 'http';
import net from 'net';
import { Duplex } from 'stream';
import debug from 'debug';

const DEFAULT_MAX_SOCKETS = 10;

export interface TunnelAgentOptions {
  clientId?: string;
  maxTcpSockets?: number;
}

export interface TunnelAgentStats {
  connectedSockets: number;
}

export interface TunnelAgentListenInfo {
  port: number;
}

type CreateConnectionCallback = (err: Error | null, socket: Duplex) => void;

export class TunnelAgent extends Agent {
  private availableSockets: net.Socket[];
  private waitingCreateConn: CreateConnectionCallback[];
  private log: debug.Debugger;
  private connectedSockets: number;
  private maxTcpSockets: number;
  private server: net.Server;
  public started: boolean;
  private closed: boolean;

  constructor(options: TunnelAgentOptions = {}) {
    super({ keepAlive: true, maxFreeSockets: 1 });
    this.availableSockets = [];
    this.waitingCreateConn = [];
    this.log = debug(`lt:TunnelAgent[${options.clientId}]`);
    this.connectedSockets = 0;
    this.maxTcpSockets = options.maxTcpSockets || DEFAULT_MAX_SOCKETS;
    this.server = net.createServer();
    this.started = false;
    this.closed = false;
  }

  stats(): TunnelAgentStats {
    return { connectedSockets: this.connectedSockets };
  }

  listen(): Promise<TunnelAgentListenInfo> {
    if (this.started) throw new Error('already started');
    this.started = true;

    this.server.on('close', this._onClose.bind(this));
    this.server.on('connection', this._onConnection.bind(this));
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return;
      console.error(err);
    });

    return new Promise((resolve) => {
      this.server.listen(() => {
        const addr = this.server.address() as net.AddressInfo;
        this.log('tcp server listening on port: %d', addr.port);
        resolve({ port: addr.port });
      });
    });
  }

  private _onClose(): void {
    this.closed = true;
    this.log('closed tcp socket');
    for (const conn of this.waitingCreateConn) {
      conn(new Error('closed'), null as unknown as Duplex);
    }
    this.waitingCreateConn = [];
    this.emit('end');
  }

  private _onConnection(socket: net.Socket): void {
    if (this.connectedSockets >= this.maxTcpSockets) {
      this.log('no more sockets allowed');
      socket.destroy();
      return;
    }

    socket.once('close', (hadError: boolean) => {
      this.log('closed socket (error: %s)', hadError);
      this.connectedSockets -= 1;
      const idx = this.availableSockets.indexOf(socket);
      if (idx >= 0) this.availableSockets.splice(idx, 1);
      this.log('connected sockets: %s', this.connectedSockets);
      if (this.connectedSockets <= 0) {
        this.log('all sockets disconnected');
        this.emit('offline');
      }
    });

    socket.once('error', () => socket.destroy());

    if (this.connectedSockets === 0) this.emit('online');
    this.connectedSockets += 1;
    this.log('new connection from: %s:%s', socket.remoteAddress, socket.remotePort);

    const fn = this.waitingCreateConn.shift();
    if (fn) {
      this.log('giving socket to queued conn request');
      setTimeout(() => fn(null, socket), 0);
      return;
    }
    this.availableSockets.push(socket);
  }

  createConnection(options: ClientRequestArgs, cb?: CreateConnectionCallback): Duplex | null | undefined {
    if (this.closed) {
      cb?.(new Error('closed'), null as unknown as Duplex);
      return null;
    }
    this.log('create connection');
    const sock = this.availableSockets.shift();
    if (!sock) {
      if (cb) this.waitingCreateConn.push(cb);
      this.log('waiting connected: %s', this.connectedSockets);
      this.log('waiting available: %s', this.availableSockets.length);
      return undefined;
    }
    this.log('socket given');
    cb?.(null, sock);
    return sock;
  }

  destroy(): void {
    this.server.close();
    super.destroy();
  }
}
