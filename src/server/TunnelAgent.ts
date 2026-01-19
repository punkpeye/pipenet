import debug from 'debug';
import { Agent, ClientRequestArgs } from 'http';
import net from 'net';
import { Duplex } from 'stream';

import type { TunnelServer } from './TunnelServer.js';

const DEFAULT_MAX_SOCKETS = 10;

export interface TunnelAgentListenInfo {
  port: number;
}

export interface TunnelAgentOptions {
  clientId?: string;
  maxTcpSockets?: number;
  tunnelServer?: TunnelServer;
}

export interface TunnelAgentStats {
  connectedSockets: number;
}

type CreateConnectionCallback = (err: Error | null, socket: Duplex) => void;

export class TunnelAgent extends Agent {
  public started: boolean;
  private availableSockets: net.Socket[];
  private clientId?: string;
  private closed: boolean;
  private connectedSockets: number;
  private log: debug.Debugger;
  private maxTcpSockets: number;
  private server?: net.Server;
  private tunnelServer?: TunnelServer;
  private waitingCreateConn: CreateConnectionCallback[];

  constructor(options: TunnelAgentOptions = {}) {
    super({ keepAlive: true, maxFreeSockets: 1 });
    this.availableSockets = [];
    this.waitingCreateConn = [];
    this.clientId = options.clientId;
    this.log = debug(`lt:TunnelAgent[${options.clientId}]`);
    this.connectedSockets = 0;
    this.maxTcpSockets = options.maxTcpSockets || DEFAULT_MAX_SOCKETS;
    this.tunnelServer = options.tunnelServer;
    // Only create a local server if no shared tunnel server is provided
    if (!this.tunnelServer) {
      this.server = net.createServer();
    }
    this.started = false;
    this.closed = false;
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
    if (this.tunnelServer && this.clientId) {
      this.tunnelServer.unregisterHandler(this.clientId);
    }
    if (this.server) {
      this.server.close();
    }
    super.destroy();
  }

  listen(): Promise<TunnelAgentListenInfo> {
    if (this.started) throw new Error('already started');
    this.started = true;

    // If using shared tunnel server, register handler and return port 0
    // (the actual port is the tunnel server's port, handled externally)
    if (this.tunnelServer && this.clientId) {
      this.tunnelServer.registerHandler(this.clientId, (socket) => {
        this._onConnection(socket);
      });
      this.log('registered with shared tunnel server');
      // Return port 0 to indicate shared tunnel server mode
      return Promise.resolve({ port: 0 });
    }

    // Legacy mode: create our own TCP server
    if (!this.server) {
      throw new Error('No server available');
    }

    this.server.on('close', this._onClose.bind(this));
    this.server.on('connection', this._onConnection.bind(this));
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return;
      console.error(err);
    });

    return new Promise((resolve) => {
      this.server!.listen(() => {
        const addr = this.server!.address() as net.AddressInfo;
        this.log('tcp server listening on port: %d', addr.port);
        resolve({ port: addr.port });
      });
    });
  }

  stats(): TunnelAgentStats {
    return { connectedSockets: this.connectedSockets };
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
}
