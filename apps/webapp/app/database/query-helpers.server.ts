/**
 * Query helpers that map Prisma-style operations to Supabase PostgREST queries.
 *
 * These helpers provide a thin abstraction so module services can be converted
 * from Prisma with minimal diff while using the Supabase JS client underneath.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@shelf/database";

type TableName = keyof Database["public"]["Tables"];
type SupabaseDataClient = SupabaseClient<Database>;

/**
 * Throws a structured error when a Supabase query returns an error.
 */
function throwIfError<T>(
  result: { data: T; error: null } | { data: null; error: any }
): T {
  if (result.error) {
    throw result.error;
  }
  return result.data as T;
}

/**
 * Like throwIfError but also throws if no rows returned (equivalent to findFirstOrThrow).
 */
function throwIfNotFound<T>(
  result: { data: T | null; error: null } | { data: null; error: any }
): T {
  if (result.error) {
    throw result.error;
  }
  if (result.data === null) {
    throw { code: "PGRST116", message: "No rows found" };
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// applyFilters — converts a flat where object to Supabase filter chains
// ---------------------------------------------------------------------------

type FilterValue =
  | string
  | number
  | boolean
  | null
  | { contains: string; mode?: "insensitive" | "default" }
  | { equals: string; mode?: "insensitive" | "default" }
  | { in: (string | number)[] }
  | { notIn: (string | number)[] }
  | { not: string | number | boolean | null }
  | { gte: string | number }
  | { lte: string | number }
  | { gt: string | number }
  | { lt: string | number }
  | { startsWith: string; mode?: "insensitive" | "default" }
  | { endsWith: string; mode?: "insensitive" | "default" };

type WhereClause = {
  OR?: WhereClause[];
  AND?: WhereClause[];
  NOT?: WhereClause;
  [key: string]: FilterValue | WhereClause[] | WhereClause | undefined;
};

/**
 * Applies a Prisma-style where clause to a Supabase query builder.
 */
function applyFilters<
  Q extends {
    eq: Function;
    ilike: Function;
    in: Function;
    neq: Function;
    gte: Function;
    lte: Function;
    gt: Function;
    lt: Function;
    is: Function;
    or: Function;
    not: Function;
    filter: Function;
  },
>(query: Q, where: WhereClause | undefined): Q {
  if (!where) return query;

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;

    // Handle OR
    if (key === "OR" && Array.isArray(value)) {
      const orParts = (value as WhereClause[]).map((clause) => {
        return buildFilterString(clause);
      });
      query = query.or(orParts.join(",")) as Q;
      continue;
    }

    // Handle AND (just apply each clause sequentially)
    if (key === "AND" && Array.isArray(value)) {
      for (const clause of value as WhereClause[]) {
        query = applyFilters(query, clause);
      }
      continue;
    }

    // Handle NOT
    if (key === "NOT" && typeof value === "object" && !Array.isArray(value)) {
      const notClause = value as WhereClause;
      for (const [nk, nv] of Object.entries(notClause)) {
        if (nv === null) {
          query = query.not(nk, "is", null) as Q;
        } else if (
          typeof nv === "string" ||
          typeof nv === "number" ||
          typeof nv === "boolean"
        ) {
          query = query.neq(nk, nv) as Q;
        }
      }
      continue;
    }

    // Simple equality (string, number, boolean)
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      query = query.eq(key, value) as Q;
      continue;
    }

    // Null check
    if (value === null) {
      query = query.is(key, null) as Q;
      continue;
    }

    // Object operators
    if (typeof value === "object" && !Array.isArray(value)) {
      const op = value as Record<string, any>;

      if ("contains" in op) {
        const pattern = `%${op.contains}%`;
        query = (
          op.mode === "insensitive"
            ? query.ilike(key, pattern)
            : query.like(key, pattern)
        ) as Q;
      } else if ("equals" in op) {
        if (op.mode === "insensitive") {
          query = query.ilike(key, op.equals) as Q;
        } else {
          query = query.eq(key, op.equals) as Q;
        }
      } else if ("in" in op) {
        query = query.in(key, op.in) as Q;
      } else if ("notIn" in op) {
        // Supabase doesn't have notIn, use not.in
        query = query.not(key, "in", `(${op.notIn.join(",")})`) as Q;
      } else if ("not" in op) {
        if (op.not === null) {
          query = query.not(key, "is", null) as Q;
        } else {
          query = query.neq(key, op.not) as Q;
        }
      } else if ("gte" in op) {
        query = query.gte(key, op.gte) as Q;
      } else if ("lte" in op) {
        query = query.lte(key, op.lte) as Q;
      } else if ("gt" in op) {
        query = query.gt(key, op.gt) as Q;
      } else if ("lt" in op) {
        query = query.lt(key, op.lt) as Q;
      } else if ("startsWith" in op) {
        const pattern = `${op.startsWith}%`;
        query = (
          op.mode === "insensitive"
            ? query.ilike(key, pattern)
            : query.like(key, pattern)
        ) as Q;
      } else if ("endsWith" in op) {
        const pattern = `%${op.endsWith}`;
        query = (
          op.mode === "insensitive"
            ? query.ilike(key, pattern)
            : query.like(key, pattern)
        ) as Q;
      }
    }
  }

  return query;
}

