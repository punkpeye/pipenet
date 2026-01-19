import debug from 'debug';
import http from 'http';
import { hri } from 'human-readable-ids';
import Koa from 'koa';
import Router from 'koa-router';
import tldjs from 'tldjs';

import { ClientManager } from './ClientManager.js';

const log = debug('pipenet:server');

export interface ServerOptions {
  domains?: string[];
  landing?: string;
  maxTcpSockets?: number;
  secure?: boolean;
}

export function createServer(opt: ServerOptions = {}): http.Server {
  const validHosts = opt.domains && opt.domains.length > 0 ? opt.domains : undefined;
  const myTldjs = tldjs.fromUserSettings({ validHosts });
  const landingPage = opt.landing || 'https://pipenet.dev/';

  function GetClientIdFromHostname(hostname: string): null | string {
    return myTldjs.getSubdomain(hostname);
  }

  const manager = new ClientManager(opt);

  const schema = opt.secure ? 'https' : 'http';

  const app = new Koa();
  const router = new Router();

  // CORS middleware
  app.use(async (ctx, next) => {
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (ctx.method === 'OPTIONS') {
      ctx.status = 204;
      return;
    }

    await next();
  });

  router.get('/api/status', async (ctx) => {
    const stats = manager.stats;
    ctx.body = {
      mem: process.memoryUsage(),
      tunnels: stats.tunnels,
    };
  });

  router.get('/api/tunnels/:id/status', async (ctx) => {
    const clientId = ctx.params.id;
    const client = manager.getClient(clientId);
    if (!client) {
      ctx.throw(404);
      return;
    }

    const stats = client.stats();
    ctx.body = {
      connectedSockets: stats.connectedSockets,
    };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  app.use(async (ctx, next) => {
    const path = ctx.request.path;

    if (path !== '/') {
      await next();
      return;
    }

    const isNewClientRequest = ctx.query['new'] !== undefined;
    if (isNewClientRequest) {
      const reqId = hri.random();
      log('making new client with id %s', reqId);
      const info = await manager.newClient(reqId);

      const url = schema + '://' + info.id + '.' + ctx.request.host;
      ctx.body = { ...info, url };
      return;
    }

    ctx.redirect(landingPage);
  });

  app.use(async (ctx, next) => {
    const parts = ctx.request.path.split('/');

    if (parts.length !== 2) {
      await next();
      return;
    }

    const reqId = parts[1];

    if (!/^(?:[a-z0-9][a-z0-9-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/.test(reqId)) {
      const msg = 'Invalid subdomain. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.';
      ctx.status = 403;
      ctx.body = { message: msg };
      return;
    }

    log('making new client with id %s', reqId);
    const info = await manager.newClient(reqId);

    const url = schema + '://' + info.id + '.' + ctx.request.host;
    ctx.body = { ...info, url };
  });

  const server = http.createServer();

  const appCallback = app.callback();

  server.on('request', (req, res) => {
    const hostname = req.headers.host;
    if (!hostname) {
      res.statusCode = 400;
      res.end('Host header is required');
      return;
    }

    const clientId = GetClientIdFromHostname(hostname);
    if (!clientId) {
      appCallback(req, res);
      return;
    }

    const client = manager.getClient(clientId);
    if (!client) {
      res.statusCode = 404;
      res.end('404');
      return;
    }

    client.handleRequest(req, res);
  });

  server.on('upgrade', (req, socket) => {
    const hostname = req.headers.host;
    if (!hostname) {
      socket.destroy();
      return;
    }

    const clientId = GetClientIdFromHostname(hostname);
    if (!clientId) {
      socket.destroy();
      return;
    }

    const client = manager.getClient(clientId);
    if (!client) {
      socket.destroy();
      return;
    }

    client.handleUpgrade(req, socket);
  });

  return server;
}
