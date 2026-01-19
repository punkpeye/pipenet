import { Tunnel, TunnelOptions } from './Tunnel.js';

export type { TunnelOptions } from './Tunnel.js';
export type { TunnelClusterOptions, TunnelRequest } from './TunnelCluster.js';
export { Tunnel } from './Tunnel.js';
export { TunnelCluster } from './TunnelCluster.js';
export { HeaderHostTransformer } from './HeaderHostTransformer.js';

export type TunnelCallback = (err: Error | null, tunnel?: Tunnel) => void;

type OptionsWithPort = TunnelOptions & { port: number };

function pipenet(port: number): Promise<Tunnel>;
function pipenet(opts: OptionsWithPort): Promise<Tunnel>;
function pipenet(port: number, opts: TunnelOptions): Promise<Tunnel>;
function pipenet(opts: OptionsWithPort, callback: TunnelCallback): Tunnel;
function pipenet(port: number, opts: TunnelOptions, callback: TunnelCallback): Tunnel;
function pipenet(
  arg1: number | OptionsWithPort,
  arg2?: TunnelOptions | TunnelCallback,
  arg3?: TunnelCallback
): Tunnel | Promise<Tunnel> {
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

export default pipenet;