/**
 * Builds a PostgREST filter string from a where clause (for use in `.or()`).
 */
function buildFilterString(clause: WhereClause): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(clause)) {
    if (value === undefined) continue;

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      parts.push(`${key}.eq.${value}`);
    } else if (value === null) {
      parts.push(`${key}.is.null`);
    } else if (typeof value === "object" && !Array.isArray(value)) {
      const op = value as Record<string, any>;
      if ("contains" in op) {
        parts.push(
          op.mode === "insensitive"
            ? `${key}.ilike.%${op.contains}%`
            : `${key}.like.%${op.contains}%`
        );
      } else if ("equals" in op) {
        parts.push(
          op.mode === "insensitive"
            ? `${key}.ilike.${op.equals}`
            : `${key}.eq.${op.equals}`
        );
      } else if ("in" in op) {
        parts.push(`${key}.in.(${op.in.join(",")})`);
      } else if ("gte" in op) {
        parts.push(`${key}.gte.${op.gte}`);
      } else if ("lte" in op) {
        parts.push(`${key}.lte.${op.lte}`);
      } else if ("gt" in op) {
        parts.push(`${key}.gt.${op.gt}`);
      } else if ("lt" in op) {
        parts.push(`${key}.lt.${op.lt}`);
      }
    }
  }

  return parts.join(",");
}

// ---------------------------------------------------------------------------
// applyOrderBy — converts Prisma orderBy to Supabase .order()
// ---------------------------------------------------------------------------

type OrderByClause =
  | Record<string, "asc" | "desc">
  | Record<string, "asc" | "desc">[];

function applyOrderBy<Q extends { order: Function }>(
  query: Q,
  orderBy: OrderByClause | undefined
): Q {
  if (!orderBy) return query;

  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  for (const clause of clauses) {
    for (const [column, direction] of Object.entries(clause)) {
      query = query.order(column, { ascending: direction === "asc" }) as Q;
    }
  }
  return query;
}

// ---------------------------------------------------------------------------
// Public query helpers
// ---------------------------------------------------------------------------

/**
 * findMany — equivalent to db.model.findMany({ where, orderBy, skip, take, select })
 */
export async function findMany<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  options?: {
    where?: WhereClause;
    orderBy?: OrderByClause;
    skip?: number;
    take?: number;
    select?: string;
  }
): Promise<Database["public"]["Tables"][T]["Row"][]> {
  const { where, orderBy, skip, take, select = "*" } = options || {};

  let query = db.from(table).select(select);
  query = applyFilters(query, where);
  query = applyOrderBy(query, orderBy);

  if (skip !== undefined && take !== undefined) {
    query = query.range(skip, skip + take - 1);
  } else if (take !== undefined) {
    query = query.limit(take);
  }

  return throwIfError(await query) as any;
}

/**
 * findFirst — equivalent to db.model.findFirst({ where, select })
 * Returns null if not found.
 */
export async function findFirst<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  options?: {
    where?: WhereClause;
    orderBy?: OrderByClause;
    select?: string;
  }
): Promise<Database["public"]["Tables"][T]["Row"] | null> {
  const { where, orderBy, select = "*" } = options || {};

  let query = db.from(table).select(select);
  query = applyFilters(query, where);
  query = applyOrderBy(query, orderBy);
  query = query.limit(1).maybeSingle();

  const result = await query;
  if (result.error) throw result.error;
  return result.data as any;
}

/**
 * findFirstOrThrow — like findFirst but throws if no row found.
 */
export async function findFirstOrThrow<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  options?: {
    where?: WhereClause;
    orderBy?: OrderByClause;
    select?: string;
  }
): Promise<Database["public"]["Tables"][T]["Row"]> {
  const result = await findFirst(db, table, options);
  if (result === null) {
    throw { code: "PGRST116", message: `No rows found in ${table}` };
  }
  return result;
}

