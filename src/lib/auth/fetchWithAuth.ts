"use client";

import type { User } from "firebase/auth";

/**
 * Fetch wrapper that:
 * - attaches Firebase ID token as Authorization: Bearer
 * - on 401, forces token refresh once and retries
 */
export async function fetchWithAuth(
  user: User,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = await user.getIdToken();
  headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(input, { ...init, headers });

  // If backend says unauthorized, refresh token once and retry.
  if (res.status === 401) {
    const fresh = await user.getIdToken(true);
    headers.set("Authorization", `Bearer ${fresh}`);
    res = await fetch(input, { ...init, headers });
  }

  return res;
}
