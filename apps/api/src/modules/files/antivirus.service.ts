import { Inject, Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { connect } from 'node:net';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';

export type ScanResult =
  { status: 'clean' } | { status: 'infected'; signature: string } | { status: 'skipped' };

export class ScanUnavailableError extends Error {}

/**
 * Cliente do clamd (ClamAV) pelo protocolo INSTREAM: o arquivo é enviado em blocos
 * pela rede e o antivírus responde "OK" ou o nome da ameaça encontrada.
 */
@Injectable()
export class AntivirusService {
  private readonly logger = new Logger(AntivirusService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return !!this.config.CLAMAV_HOST;
  }

  async scanFile(path: string): Promise<ScanResult> {
    if (!this.enabled) return { status: 'skipped' };
    try {
      const reply = await this.instream(path);
      if (reply.endsWith('OK')) return { status: 'clean' };
      const m = /: (.+) FOUND$/.exec(reply);
      if (m) return { status: 'infected', signature: m[1]! };
      throw new Error(`Resposta inesperada do antivírus: ${reply}`);
    } catch (err) {
      this.logger.warn(`Antivírus indisponível: ${String(err)}`);
      if (this.config.CLAMAV_REQUIRED) throw new ScanUnavailableError(String(err));
      return { status: 'skipped' };
    }
  }

  private instream(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.config.CLAMAV_HOST!, port: this.config.CLAMAV_PORT });
      const chunks: Buffer[] = [];
      socket.setTimeout(60_000, () => socket.destroy(new Error('tempo esgotado')));
      socket.on('error', reject);
      socket.on('data', (d) => chunks.push(d));
      socket.on('end', () =>
        resolve(Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim()),
      );
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const file = createReadStream(path, { highWaterMark: 64 * 1024 });
        file.on('error', (e) => socket.destroy(e));
        file.on('data', (chunk) => {
          const buf = chunk as Buffer;
          const size = Buffer.alloc(4);
          size.writeUInt32BE(buf.length);
          if (!socket.write(Buffer.concat([size, buf]))) {
            file.pause();
            socket.once('drain', () => file.resume());
          }
        });
        file.on('end', () => socket.write(Buffer.alloc(4)));
      });
    });
  }
}
