# pipenet

Expose your local server to the public internet instantly

## Installation

```bash
npm install pipenet
# or
pnpm add pipenet
```

## CLI Usage

```bash
# Expose local port 3000 to the internet
npx pipenet client --port 3000

# Request a specific subdomain
npx pipenet client --port 3000 --subdomain myapp

# Use a custom tunnel server
npx pipenet client --port 3000 --host https://your-tunnel-server.com
```

## API

The pipenet client is also usable through an API (for test integration, automation, etc)

### pipenet(port [,options][,callback])

Creates a new pipenet tunnel to the specified local `port`. Will return a Promise that resolves once you have been assigned a public tunnel url. `options` can be used to request a specific `subdomain`. A `callback` function can be passed, in which case it won't return a Promise. This exists for backwards compatibility with the old Node-style callback API. You may also pass a single options object with `port` as a property.

```js
import { pipenet } from 'pipenet';

const tunnel = await pipenet({
  port: 3000,
  host: 'https://pipenet.dev'
});

// the assigned public url for your tunnel
// i.e. https://abcdefgjhij.pipenet.dev
tunnel.url;

tunnel.on('close', () => {
  // tunnels are closed
});
```

#### options

- `port` (number) [required] The local port number to expose through pipenet.
- `host` (string) URL for the upstream proxy server. Defaults to `https://pipenet.dev`.
- `subdomain` (string) Request a specific subdomain on the proxy server. **Note** You may not actually receive this name depending on availability.
- `localHost` (string) Proxy to this hostname instead of `localhost`. This will also cause the `Host` header to be re-written to this value in proxied requests.
- `localHttps` (boolean) Enable tunneling to local HTTPS server.
- `localCert` (string) Path to certificate PEM file for local HTTPS server.
- `localKey` (string) Path to certificate key file for local HTTPS server.
- `localCa` (string) Path to certificate authority file for self-signed certificates.
- `allowInvalidCert` (boolean) Disable certificate checks for your local HTTPS server (ignore cert/key/ca options).

Refer to [tls.createSecureContext](https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options) for details on the certificate options.

### Tunnel

The `tunnel` instance returned to your callback emits the following events

| event   | args | description                                                                          |
| ------- | ---- | ------------------------------------------------------------------------------------ |
| request | info | fires when a request is processed by the tunnel, contains _method_ and _path_ fields |
| error   | err  | fires when an error happens on the tunnel                                            |
| close   |      | fires when the tunnel has closed                                                     |

The `tunnel` instance has the following methods

| method | args | description      |
| ------ | ---- | ---------------- |
| close  |      | close the tunnel |

## Server

This package includes both the client and server components. You can run your own pipenet server.

### Running the Server

```bash
# Using the CLI
npx pipenet server --port 3000

# With a custom domain
npx pipenet server --port 3000 --domains tunnel.example.com

# With multiple domains
npx pipenet server --port 3000 --domains tunnel.example.com --domains tunnel.example.org

# Or programmatically
```

```js
import { createServer } from 'pipenet/server';

const server = createServer({
  domains: ['tunnel.example.com'],  // Optional: custom domain(s)
  secure: false,                     // Optional: require HTTPS
  landing: 'https://pipenet.dev',    // Optional: landing page URL
  maxTcpSockets: 10,                 // Optional: max sockets per client
});

server.listen(3000, () => {
  console.log('pipenet server listening on port 3000');
});
```

### Server Options

- `domains` (string[]) Custom domain(s) for the tunnel server.
- `secure` (boolean) Require HTTPS connections
- `landing` (string) URL to redirect root requests to
- `maxTcpSockets` (number) Maximum number of TCP sockets per client (default: 10)

### Server API Endpoints

- `GET /api/status` - Server status and tunnel count
- `GET /api/tunnels/:id/status` - Status of a specific tunnel
- `GET /:id` - Request a new tunnel with the specified ID

## Acknowledgments

pipenet is based on [localtunnel](https://github.com/localtunnel/localtunnel).

Development of pipenet is sponsored by [glama.ai](https://glama.ai).
