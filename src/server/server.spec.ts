import request from 'supertest';
import { WebSocketServer, WebSocket } from 'ws';
import net from 'net';
import { describe, it, expect } from 'vitest';

import { createServer } from './server.js';

describe('Server', () => {
  it('server starts and stops', async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(resolve));
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('should redirect root requests to landing page', async () => {
    const server = createServer();
    const res = await request(server).get('/');
    expect(res.headers.location).toBe('https://pipenet.dev/');
  });

  it('should support custom base domains', async () => {
    const server = createServer({
      domain: 'domain.example.com',
    });

    const res = await request(server).get('/');
    expect(res.headers.location).toBe('https://pipenet.dev/');
  });

  it('reject long domain name requests', async () => {
    const server = createServer();
    const res = await request(server).get('/thisdomainisoutsidethesizeofwhatweallowwhichissixtythreecharacters');
    expect(res.body.message).toBe('Invalid subdomain. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.');
  });

  it('should upgrade websocket requests', async () => {
    const hostname = 'websocket-test';
    const server = createServer({
      domain: 'example.com',
    });
    await new Promise<void>(resolve => server.listen(resolve));

    const res = await request(server).get('/websocket-test');
    const localTunnelPort = res.body.port;

    const wss = await new Promise<WebSocketServer>((resolve) => {
      const wsServer = new WebSocketServer({ port: 0 }, () => {
        resolve(wsServer);
      });
    });

    const websocketServerPort = (wss.address() as net.AddressInfo).port;

    const ltSocket = net.createConnection({ port: localTunnelPort });
    const wsSocket = net.createConnection({ port: websocketServerPort });

    // Wait for both sockets to connect
    await Promise.all([
      new Promise<void>(resolve => ltSocket.once('connect', resolve)),
      new Promise<void>(resolve => wsSocket.once('connect', resolve)),
    ]);

    ltSocket.pipe(wsSocket).pipe(ltSocket);

    wss.once('connection', (ws) => {
      ws.once('message', (message) => {
        ws.send(message);
      });
    });

    const ws = new WebSocket('http://localhost:' + (server.address() as net.AddressInfo).port, {
      headers: {
        host: hostname + '.example.com',
      }
    });

    ws.on('open', () => {
      ws.send('something');
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket message timeout')), 10000);
      ws.once('message', (msg) => {
        clearTimeout(timeout);
        expect(msg.toString()).toBe('something');
        resolve();
      });
      ws.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    ws.close();
    ltSocket.destroy();
    wsSocket.destroy();
    wss.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('should support the /api/tunnels/:id/status endpoint', async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(resolve));

    // no such tunnel yet
    const res = await request(server).get('/api/tunnels/foobar-test/status');
    expect(res.statusCode).toBe(404);

    // request a new client called foobar-test
    await request(server).get('/foobar-test');

    {
      const res = await request(server).get('/api/tunnels/foobar-test/status');
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        connected_sockets: 0,
      });
    }

    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('should include CORS headers in responses', async () => {
    const server = createServer();
    const res = await request(server).get('/api/status');

    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type, Authorization');
  });

  it('should handle OPTIONS preflight requests', async () => {
    const server = createServer();
    const res = await request(server).options('/api/status');

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
