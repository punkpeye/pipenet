import http from 'http';
import { Duplex } from 'stream';
import net from 'net';
import { describe, it, expect } from 'vitest';

import { Client } from './Client.js';
import { TunnelAgent } from './TunnelAgent.js';

class DummySocket extends Duplex {
  _write(chunk: Buffer, encoding: BufferEncoding, callback: () => void) {
    callback();
  }

  _read(_size: number) {
    this.push('HTTP/1.1 304 Not Modified\r\nX-Powered-By: dummy\r\n\r\n\r\n');
    this.push(null);
  }
}

class DummyWebsocket extends Duplex {
  private sentHeader = false;

  _write(chunk: Buffer, encoding: BufferEncoding, callback: () => void) {
    const str = chunk.toString();
    if (str.indexOf('GET / HTTP/1.1') === 0) {
      const arr = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
      ];
      this.push(arr.join('\r\n') + '\r\n\r\n');
    } else {
      this.push(str);
    }
    callback();
  }

  _read(_size: number) {
    // nothing to implement
  }
}

class DummyAgent extends http.Agent {
  createConnection(options: object, cb: (err: Error | null, socket: Duplex) => void) {
    cb(null, new DummySocket());
    return new DummySocket();
  }
}

describe('Client', () => {
  it('should handle request', async () => {
    const agent = new DummyAgent() as unknown as TunnelAgent;
    const client = new Client({ agent });

    const server = http.createServer((req, res) => {
      client.handleRequest(req, res);
    });

    await new Promise<void>(resolve => server.listen(resolve));

    const address = server.address() as net.AddressInfo;
    const opt = {
      host: 'localhost',
      port: address.port,
      path: '/',
    };

    const res = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.get(opt, (res) => {
        resolve(res);
      });
      req.end();
    });
    expect(res.headers['x-powered-by']).toBe('dummy');
    server.close();
  });

  it('should handle upgrade', async () => {
    class DummyWebsocketAgent extends http.Agent {
      createConnection(options: object, cb: (err: Error | null, socket: Duplex) => void) {
        cb(null, new DummyWebsocket());
        return new DummyWebsocket();
      }
    }

    const agent = new DummyWebsocketAgent() as unknown as TunnelAgent;
    const client = new Client({ agent });

    const server = http.createServer();
    server.on('upgrade', (req, socket, _head) => {
      client.handleUpgrade(req, socket);
    });

    await new Promise<void>(resolve => server.listen(resolve));

    const address = server.address() as net.AddressInfo;

    const netClient = await new Promise<net.Socket>((resolve) => {
      const newClient = net.createConnection({ port: address.port }, () => {
        resolve(newClient);
      });
    });

    const out = [
      'GET / HTTP/1.1',
      'Connection: Upgrade',
      'Upgrade: websocket'
    ];

    netClient.write(out.join('\r\n') + '\r\n\r\n');

    {
      const data = await new Promise<string>((resolve) => {
        netClient.once('data', (chunk) => {
          resolve(chunk.toString());
        });
      });
      const exp = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
      ];
      expect(data).toBe(exp.join('\r\n') + '\r\n\r\n');
    }

    {
      netClient.write('foobar');
      const data = await new Promise<string>((resolve) => {
        netClient.once('data', (chunk) => {
          resolve(chunk.toString());
        });
      });
      expect(data).toBe('foobar');
    }

    netClient.destroy();
    server.close();
  });
});
