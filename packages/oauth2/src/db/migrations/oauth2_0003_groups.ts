import { sql, type Kysely, type Migration } from 'kysely';

/**
 * Permission groups (spec B §3.2): roles become groups carrying a set of permissions (`roles`).
 * Existing user links are kept, so every existing user ends up in `super-admin`.
 */
export const oauth2_0003_groups: Migration = {
  async up(db: Kysely<any>) {
    await sql`alter table auth_roles rename to auth_groups`.execute(db);
    await sql`alter table auth_groups rename constraint auth_roles_pkey to auth_groups_pkey`.execute(db);
    await sql`alter table auth_groups rename constraint auth_roles_key_key to auth_groups_key_key`.execute(db);
    await sql`alter table auth_groups
      add column roles text[] not null default '{}',
      add column system boolean not null default false,
      add column updated_at timestamptz`.execute(db);

    await sql`alter table auth_user_roles rename to auth_user_groups`.execute(db);
    await sql`alter table auth_user_groups rename column role_id to group_id`.execute(db);
    await sql`alter table auth_user_groups rename constraint auth_user_roles_pk to auth_user_groups_pk`.execute(db);
    await sql`alter table auth_user_groups rename constraint auth_user_roles_user_id_fkey to auth_user_groups_user_id_fkey`.execute(db);
    await sql`alter table auth_user_groups rename constraint auth_user_roles_role_id_fkey to auth_user_groups_group_id_fkey`.execute(db);

    await sql`update auth_groups set key = 'super-admin', system = true, roles = '{}' where key = 'super_admin'`.execute(db);
    await sql`alter table auth_groups add constraint auth_groups_key_ck check (key ~ '^[a-z][a-z0-9-]{0,63}$')`.execute(db);
    // Stored sorted (spec B §3.3).
    await sql`insert into auth_groups (key, name, roles, system) values
      ('contenter', 'Contenter', ${sql.raw(`'{content.create,content.delete,content.read,content.submit,content.update}'`)}, false),
      ('reviewer', 'Reviewer', ${sql.raw(`'{content.publish,content.read,content.update}'`)}, false)`.execute(db);
  },

  async down(db: Kysely<any>) {
    await sql`delete from auth_user_groups where group_id in (select id from auth_groups where key in ('contenter', 'reviewer'))`.execute(db);
    await sql`delete from auth_groups where key in ('contenter', 'reviewer')`.execute(db);
    await sql`alter table auth_groups drop constraint auth_groups_key_ck`.execute(db);
    await sql`update auth_groups set key = 'super_admin' where key = 'super-admin'`.execute(db);

    await sql`alter table auth_user_groups rename constraint auth_user_groups_group_id_fkey to auth_user_roles_role_id_fkey`.execute(db);
    await sql`alter table auth_user_groups rename constraint auth_user_groups_user_id_fkey to auth_user_roles_user_id_fkey`.execute(db);
    await sql`alter table auth_user_groups rename constraint auth_user_groups_pk to auth_user_roles_pk`.execute(db);
    await sql`alter table auth_user_groups rename column group_id to role_id`.execute(db);
    await sql`alter table auth_user_groups rename to auth_user_roles`.execute(db);

    await sql`alter table auth_groups drop column roles, drop column system, drop column updated_at`.execute(db);
    await sql`alter table auth_groups rename constraint auth_groups_key_key to auth_roles_key_key`.execute(db);
    await sql`alter table auth_groups rename constraint auth_groups_pkey to auth_roles_pkey`.execute(db);
    await sql`alter table auth_groups rename to auth_roles`.execute(db);
  },
};
