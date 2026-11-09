import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import type { Database } from '../../database/database.js';
import { systemSettings } from '../../database/schema/index.js';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Chaves VAPID da instalação. São geradas na primeira vez e guardadas no banco, para
 * que API e worker usem as mesmas e as inscrições dos navegadores sobrevivam a
 * atualizações. Trocar as chaves invalida todas as inscrições.
 */
export async function loadVapidKeys(db: Database): Promise<VapidKeys> {
  const read = async () => {
    const [row] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'vapid'))
      .limit(1);
    return row?.value as VapidKeys | undefined;
  };
  const existing = await read();
  if (existing) return existing;
  const generated = webpush.generateVAPIDKeys();
  // Duas instâncias subindo juntas: só a primeira grava; as duas leem a mesma.
  await db.insert(systemSettings).values({ key: 'vapid', value: generated }).onConflictDoNothing();
  return (await read())!;
}
