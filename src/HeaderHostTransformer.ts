import { Transform, TransformCallback, TransformOptions } from 'stream';

export interface HeaderHostTransformerOptions extends TransformOptions {
  host?: string;
}

export class HeaderHostTransformer extends Transform {
  private host: string;
  private replaced: boolean;

  constructor(opts: HeaderHostTransformerOptions = {}) {
    super(opts);
    this.host = opts.host || 'localhost';
    this.replaced = false;
  }

  _transform(data: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    callback(
      null,
      this.replaced
        ? data
        : data.toString().replace(/(\r\n[Hh]ost: )\S+/, (match, $1: string) => {
            this.replaced = true;
            return $1 + this.host;
          })
    );
  }
}

