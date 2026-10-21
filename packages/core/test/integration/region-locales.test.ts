import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coreMigrations } from '@opencms/db';
import { startTestDb } from '../../../oauth2/test/support/db';

describe('core migration 0002_region_locales', () => {
  let stop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof startTestDb>>['db'];

  beforeAll(async () => {
    const t = await startTestDb();
    db = t.db;
    stop = t.stop;
  }, 60_000);
  afterAll(async () => {
    await stop?.();
  });

  it('renames short codes to region codes and leaves colliding rows alone', async () => {
    await sql`create table ct_x_l10n (entry_id uuid not null, locale varchar(16) not null, status varchar(16) not null, title text, primary key (entry_id, locale))`.execute(db);
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    await sql`insert into ct_x_l10n (entry_id, locale, status, title) values
      (${a}, 'en', 'draft', 'a-en'), (${a}, 'vi', 'draft', 'a-vi'),
      (${b}, 'en', 'draft', 'b-en'), (${b}, 'en-US', 'draft', 'b-en-US'),
      (${c}, 'fr', 'draft', 'c-fr'), (${c}, 'id', 'draft', 'c-id')`.execute(db);
    await coreMigrations['0002_region_locales'].up(db);
    const rows = await sql<{ entry_id: string; locale: string; title: string }>`select entry_id, locale, title from ct_x_l10n`.execute(db);
    const got = Object.fromEntries(rows.rows.map((r) => [r.title, r.locale]));
    expect(got).toEqual({
      'a-en': 'en-US',
      'a-vi': 'vi-VN',
      'b-en': 'en',
      'b-en-US': 'en-US',
      'c-fr': 'fr-FR',
      'c-id': 'id-ID',
    });
  });
});
