import axios, { AxiosError } from 'axios';
import debug from 'debug';
import { EventEmitter } from 'events';
import net from 'net';

import { TunnelCluster, TunnelClusterOptions } from './TunnelCluster.js';

const log = debug('pipenet:client');

export interface TunnelOptions {
  allowInvalidCert?: boolean;
  headers?: Record<string, string>;
  host?: string;
  localCa?: string;
  localCert?: string;
  localHost?: string;
  localHttps?: boolean;
  localKey?: string;
  port?: number;
  subdomain?: string;
}

interface ServerResponse {
  cachedUrl?: string;
  id: string;
  ip: string;
  maxConnCount?: number;
  message?: string;
  port: number;
  sharedTunnel?: boolean;
  url: string;
}

interface TunnelInfo extends TunnelClusterOptions {
  allowInvalidCert?: boolean;
  cachedUrl?: string;
  localCa?: string;
  localCert?: string;
  localHost?: string;
  localHttps?: boolean;
  localKey?: string;
  localPort?: number;
  maxConn: number;
  name: string;
  remoteHost: string;
  remoteIp: string;
  remotePort: number;
  sharedTunnel?: boolean;
  url: string;
}

export class Tunnel extends EventEmitter {
  public cachedUrl?: string;
  public clientId?: string;
  public closed: boolean;
  public opts: TunnelOptions;
  public tunnelCluster?: TunnelCluster;
  public url?: string;

  constructor(opts: TunnelOptions = {}) {
    super();
    this.opts = opts;
    this.closed = false;
    if (!this.opts.host) {
      this.opts.host = 'https://pipenet.dev';
    }
  }

  close(): void {
    this.closed = true;
    this.emit('close');
  }

  open(cb: (err?: Error) => void): void {
    this._init((err, info) => {
      if (err) {
        cb(err);
        return;
      }

      this.clientId = info!.name;
      this.url = info!.url;

      if (info!.cachedUrl) {
        this.cachedUrl = info!.cachedUrl;
      }

      this._establish(info!);
      cb();
    });
  }

  private _establish(info: TunnelInfo): void {
    this.setMaxListeners(info.maxConn + (EventEmitter.defaultMaxListeners || 10));

    this.tunnelCluster = new TunnelCluster(info);

    this.tunnelCluster.once('open', () => {
      this.emit('url', info.url);
    });

    this.tunnelCluster.on('error', (err: Error) => {
      log('got socket error', err.message);
      this.emit('error', err);
    });

    let tunnelCount = 0;
    const tunnelHandlers = new Map<net.Socket, () => void>();

    this.tunnelCluster.on('open', (tunnel: net.Socket) => {
      tunnelCount++;
      log('tunnel open [total: %d]', tunnelCount);

      const closeHandler = (): void => {
        tunnel.destroy();
      };

      if (this.closed) {
        closeHandler();
        return;
      }

      tunnelHandlers.set(tunnel, closeHandler);
      this.once('close', closeHandler);
      tunnel.once('close', () => {
        tunnelHandlers.delete(tunnel);
        this.removeListener('close', closeHandler);
      });
    });

    this.tunnelCluster.on('dead', (deadSocket?: net.Socket) => {
      tunnelCount--;
      log('tunnel dead [total: %d]', tunnelCount);

      // Eagerly remove the close handler for the dead tunnel.
      // Without this, the handler lingers until the socket's async
      // 'close' event fires, causing listener accumulation.
      if (deadSocket && tunnelHandlers.has(deadSocket)) {
        const handler = tunnelHandlers.get(deadSocket)!;
        tunnelHandlers.delete(deadSocket);
        this.removeListener('close', handler);
      }

      if (this.closed) {
        return;
      }
      this.tunnelCluster!.open();
    });

    this.tunnelCluster.on('request', (req) => {
      this.emit('request', req);
    });

    for (let count = 0; count < info.maxConn; ++count) {
      this.tunnelCluster.open();
    }
  }

  private _getInfo(body: ServerResponse): TunnelInfo {
    const { cachedUrl, id, ip, maxConnCount, port, sharedTunnel, url } = body;
    const { host, localHost, port: localPort } = this.opts;
    const { allowInvalidCert, localCa, localCert, localHttps, localKey } = this.opts;

    return {
      allowInvalidCert,
      cachedUrl,
      localCa,
      localCert,
      localHost,
      localHttps,
      localKey,
      localPort,
      maxConn: maxConnCount || 1,
      name: id,
      remoteHost: new URL(host!).hostname,
      remoteIp: ip,
      remotePort: port,
      sharedTunnel,
      url,
    };
  }

  private _init(cb: (err: Error | null, info?: TunnelInfo) => void): void {
    const opt = this.opts;
    const getInfo = this._getInfo.bind(this);

    const params = {
      headers: opt.headers || {},
      responseType: 'json' as const,
    };

    const baseUri = `${opt.host}/`;
    const assignedDomain = opt.subdomain;
    const uri = baseUri + (assignedDomain || '?new');

    const getUrl = (): void => {
      axios
        .get<ServerResponse>(uri, params)
        .then((res) => {
          const body = res.data;
          log('got tunnel information', res.data);
          cb(null, getInfo(body));
        })
        .catch((err: AxiosError<ServerResponse>) => {
          if (err.response && err.response.status >= 400 && err.response.status < 500) {
            const message = err.response.data?.message || err.message;
            return cb(new Error(message));
          }
          log(`tunnel server offline: ${err.message}, retry 1s`);
          setTimeout(getUrl, 1000);
        });
    };

    getUrl();
  }
}

