import { sql, type Kysely, type Migration } from 'kysely';

const now = sql`now()`;

export const oauth2_0002_roles: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .alterTable('auth_roles')
      .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
      .execute();
    await db.schema
      .alterTable('auth_roles')
      .addColumn('is_system', 'boolean', (c) => c.notNull().defaultTo(false))
      .execute();
    await db.schema
      .alterTable('auth_roles')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .execute();
    await db.schema
      .alterTable('auth_roles')
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .execute();

    // Old `name` is still the display label; `key` is the identifier.
    await sql`
      update auth_roles
      set description = name, is_system = true
      where key = 'super_admin'
    `.execute(db);

    await db.schema.alterTable('auth_roles').dropColumn('name').execute();
    await sql`alter table auth_roles rename column key to name`.execute(db);
  },

  async down(db: Kysely<any>) {
    await sql`alter table auth_roles rename column name to key`.execute(db);
    await db.schema
      .alterTable('auth_roles')
      .addColumn('name', 'text', (c) => c.notNull().defaultTo(''))
      .execute();
    await sql`update auth_roles set name = description`.execute(db);
    await db.schema.alterTable('auth_roles').dropColumn('description').execute();
    await db.schema.alterTable('auth_roles').dropColumn('is_system').execute();
    await db.schema.alterTable('auth_roles').dropColumn('created_at').execute();
    await db.schema.alterTable('auth_roles').dropColumn('updated_at').execute();
  },
};