/**
 * findUnique — equivalent to db.model.findUnique({ where: { id } })
 * Uses .single() which errors if not exactly one row.
 */
export async function findUnique<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  options: {
    where: WhereClause;
    select?: string;
  }
): Promise<Database["public"]["Tables"][T]["Row"] | null> {
  const { where, select: sel = "*" } = options;

  let query = db.from(table).select(sel);
  query = applyFilters(query, where);
  query = query.maybeSingle();

  const result = await query;
  if (result.error) throw result.error;
  return result.data as any;
}

/**
 * findUniqueOrThrow — like findUnique but throws if not found.
 */
export async function findUniqueOrThrow<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  options: {
    where: WhereClause;
    select?: string;
  }
): Promise<Database["public"]["Tables"][T]["Row"]> {
  const { where, select: sel = "*" } = options;

  let query = db.from(table).select(sel);
  query = applyFilters(query, where);
  query = query.single();

  return throwIfNotFound(await query) as any;
}

/**
 * create — equivalent to db.model.create({ data })
 */
export async function create<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  data: Database["public"]["Tables"][T]["Insert"],
  options?: { select?: string }
): Promise<Database["public"]["Tables"][T]["Row"]> {
  const select = options?.select || "*";
  const result = await db
    .from(table)
    .insert(data as any)
    .select(select)
    .single();
  return throwIfNotFound(result) as any;
}

/**
 * createMany — equivalent to db.model.createMany({ data: [...] })
 */
export async function createMany<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  data: Database["public"]["Tables"][T]["Insert"][]
): Promise<Database["public"]["Tables"][T]["Row"][]> {
  const result = await db
    .from(table)
    .insert(data as any[])
    .select("*");
  return throwIfError(result) as any;
}

/**
 * update — equivalent to db.model.update({ where, data })
 * Returns the updated row.
 */
export async function update<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  options: {
    where: WhereClause;
    data: Database["public"]["Tables"][T]["Update"];
    select?: string;
  }
): Promise<Database["public"]["Tables"][T]["Row"]> {
  const { where, data, select: sel = "*" } = options;

  let query = db
    .from(table)
    .update(data as any)
    .select(sel);
  query = applyFilters(query, where);
  query = query.single();

  return throwIfNotFound(await query) as any;
}

/**
 * updateMany — equivalent to db.model.updateMany({ where, data })
 * Returns all updated rows.
 */
export async function updateMany<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  options: {
    where: WhereClause;
    data: Database["public"]["Tables"][T]["Update"];
  }
): Promise<Database["public"]["Tables"][T]["Row"][]> {
  const { where, data } = options;

  let query = db
    .from(table)
    .update(data as any)
    .select("*");
  query = applyFilters(query, where);

  return throwIfError(await query) as any;
}

/**
 * remove — equivalent to db.model.delete({ where })
 */
export async function remove<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  where: WhereClause
): Promise<Database["public"]["Tables"][T]["Row"][]> {
  let query = db.from(table).delete().select("*");
  query = applyFilters(query, where);
  return throwIfError(await query) as any;
}

/**
 * deleteMany — equivalent to db.model.deleteMany({ where })
 * Returns count of deleted rows.
 */
export async function deleteMany<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  where: WhereClause
): Promise<{ count: number }> {
  let query = db.from(table).delete({ count: "exact" });
  query = applyFilters(query, where);
  const result = await query;
  if (result.error) throw result.error;
  return { count: result.count ?? 0 };
}

/**
 * upsert — equivalent to db.model.upsert({ where, create, update })
 */
export async function upsert<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  data: Database["public"]["Tables"][T]["Insert"],
  options?: {
    onConflict?: string;
    select?: string;
  }
): Promise<Database["public"]["Tables"][T]["Row"]> {
  const { onConflict, select: sel = "*" } = options || {};

  const result = await db
    .from(table)
    .upsert(data as any, { onConflict })
    .select(sel)
    .single();

  return throwIfNotFound(result) as any;
}

/**
 * count — equivalent to db.model.count({ where })
 */
export async function count<T extends TableName>(
  db: SupabaseDataClient,
  table: T,
  where?: WhereClause
): Promise<number> {
  let query = db.from(table).select("*", { count: "exact", head: true });
  query = applyFilters(query, where);
  const result = await query;
  if (result.error) throw result.error;
  return result.count ?? 0;
}

export {
  applyFilters,
  applyOrderBy,
  throwIfError,
  throwIfNotFound,
  type WhereClause,
  type OrderByClause,
  type TableName,
};
