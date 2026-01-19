import net from 'net';
import { describe, it, expect } from 'vitest';

import { ClientManager } from './ClientManager.js';

describe('ClientManager', () => {
  it('should construct with no tunnels', () => {
    const manager = new ClientManager();
    expect(manager.stats.tunnels).toBe(0);
  });

  it('should create a new client with random id', async () => {
    const manager = new ClientManager();
    const client = await manager.newClient();
    expect(manager.hasClient(client.id)).toBe(true);
    manager.removeClient(client.id);
  });

  it('should create a new client with id', async () => {
    const manager = new ClientManager();
    await manager.newClient('foobar');
    expect(manager.hasClient('foobar')).toBe(true);
    manager.removeClient('foobar');
  });

  it('should create a new client with random id if previous exists', async () => {
    const manager = new ClientManager();
    const clientA = await manager.newClient('foobar');
    const clientB = await manager.newClient('foobar');
    expect(clientA.id).toBe('foobar');
    expect(manager.hasClient(clientB.id)).toBe(true);
    expect(clientB.id).not.toBe(clientA.id);
    manager.removeClient(clientB.id);
    manager.removeClient('foobar');
  });

  it('should remove client once it goes offline', async () => {
    const manager = new ClientManager();
    const client = await manager.newClient('foobar');

    const socket = await new Promise<net.Socket>((resolve) => {
      const netClient = net.createConnection({ port: client.port }, () => {
        resolve(netClient);
      });
    });
    const closePromise = new Promise(resolve => socket.once('close', resolve));
    socket.end();
    await closePromise;

    // should still have client - grace period has not expired
    expect(manager.hasClient('foobar')).toBe(true);

    // wait past grace period (1s)
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(manager.hasClient('foobar')).toBe(false);
  }, 5000);

  it('should remove correct client once it goes offline', async () => {
    const manager = new ClientManager();
    const clientFoo = await manager.newClient('foo');
    await manager.newClient('bar');

    const socket = await new Promise<net.Socket>((resolve) => {
      const netClient = net.createConnection({ port: clientFoo.port }, () => {
        resolve(netClient);
      });
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    // foo should still be ok
    expect(manager.hasClient('foo')).toBe(true);

    // clientBar should be removed - nothing connected to it
    expect(manager.hasClient('bar')).toBe(false);

    manager.removeClient('foo');
    socket.end();
  }, 5000);

  it('should remove clients if they do not connect within 5 seconds', async () => {
    const manager = new ClientManager();
    await manager.newClient('foo');
    expect(manager.hasClient('foo')).toBe(true);

    // wait past grace period (1s)
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(manager.hasClient('foo')).toBe(false);
  }, 5000);
});
