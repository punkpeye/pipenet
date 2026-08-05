import type { Duplex } from 'stream';

import debug from 'debug';
import { EventEmitter } from 'events';
import http from 'http';
import pump from 'pump';

import type { TunnelAgent } from './TunnelAgent.js';

export interface ClientOptions {
  agent: TunnelAgent;
  id?: string;
}

export class Client extends EventEmitter {
  public id?: string;
  private agent: TunnelAgent;
  private graceTimeout: NodeJS.Timeout;
  private log: debug.Debugger;

  constructor(options: ClientOptions) {
    super();
    this.agent = options.agent;
    this.id = options.id;
    this.log = debug(`lt:Client[${this.id}]`);

    this.graceTimeout = setTimeout(() => {
      this.close();
    }, 1000);
    this.graceTimeout.unref();

    this.agent.on('online', () => {
      this.log('client online %s', this.id);
      clearTimeout(this.graceTimeout);
    });

    this.agent.on('offline', () => {
      this.log('client offline %s', this.id);
      clearTimeout(this.graceTimeout);
      this.graceTimeout = setTimeout(() => {
        this.close();
      }, 1000);
      this.graceTimeout.unref();
    });

    this.agent.once('error', () => {
      this.close();
    });
  }

  close() {
    clearTimeout(this.graceTimeout);
    this.agent.destroy();
    this.emit('close');
  }

  handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    this.log('> %s', req.url);
    const opt: http.RequestOptions = {
      agent: this.agent as unknown as http.Agent,
      headers: req.headers,
      method: req.method,
      timeout: 60000,
      path: req.url,
    };

    const clientReq = http.request(opt, (clientRes) => {
      this.log('< %s', req.url);
      res.writeHead(clientRes.statusCode!, clientRes.headers);
      pump(clientRes, res);
    });

    clientReq.on('timeout', () => {
      clientReq.destroy();
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('Gateway Timeout');
    });

    clientReq.once('error', () => {
      // TODO: if headers not sent - respond with gateway unavailable
    });

    pump(req, clientReq);
  }

  handleUpgrade(req: http.IncomingMessage, socket: Duplex) {
    this.log('> [up] %s', req.url);
    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return;
      console.error(err);
    });

    this.agent.createConnection({}, (err, conn) => {
      this.log('< [up] %s', req.url);
      if (err || !conn) {
        socket.end();
        return;
      }

      if (!socket.readable || !socket.writable) {
        conn.destroy();
        socket.end();
        return;
      }

      const arr = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length - 1; i += 2) {
        arr.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      arr.push('');
      arr.push('');

      pump(conn, socket);
      pump(socket, conn);
      conn.write(arr.join('\r\n'));
    });
  }

  stats() {
    return this.agent.stats();
  }
}
