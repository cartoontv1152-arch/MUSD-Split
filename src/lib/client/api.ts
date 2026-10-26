"use client";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? "HTTP_" + res.status, err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const post = <T,>(path: string, json: unknown = {}) => api<T>(path, { method: "POST", json });
export const patch = <T,>(path: string, json: unknown = {}) => api<T>(path, { method: "PATCH", json });
export const del = <T,>(path: string, json?: unknown) => api<T>(path, { method: "DELETE", json });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  const err = e as { shortMessage?: string; message?: string; name?: string };
  if (err?.name === "UserRejectedRequestError" || /user (rejected|denied)/i.test(err?.message ?? "")) {
    return "You cancelled the request in your wallet.";
  }
  return err?.shortMessage ?? err?.message?.split("\n")[0] ?? "Something went wrong";
}

export function isUserRejection(e: unknown): boolean {
  const err = e as { name?: string; message?: string; cause?: { name?: string; code?: number }; code?: number };
  return (
    err?.name === "UserRejectedRequestError" ||
    err?.cause?.name === "UserRejectedRequestError" ||
    err?.code === 4001 ||
    err?.cause?.code === 4001 ||
    /user (rejected|denied)|rejected the request|request rejected/i.test(err?.message ?? "")
  );
}
