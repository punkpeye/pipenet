import { hri } from 'human-readable-ids';
import debug from 'debug';

import { Client } from './Client.js';
import { TunnelAgent } from './TunnelAgent.js';

export interface ClientManagerOptions {
  max_tcp_sockets?: number;
}

export interface NewClientInfo {
  id: string;
  port: number;
  max_conn_count?: number;
}

export class ClientManager {
  private opt: ClientManagerOptions;
  private clients: Map<string, Client>;
  public stats: { tunnels: number };
  private log: debug.Debugger;

  constructor(opt: ClientManagerOptions = {}) {
    this.opt = opt;
    this.clients = new Map();
    this.stats = { tunnels: 0 };
    this.log = debug('lt:ClientManager');
  }

  async newClient(requestedId?: string): Promise<NewClientInfo> {
    let id: string;
    if (requestedId && !this.clients.has(requestedId)) {
      id = requestedId;
    } else {
      id = hri.random();
    }

    const maxSockets = this.opt.max_tcp_sockets;
    const agent = new TunnelAgent({
      clientId: id,
      maxTcpSockets: 10,
    });

    const client = new Client({ id, agent });

    this.clients.set(id, client);

    client.once('close', () => {
      this.removeClient(id);
    });

    try {
      const info = await agent.listen();
      ++this.stats.tunnels;
      return {
        id: id,
        port: info.port,
        max_conn_count: maxSockets,
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

  hasClient(id: string): boolean {
    return this.clients.has(id);
  }

  getClient(id: string): Client | undefined {
    return this.clients.get(id);
  }
}
