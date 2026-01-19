import type { AddressInfo } from 'net';

import axios from 'axios';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pipenet } from './pipenet.js';
import { createServer } from './server/server.js';

describe('pipenet', () => {
  let host: string;
  let fakePort: number;
  let tunnelServer: http.Server;

  const localServer = http.createServer();

  beforeAll(async () => {
    // Start the local HTTP server that will be tunneled
    await new Promise<void>((resolve) => {
      localServer.on('request', (req, res) => {
        res.write(req.headers.host);
        res.end();
      });
      localServer.listen(() => {
        const addr = localServer.address() as AddressInfo;
        fakePort = addr.port;
        resolve();
      });
    });

    // Start a local tunnel server for testing
    tunnelServer = createServer({ domains: ['localhost'] });
    await new Promise<void>((resolve) => {
      tunnelServer.listen(() => {
        const addr = tunnelServer.address() as AddressInfo;
        host = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    localServer.close();
    tunnelServer.close();
  });

it('query pipenet server w/ ident', async () => {
  const tunnel = await pipenet(fakePort, { host });
  expect(tunnel.url).toMatch(/^https?:\/\/[a-z0-9-]+\.localhost:\d+$/);

  const parsed = new URL(tunnel.url!);
  const response = await axios.get(`${tunnel.url}/`);
  expect(response.data).toBe(parsed.host);

  tunnel.close();
});

it('request specific domain', async () => {
  const subdomain = Math.random().toString(36).substring(2);
  const tunnel = await pipenet(fakePort, { host, subdomain });
  expect(tunnel.url).toMatch(new RegExp(`^https?://${subdomain}\\.localhost:\\d+$`));
  tunnel.close();
});

describe('--local-host localhost', () => {
  it('override Host header with local-host', async () => {
    const tunnel = await pipenet(fakePort, { host, localHost: 'localhost' });
    expect(tunnel.url).toMatch(/^https?:\/\/[a-z0-9-]+\.localhost:\d+$/);

    const response = await axios.get(`${tunnel.url}/`);
    expect(response.data).toBe('localhost');
    tunnel.close();
  });
});

describe('--local-host 127.0.0.1', () => {
  it('override Host header with local-host', async () => {
    const tunnel = await pipenet(fakePort, { host, localHost: '127.0.0.1' });
    expect(tunnel.url).toMatch(/^https?:\/\/[a-z0-9-]+\.localhost:\d+$/);

    const response = await axios.get(`${tunnel.url}/`);
    expect(response.data).toBe('127.0.0.1');
    tunnel.close();
  });
});

describe('custom headers', () => {
  it('should accept custom headers option', async () => {
    const customHeaders = {
      'User-Agent': 'CustomAgent/1.0',
      'X-Custom-Header': 'test-value',
    };
    const tunnel = await pipenet(fakePort, { headers: customHeaders, host });
    expect(tunnel.url).toMatch(/^https?:\/\/[a-z0-9-]+\.localhost:\d+$/);
    tunnel.close();
  });
});

});