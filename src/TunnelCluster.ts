import debug from 'debug';
import { EventEmitter } from 'events';
import fs from 'fs';
import net from 'net';
import tls from 'tls';

import { HeaderHostTransformer } from './HeaderHostTransformer.js';

const log = debug('pipenet:client');

export interface TunnelClusterOptions {
  allowInvalidCert?: boolean;
  cachedUrl?: string;
  localCa?: string;
  localCert?: string;
  localHost?: string;
  localHttps?: boolean;
  localKey?: string;
  localPort?: number;
  maxConn?: number;
  name?: string;
  remoteHost?: string;
  remoteIp?: string;
  remotePort?: number;
  sharedTunnel?: boolean;
  url?: string;
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

    const remoteHostOrIp = opt.remoteIp || opt.remoteHost;
    const remotePort = opt.remotePort;
    const localHost = opt.localHost || 'localhost';
    const localPort = opt.localPort;
    const localProtocol = opt.localHttps ? 'https' : 'http';
    const allowInvalidCert = opt.allowInvalidCert;

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
              ca: opt.localCa ? [fs.readFileSync(opt.localCa)] : undefined,
              cert: fs.readFileSync(opt.localCert!),
              key: fs.readFileSync(opt.localKey!),
            };

      const local = opt.localHttps
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

        if (opt.localHost) {
          log('transform Host header to %s', opt.localHost);
          stream = remote.pipe(new HeaderHostTransformer({ host: opt.localHost }));
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
      // Send client ID as the first message for shared tunnel server mode
      if (opt.sharedTunnel && opt.name) {
        log('sending client ID for shared tunnel: %s', opt.name);
        remote.write(opt.name + '\n');
      }
      this.emit('open', remote);
      connLocal();
    });
  }
}

