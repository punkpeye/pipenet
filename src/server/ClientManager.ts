import debug from 'debug';
import { hri } from 'human-readable-ids';

import { Client } from './Client.js';
import { TunnelAgent } from './TunnelAgent.js';
import type { TunnelServer } from './TunnelServer.js';

export interface ClientManagerOptions {
  maxTcpSockets?: number;
  tunnelServer?: TunnelServer;
}

export interface NewClientInfo {
  id: string;
  maxConnCount?: number;
  port: number;
}

export class ClientManager {
  public stats: { tunnels: number };
  private clients: Map<string, Client>;
  private log: debug.Debugger;
  private opt: ClientManagerOptions;

  constructor(opt: ClientManagerOptions = {}) {
    this.opt = opt;
    this.clients = new Map();
    this.stats = { tunnels: 0 };
    this.log = debug('lt:ClientManager');
  }

  getClient(id: string): Client | undefined {
    return this.clients.get(id);
  }

  hasClient(id: string): boolean {
    return this.clients.has(id);
  }

  async newClient(requestedId?: string): Promise<NewClientInfo> {
    let id: string;
    if (requestedId && !this.clients.has(requestedId)) {
      id = requestedId;
    } else {
      id = hri.random();
    }

    const maxSockets = this.opt.maxTcpSockets;
    const agent = new TunnelAgent({
      clientId: id,
      maxTcpSockets: 10,
      tunnelServer: this.opt.tunnelServer,
    });

    const client = new Client({ agent, id });

    this.clients.set(id, client);

    client.once('close', () => {
      this.removeClient(id);
    });

    try {
      const info = await agent.listen();
      ++this.stats.tunnels;
      return {
        id: id,
        maxConnCount: maxSockets,
        port: info.port,
      };
    } catch (err) {
      this.removeClient(id);
      throw err;
    }
  }

  removeClient(id: string): void {
    this.log('removing client: %s', id);
    const client = this.clients.get(id);
    if (!client) return;
    --this.stats.tunnels;
    this.clients.delete(id);
    client.close();
  }
}
