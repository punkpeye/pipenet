import { Tunnel, TunnelOptions } from './Tunnel.js';

export { HeaderHostTransformer } from './HeaderHostTransformer.js';
export type { TunnelOptions } from './Tunnel.js';
export { Tunnel } from './Tunnel.js';
export type { TunnelClusterOptions, TunnelRequest } from './TunnelCluster.js';
export { TunnelCluster } from './TunnelCluster.js';

export type TunnelCallback = (err: Error | null, tunnel?: Tunnel) => void;

type OptionsWithPort = { port: number } & TunnelOptions;

function pipenet(port: number): Promise<Tunnel>;
function pipenet(opts: OptionsWithPort): Promise<Tunnel>;
function pipenet(port: number, opts: TunnelOptions): Promise<Tunnel>;
function pipenet(opts: OptionsWithPort, callback: TunnelCallback): Tunnel;
function pipenet(port: number, opts: TunnelOptions, callback: TunnelCallback): Tunnel;
function pipenet(
  arg1: number | OptionsWithPort,
  arg2?: TunnelCallback | TunnelOptions,
  arg3?: TunnelCallback
): Promise<Tunnel> | Tunnel {
  const options: TunnelOptions =
    typeof arg1 === 'object' ? arg1 : { ...(arg2 as TunnelOptions), port: arg1 };
  const callback = typeof arg1 === 'object' ? (arg2 as TunnelCallback) : arg3;
  const client = new Tunnel(options);

  if (callback) {
    client.open((err) => (err ? callback(err) : callback(null, client)));
    return client;
  }

  return new Promise((resolve, reject) =>
    client.open((err) => (err ? reject(err) : resolve(client)))
  );
}

export { pipenet };

