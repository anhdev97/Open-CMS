export type RoleRow = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RoleJson = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

export function mapRole(row: {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
}): RoleRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function roleJson(r: RoleRow): RoleJson {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
