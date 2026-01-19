import { EventEmitter } from 'events';
import debug from 'debug';
import fs from 'fs';
import net from 'net';
import tls from 'tls';

import { HeaderHostTransformer } from './HeaderHostTransformer.js';

const log = debug('pipenet:client');

export interface TunnelClusterOptions {
  name?: string;
  url?: string;
  cached_url?: string;
  max_conn?: number;
  remote_host?: string;
  remote_ip?: string;
  remote_port?: number;
  local_port?: number;
  local_host?: string;
  local_https?: boolean;
  local_cert?: string;
  local_key?: string;
  local_ca?: string;
  allow_invalid_cert?: boolean;
}

export interface TunnelRequest {
  method: string;
  path: string;
}

export class TunnelCluster extends EventEmitter {
  private opts: TunnelClusterOptions;

  constructor(opts: TunnelClusterOptions = {}) {
    super();
    this.opts = opts;
  }

  open(): void {
    const opt = this.opts;

    const remoteHostOrIp = opt.remote_ip || opt.remote_host;
    const remotePort = opt.remote_port;
    const localHost = opt.local_host || 'localhost';
    const localPort = opt.local_port;
    const localProtocol = opt.local_https ? 'https' : 'http';
    const allowInvalidCert = opt.allow_invalid_cert;

    log(
      'establishing tunnel %s://%s:%s <> %s:%s',
      localProtocol,
      localHost,
      localPort,
      remoteHostOrIp,
      remotePort
    );

    const remote = net.connect({
      host: remoteHostOrIp,
      port: remotePort!,
    });

    remote.setKeepAlive(true);

    remote.on('error', (err: NodeJS.ErrnoException) => {
      log('got remote connection error', err.message);

      if (err.code === 'ECONNREFUSED') {
        this.emit(
          'error',
          new Error(
            `connection refused: ${remoteHostOrIp}:${remotePort} (check your firewall settings)`
          )
        );
      }

      remote.end();
    });

    const connLocal = (): void => {
      if (remote.destroyed) {
        log('remote destroyed');
        this.emit('dead');
        return;
      }

      log('connecting locally to %s://%s:%d', localProtocol, localHost, localPort);
      remote.pause();

      if (allowInvalidCert) {
        log('allowing invalid certificates');
      }

      const getLocalCertOpts = () =>
        allowInvalidCert
          ? { rejectUnauthorized: false }
          : {
              cert: fs.readFileSync(opt.local_cert!),
              key: fs.readFileSync(opt.local_key!),
              ca: opt.local_ca ? [fs.readFileSync(opt.local_ca)] : undefined,
            };

      const local = opt.local_https
        ? tls.connect({ host: localHost, port: localPort!, ...getLocalCertOpts() })
        : net.connect({ host: localHost, port: localPort! });

      const remoteClose = (): void => {
        log('remote close');
        this.emit('dead');
        local.end();
      };

      remote.once('close', remoteClose);

      local.once('error', (err: NodeJS.ErrnoException) => {
        log('local error %s', err.message);
        local.end();

        remote.removeListener('close', remoteClose);

        if (err.code !== 'ECONNREFUSED' && err.code !== 'ECONNRESET') {
          remote.end();
          return;
        }

        setTimeout(connLocal, 1000);
      });

      local.once('connect', () => {
        log('connected locally');
        remote.resume();

        let stream: NodeJS.ReadableStream = remote;

        if (opt.local_host) {
          log('transform Host header to %s', opt.local_host);
          stream = remote.pipe(new HeaderHostTransformer({ host: opt.local_host }));
        }

        stream.pipe(local).pipe(remote);

        local.once('close', (hadError: boolean) => {
          log('local connection closed [%s]', hadError);
        });
      });
    };

    remote.on('data', (data: Buffer) => {
      const match = data.toString().match(/^(\w+) (\S+)/);
      if (match) {
        this.emit('request', {
          method: match[1],
          path: match[2],
        } as TunnelRequest);
      }
    });

    remote.once('connect', () => {
      this.emit('open', remote);
      connLocal();
    });
  }
}

