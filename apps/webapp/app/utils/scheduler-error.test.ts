/**
 * Tests for {@link toSchedulerErrorCause}: what a pg-boss `error` event keeps
 * before it is wrapped in a ShelfError and sent to Sentry.
 *
 * @see {@link file://./scheduler-error.ts}
 */
import { describe, expect, it } from "vitest";
import {
  connectionSecretsFrom,
  toSchedulerErrorCause,
} from "./scheduler-error";

/** A pg-pool idle-connection error: the failure plus the whole idle client */
function idleClientError() {
  return Object.assign(new Error("read ETIMEDOUT"), {
    errno: -110,
    code: "ETIMEDOUT",
    syscall: "read",
    client: {
      user: "postgres.project-ref",
      host: "pooler.example.com",
      port: 6543,
      connectionParameters: {
        user: "postgres.project-ref",
        database: "postgres",
        host: "pooler.example.com",
      },
    },
  });
}

describe("toSchedulerErrorCause", () => {
  it("drops the pg client and its connection parameters", () => {
    const safe = toSchedulerErrorCause(idleClientError());
    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain("postgres.project-ref");
    expect(serialized).not.toContain("pooler.example.com");
    expect(safe).not.toHaveProperty("client");
  });

  it("keeps what describes the failure", () => {
    const safe = toSchedulerErrorCause(idleClientError()) as Error &
      Record<string, unknown>;

    expect(safe).toBeInstanceOf(Error);
    expect(safe.message).toBe("read ETIMEDOUT");
    expect(safe.code).toBe("ETIMEDOUT");
    expect(safe.errno).toBe(-110);
    expect(safe.syscall).toBe("read");
    expect(safe.stack).toContain("read ETIMEDOUT");
  });

  it("keeps queue and worker from a spread worker error", () => {
    // pg-boss emits worker failures as a plain object spread from the Error.
    const error = idleClientError();
    const emitted = {
      ...error,
      message: error.message,
      stack: error.stack,
      queue: "assets-queue",
      worker: "worker-1",
    };

    const safe = toSchedulerErrorCause(emitted) as Record<string, unknown>;

    expect(safe.queue).toBe("assets-queue");
    expect(safe.worker).toBe("worker-1");
    expect(JSON.stringify(safe)).not.toContain("postgres.project-ref");
  });

  it("reduces each error of an AggregateError", () => {
    const aggregate = new AggregateError(
      [idleClientError(), idleClientError()],
      ""
    );

    const safe = toSchedulerErrorCause(aggregate) as { errors: unknown[] };

    expect(safe.errors).toHaveLength(2);
    expect(JSON.stringify(safe.errors)).not.toContain("pooler.example.com");
  });

  it("passes a non-object through unchanged", () => {
    expect(toSchedulerErrorCause("boom")).toBe("boom");
    expect(toSchedulerErrorCause(null)).toBeNull();
  });
});

describe("connection values in error text", () => {
  const secrets = connectionSecretsFrom(
    "postgres://postgres.project-ref:s3cret-pw@pooler.example.com:6543/postgres"
  );

  it("reads the user, password and host from the connection string", () => {
    expect(secrets).toEqual(
      expect.arrayContaining([
        "postgres.project-ref",
        "s3cret-pw",
        "pooler.example.com",
      ])
    );
  });

  it("removes the user from an authentication failure", () => {
    const error = new Error(
      'password authentication failed for user "postgres.project-ref"'
    );

    const safe = toSchedulerErrorCause(error, secrets) as Error;

    expect(safe.message).toBe(
      'password authentication failed for user "[redacted]"'
    );
    expect(safe.stack).not.toContain("postgres.project-ref");
  });

  it("removes the host from a DNS failure, nested ones included", () => {
    const aggregate = new AggregateError(
      [new Error("getaddrinfo ENOTFOUND pooler.example.com")],
      ""
    );

    const safe = toSchedulerErrorCause(aggregate, secrets);

    expect(JSON.stringify(safe)).not.toContain("pooler.example.com");
    expect((safe as { errors: Error[] }).errors[0].message).toBe(
      "getaddrinfo ENOTFOUND [redacted]"
    );
  });

  it("returns no values for an unreadable connection string", () => {
    expect(connectionSecretsFrom("not a url")).toEqual([]);
  });
});
