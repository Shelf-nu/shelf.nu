/**
 * Transaction helper for Supabase.
 *
 * Supabase JS client does not support multi-statement transactions natively.
 * For critical atomic operations, use Postgres RPC functions (see 009_rpc_functions.sql).
 *
 * This module provides:
 * 1. `rpc()` — typed wrapper around db.rpc() for calling Postgres functions
 * 2. `sequential()` — runs operations sequentially with manual rollback on failure
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@shelf/database";

type SupabaseDataClient = SupabaseClient<Database>;

type RpcFunctions = Database["public"]["Functions"];

/**
 * Typed RPC caller. Wraps db.rpc() with proper typing from the Database interface.
 *
 * Usage:
 *   const result = await rpc(db, 'function_name', { arg1: 'value' });
 */
export async function rpc<F extends keyof RpcFunctions>(
  db: SupabaseDataClient,
  fn: F,
  args: RpcFunctions[F]["Args"]
): Promise<RpcFunctions[F]["Returns"]> {
  const result = await db.rpc(fn as string, args as any);
  if (result.error) {
    throw result.error;
  }
  return result.data as RpcFunctions[F]["Returns"];
}

/**
 * Runs a sequence of async operations. If any step fails, calls the
 * provided rollback functions for all previously completed steps (in reverse order).
 *
 * This is NOT a true database transaction — it's best-effort compensation.
 * For true atomicity, use Postgres RPC functions instead.
 *
 * Usage:
 *   await sequential([
 *     {
 *       execute: () => db.from('Asset').update(...),
 *       rollback: () => db.from('Asset').update(/* revert * /),
 *     },
 *     {
 *       execute: () => db.from('Custody').insert(...),
 *       rollback: (result) => db.from('Custody').delete().eq('id', result.id),
 *     },
 *   ]);
 */
export async function sequential<T extends any[]>(steps: {
  [K in keyof T]: {
    execute: () => Promise<T[K]>;
    rollback?: (result: T[K]) => Promise<void>;
  };
}): Promise<T> {
  const results: any[] = [];
  const completedRollbacks: Array<() => Promise<void>> = [];

  for (const step of steps) {
    try {
      const result = await step.execute();
      results.push(result);
      if (step.rollback) {
        // Capture rollback with the result for later use
        const rollbackFn = step.rollback;
        const capturedResult = result;
        completedRollbacks.push(() => rollbackFn(capturedResult));
      }
    } catch (error) {
      // Attempt to rollback completed steps in reverse order
      for (let i = completedRollbacks.length - 1; i >= 0; i--) {
        try {
          await completedRollbacks[i]();
        } catch {
          // Best effort — log but don't mask the original error
          console.error(`Rollback step ${i} failed during compensation`);
        }
      }
      throw error;
    }
  }

  return results as T;
}
