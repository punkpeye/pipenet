import { EventEmitter } from 'events';
import axios from 'axios';
import debug from 'debug';

import { TunnelCluster, TunnelClusterOptions } from './TunnelCluster.js';

const log = debug('pipenet:client');

export interface TunnelOptions {
  port?: number;
  host?: string;
  subdomain?: string;
  local_host?: string;
  local_https?: boolean;
  local_cert?: string;
  local_key?: string;
  local_ca?: string;
  allow_invalid_cert?: boolean;
  headers?: Record<string, string>;
}

interface TunnelInfo extends TunnelClusterOptions {
  name: string;
  url: string;
  cached_url?: string;
  max_conn: number;
  remote_host: string;
  remote_ip: string;
  remote_port: number;
  local_port?: number;
  local_host?: string;
  local_https?: boolean;
  local_cert?: string;
  local_key?: string;
  local_ca?: string;
  allow_invalid_cert?: boolean;
}

interface ServerResponse {
  id: string;
  ip: string;
  port: number;
  url: string;
  cached_url?: string;
  max_conn_count?: number;
  message?: string;
}

export class Tunnel extends EventEmitter {
  public opts: TunnelOptions;
  public closed: boolean;
  public clientId?: string;
  public url?: string;
  public cachedUrl?: string;
  public tunnelCluster?: TunnelCluster;

  constructor(opts: TunnelOptions = {}) {
    super();
    this.opts = opts;
    this.closed = false;
    if (!this.opts.host) {
      this.opts.host = 'https://pipenet.dev';
    }
  }

  private _getInfo(body: ServerResponse): TunnelInfo {
    const { id, ip, port, url, cached_url, max_conn_count } = body;
    const { host, port: local_port, local_host } = this.opts;
    const { local_https, local_cert, local_key, local_ca, allow_invalid_cert } = this.opts;
    
    return {
      name: id,
      url,
      cached_url,
      max_conn: max_conn_count || 1,
      remote_host: new URL(host!).hostname,
      remote_ip: ip,
      remote_port: port,
      local_port,
      local_host,
      local_https,
      local_cert,
      local_key,
      local_ca,
      allow_invalid_cert,
    };
  }

  private _init(cb: (err: Error | null, info?: TunnelInfo) => void): void {
    const opt = this.opts;
    const getInfo = this._getInfo.bind(this);

    const params = {
      responseType: 'json' as const,
      headers: opt.headers || {},
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
          if (res.status !== 200) {
            const err = new Error(
              body?.message || 'pipenet server returned an error, please try again'
            );
            return cb(err);
          }
          cb(null, getInfo(body));
        })
        .catch((err: Error) => {
          log(`tunnel server offline: ${err.message}, retry 1s`);
          setTimeout(getUrl, 1000);
        });
    };

    getUrl();
  }

  private _establish(info: TunnelInfo): void {
    this.setMaxListeners(info.max_conn + (EventEmitter.defaultMaxListeners || 10));

    this.tunnelCluster = new TunnelCluster(info);

    this.tunnelCluster.once('open', () => {
      this.emit('url', info.url);
    });

    this.tunnelCluster.on('error', (err: Error) => {
      log('got socket error', err.message);
      this.emit('error', err);
    });

    let tunnelCount = 0;

    this.tunnelCluster.on('open', (tunnel: { destroy: () => void; once: (event: string, handler: () => void) => void }) => {
      tunnelCount++;
      log('tunnel open [total: %d]', tunnelCount);

      const closeHandler = (): void => {
        tunnel.destroy();
      };

      if (this.closed) {
        closeHandler();
        return;
      }

      this.once('close', closeHandler);
      tunnel.once('close', () => {
        this.removeListener('close', closeHandler);
      });
    });

    this.tunnelCluster.on('dead', () => {
      tunnelCount--;
      log('tunnel dead [total: %d]', tunnelCount);
      if (this.closed) {
        return;
      }
      this.tunnelCluster!.open();
    });

    this.tunnelCluster.on('request', (req) => {
      this.emit('request', req);
    });

    for (let count = 0; count < info.max_conn; ++count) {
      this.tunnelCluster.open();
    }
  }

  open(cb: (err?: Error) => void): void {
    this._init((err, info) => {
      if (err) {
        cb(err);
        return;
      }

      this.clientId = info!.name;
      this.url = info!.url;

      if (info!.cached_url) {
        this.cachedUrl = info!.cached_url;
      }

      this._establish(info!);
      cb();
    });
  }

  close(): void {
    this.closed = true;
    this.emit('close');
  }
}

