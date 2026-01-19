import http from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import axios from 'axios';

import pipenet from './pipenet.js';

const host = 'https://pipenet.dev';

let fakePort: number;

const server = http.createServer();

beforeAll(async () => {
  return new Promise<void>((resolve) => {
    server.on('request', (req, res) => {
      res.write(req.headers.host);
      res.end();
    });
    server.listen(() => {
      const addr = server.address() as AddressInfo;
      fakePort = addr.port;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

it('query pipenet server w/ ident', async () => {
  const tunnel = await pipenet(fakePort, { host });
  expect(tunnel.url).toMatch(/^https:\/\/[a-z0-9-]+\.pipenet\.dev$/);

  const parsed = new URL(tunnel.url!);
  const response = await axios.get(`${tunnel.url}/`);
  expect(response.data).toBe(parsed.host);

  tunnel.close();
});

it('request specific domain', async () => {
  const subdomain = Math.random().toString(36).substring(2);
  const tunnel = await pipenet(fakePort, { host, subdomain });
  expect(tunnel.url).toMatch(new RegExp(`^https://${subdomain}\\.pipenet\\.dev$`));
  tunnel.close();
});

describe('--local-host localhost', () => {
  it('override Host header with local-host', async () => {
    const tunnel = await pipenet(fakePort, { host, local_host: 'localhost' });
    expect(tunnel.url).toMatch(/^https:\/\/[a-z0-9-]+\.pipenet\.dev$/);

    const response = await axios.get(`${tunnel.url}/`);
    expect(response.data).toBe('localhost');
    tunnel.close();
  });
});

describe('--local-host 127.0.0.1', () => {
  it('override Host header with local-host', async () => {
    const tunnel = await pipenet(fakePort, { host, local_host: '127.0.0.1' });
    expect(tunnel.url).toMatch(/^https:\/\/[a-z0-9-]+\.pipenet\.dev$/);

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
    const tunnel = await pipenet(fakePort, { host, headers: customHeaders });
    expect(tunnel.url).toMatch(/^https:\/\/[a-z0-9-]+\.tunnel\.gla\.ma$/);
    tunnel.close();
  });
});
