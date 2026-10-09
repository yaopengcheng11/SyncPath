// apps/web/src/services/api.ts
//
// Thin browser-side wrapper around the SyncPath HTTP API.
//
// The cookie is HttpOnly + SameSite=Lax and Same-Origin (vite proxies
// /api → Fastify in dev, the same-site reverse proxy does the same in
// production) so we never have to handle the token in JS — credentials:
// 'include' on every fetch is enough.

import { ApiClient } from '@syncpath/api-client';

export const apiClient = new ApiClient({
  baseUrl: '/api/v1',
  credentials: 'include'
});

export { ApiError } from '@syncpath/api-client';
