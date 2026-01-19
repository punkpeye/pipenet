import net from 'net';
import { describe, it, expect } from 'vitest';

import { TunnelAgent } from './TunnelAgent.js';

describe('TunnelAgent', () => {
  it('should create an empty agent', async () => {
    const agent = new TunnelAgent();
    expect(agent.started).toBe(false);

    const info = await agent.listen();
    expect(info.port).toBeGreaterThan(0);
    agent.destroy();
  });

  it('should create a new server and accept connections', async () => {
    const agent = new TunnelAgent();
    expect(agent.started).toBe(false);

    const info = await agent.listen();
    const sock = net.createConnection({ port: info.port });

    await new Promise(resolve => sock.once('connect', resolve));

    const agentSock = await new Promise<net.Socket>((resolve, reject) => {
      agent.createConnection({}, (err, sock) => {
        if (err) reject(err);
        resolve(sock as net.Socket);
      });
    });

    agentSock.write('foo');
    await new Promise(resolve => sock.once('readable', resolve));

    expect(sock.read().toString()).toBe('foo');
    agent.destroy();
    sock.destroy();
  });

  it('should reject connections over the max', async () => {
    const agent = new TunnelAgent({ maxTcpSockets: 2 });
    expect(agent.started).toBe(false);

    const info = await agent.listen();
    const sock1 = net.createConnection({ port: info.port });
    const sock2 = net.createConnection({ port: info.port });

    const p1 = new Promise(resolve => sock1.once('connect', resolve));
    const p2 = new Promise(resolve => sock2.once('connect', resolve));
    await Promise.all([p1, p2]);

    const sock3 = net.createConnection({ port: info.port });
    await new Promise(resolve => sock3.once('close', resolve));

    agent.destroy();
    sock1.destroy();
    sock2.destroy();
    sock3.destroy();
  });

  it('should queue createConnection requests', async () => {
    const agent = new TunnelAgent();
    expect(agent.started).toBe(false);

    const info = await agent.listen();

    let fulfilled = false;
    const waitSockPromise = new Promise((resolve, reject) => {
      agent.createConnection({}, (err, sock) => {
        fulfilled = true;
        if (err) reject(err);
        resolve(sock);
      });
    });

    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fulfilled).toBe(false);

    const sock = net.createConnection({ port: info.port });
    await new Promise(resolve => sock.once('connect', resolve));

    await waitSockPromise;
    agent.destroy();
    sock.destroy();
  });

  it('should emit online event when a socket connects', async () => {
    const agent = new TunnelAgent();
    const info = await agent.listen();

    const onlinePromise = new Promise(resolve => agent.once('online', resolve));

    const sock = net.createConnection({ port: info.port });
    await new Promise(resolve => sock.once('connect', resolve));

    await onlinePromise;
    agent.destroy();
    sock.destroy();
  });

  it('should emit offline event when socket disconnects', async () => {
    const agent = new TunnelAgent();
    const info = await agent.listen();

    const offlinePromise = new Promise(resolve => agent.once('offline', resolve));

    const sock = net.createConnection({ port: info.port });
    await new Promise(resolve => sock.once('connect', resolve));

    sock.end();
    await offlinePromise;
    agent.destroy();
    sock.destroy();
  });

  it('should emit offline event only when last socket disconnects', async () => {
    const agent = new TunnelAgent();
    const info = await agent.listen();

    const offlinePromise = new Promise(resolve => agent.once('offline', resolve));

    const sockA = net.createConnection({ port: info.port });
    await new Promise(resolve => sockA.once('connect', resolve));
    const sockB = net.createConnection({ port: info.port });
    await new Promise(resolve => sockB.once('connect', resolve));

    sockA.end();

    const timeout = new Promise(resolve => setTimeout(resolve, 500));
    await Promise.race([offlinePromise, timeout]);

    sockB.end();
    await offlinePromise;

    agent.destroy();
  });

  it('should return stats', async () => {
    const agent = new TunnelAgent();
    expect(agent.stats()).toEqual({ connectedSockets: 0 });
  });
});
