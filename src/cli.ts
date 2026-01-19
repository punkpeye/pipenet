#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { pipenet } from './pipenet.js';
import { createServer } from './server/index.js';

interface ClientOptions {
  'allow-invalid-cert'?: boolean;
  headers?: string;
  host: string;
  'local-ca'?: string;
  'local-cert'?: string;
  'local-host': string;
  'local-https'?: boolean;
  'local-key'?: string;
  port: number;
  'print-requests'?: boolean;
  subdomain?: string;
}

interface ServerOptions {
  domain?: string;
  landing?: string;
  'max-sockets'?: number;
  port: number;
  secure?: boolean;
}

async function runClient(opts: ClientOptions) {
  let headers: Record<string, string> | undefined;
  if (opts.headers) {
    try {
      headers = JSON.parse(opts.headers);
    } catch (err) {
      console.error('Invalid headers JSON:', err);
      process.exit(1);
    }
  }

  const tunnel = await pipenet({
    allow_invalid_cert: opts['allow-invalid-cert'],
    headers,
    host: opts.host,
    local_ca: opts['local-ca'],
    local_cert: opts['local-cert'],
    local_host: opts['local-host'],
    local_https: opts['local-https'],
    local_key: opts['local-key'],
    port: opts.port,
    subdomain: opts.subdomain,
  });

  console.log('your url is: %s', tunnel.url);

  tunnel.on('error', (err: Error) => {
    console.error('tunnel error:', err.message);
  });

  tunnel.on('close', () => {
    console.log('tunnel closed');
    process.exit(0);
  });

  if (opts['print-requests']) {
    tunnel.on('request', (info: { method: string; path: string }) => {
      console.log('%s %s', info.method, info.path);
    });
  }

  process.on('SIGINT', () => {
    tunnel.close();
  });
}

function runServer(opts: ServerOptions) {
  const server = createServer({
    domain: opts.domain,
    landing: opts.landing,
    max_tcp_sockets: opts['max-sockets'],
    secure: opts.secure,
  });

  server.listen(opts.port, () => {
    console.log('pipenet server listening on port %d', opts.port);
    if (opts.domain) {
      console.log('tunnel domain: %s', opts.domain);
    }
  });

  process.on('SIGINT', () => {
    console.log('shutting down server...');
    server.close(() => {
      process.exit(0);
    });
  });
}

yargs(hideBin(process.argv))
  .usage('Usage: pipenet <command> [options]')
  .env(true)
  .demandCommand(1, 'You must specify a command: client or server')
  .command(
    'client',
    'Start a tunnel client',
    (yargs) => {
      return yargs
        .option('port', {
          alias: 'p',
          demandOption: true,
          describe: 'Internal HTTP server port',
          type: 'number',
        })
        .option('host', {
          alias: 'h',
          default: 'https://pipenet.dev',
          describe: 'Upstream server providing forwarding',
          type: 'string',
        })
        .option('subdomain', {
          alias: 's',
          describe: 'Request this subdomain',
          type: 'string',
        })
        .option('local-host', {
          alias: 'l',
          default: 'localhost',
          describe: 'Tunnel traffic to this host instead of localhost',
          type: 'string',
        })
        .option('local-https', {
          describe: 'Tunnel traffic to a local HTTPS server',
          type: 'boolean',
        })
        .option('local-cert', {
          describe: 'Path to certificate PEM file for local HTTPS server',
          type: 'string',
        })
        .option('local-key', {
          describe: 'Path to certificate key file for local HTTPS server',
          type: 'string',
        })
        .option('local-ca', {
          describe: 'Path to certificate authority file for self-signed certificates',
          type: 'string',
        })
        .option('allow-invalid-cert', {
          describe: 'Disable certificate checks for your local HTTPS server',
          type: 'boolean',
        })
        .option('print-requests', {
          describe: 'Print basic request info',
          type: 'boolean',
        })
        .option('headers', {
          describe: 'Custom headers to send with tunnel connection (JSON format)',
          type: 'string',
        });
    },
    (argv) => {
      runClient(argv as unknown as ClientOptions).catch((err) => {
        console.error(err);
        process.exit(1);
      });
    }
  )
  .command(
    'server',
    'Start a tunnel server',
    (yargs) => {
      return yargs
        .option('port', {
          alias: 'p',
          default: 3000,
          describe: 'Port for the server to listen on',
          type: 'number',
        })
        .option('domain', {
          alias: 'd',
          describe: 'Custom domain for the tunnel server',
          type: 'string',
        })
        .option('secure', {
          default: false,
          describe: 'Require HTTPS connections',
          type: 'boolean',
        })
        .option('landing', {
          describe: 'URL to redirect root requests to',
          type: 'string',
        })
        .option('max-sockets', {
          default: 10,
          describe: 'Maximum number of TCP sockets per client',
          type: 'number',
        });
    },
    (argv) => {
      runServer(argv as unknown as ServerOptions);
    }
  )
  .help('help')
  .version()
  .parse();

