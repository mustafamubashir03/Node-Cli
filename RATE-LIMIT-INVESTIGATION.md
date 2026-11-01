# Figma API 429 Root Cause Investigation Report

## Confirmed Root Cause

The Figma API returns 429 because the user is on a **Starter plan** with a **monthly** (not per-minute) rate limit of **20 Tier 1 requests per month**. The `Retry-After: 306110` (~3.5 days) indicates the time until the monthly quota window resets.

This is NOT a temporary rate limit or a per-minute throttle. It is a **monthly quota exhaustion**.

## Official Figma Documentation

Source: https://developers.figma.com/docs/rest-api/rate-limits/

Key findings:
1. "If you use a personal access token to get the content of a file in a Starter plan, requests to that file are limited to up to 6 per month even if you have a Full seat in a different plan."
2. Tier 1 endpoints (GET file, GET file nodes, GET image) on Starter plan: "Up to 20/month" (not per minute).
3. "Rate limits are per-minute unless otherwise specified" — the "Up to 20/month" is explicitly per month.
4. The X-Figma-Rate-Limit-Type header indicates "low" for Starter plan users.
5. The X-Figma-Plan-Tier header indicates "starter".
6. Figma provides an X-Figma-Upgrade-Link header for upgrade guidance.

## Exact API Requests Consumed

Per `/figma-to-code` run (from `src/commands/figma-to-code.ts`):

1. `GET /v1/files/:key` — via `getFileStructure()` → `getFile()` (Tier 1, for page/frame discovery)
2. `GET /v1/files/:key/nodes?ids=1:2` — via `getDesignContext()` → `getFileNodes()` (Tier 1, for design context)
3. `GET /v1/images/:key?ids=...&format=png` — via `downloadFigmaAssets()` → `getImages()` (Tier 1, for renders)

Total: ~3 Tier 1 requests per run. On a Starter plan with 20/month, this allows ~6 runs before exhaustion.

## Current Cache Coverage and Gaps

**Cache implementation** (`src/figma/cache.ts`):
- TTL-based in-memory/file cache with SHA-256 hashed keys
- `get<T>(key)` and `set<T>(key, data, ttlMs, version)` methods
- `getWithVersion<T>(key, version)` for version-aware retrieval
- `invalidate(key)` and `clear()` methods

**Gaps:**
1. Cache is NOT used by `getDesignContext()` — it calls `getFileNodes()` directly without checking cache
2. Cache is NOT used by `getFileStructure()` — it calls `getFile()` directly without checking cache
3. The `useCache` flag defaults to `true` but the cache instance is created in `FigmaClient` constructor and passed to `FigmaRestClient`
4. No persistence of raw responses under `.node-cli/figma/<key>/1-2/raw/`
5. No version-based cache invalidation — the cache uses TTL, not Figma's `lastModified`/`version`
6. No offline mode — when rate-limited, the CLI throws instead of using cached data

## Whether Waiting Will Restore Access

**No.** The 306110-second Retry-After (~3.5 days) represents a **monthly quota reset**, not a temporary throttle. Waiting the specified time will NOT restore access because:
- The Starter plan limit is "Up to 20/month" (monthly window)
- The Retry-After value is the time until the monthly window resets
- Even after waiting, the user would only get 20 more requests for the next month

## Cheapest Practical Solution (No Upgrade)

1. **Minimize API calls**: Reduce from 3 calls/run to 1 call/run by:
   - Using `GET /v1/files/:key/nodes?ids=1:2&depth=` once (full depth) instead of separate `getFile` + `getFileNodes`
   - Skipping `getImages` for renders (use cached/placeholder instead)
   - Skipping `getFileStructure` (use the node ID from URL directly)

2. **Persistent raw cache**: Save every response to `.node-cli/figma/<key>/1-2/raw/` keyed by endpoint and version. Reuse when version matches.

3. **Offline mode**: When rate-limited and a cached package exists, continue using cached data with a clear message.

4. **Batch exports**: Use `GET /v1/images/:key?ids=id1,id2,...&format=svg` to batch ~50 ids per call instead of individual calls.

## Minimal Implementation Changes Required

1. **rest-client.ts**: Add `cacheKeyFromEndpoint` (already done), add version-aware caching, add request counting (already done)
2. **figma-to-code.ts**: Reduce API calls — fetch tree once, skip structure discovery when node ID is provided
3. **cache.ts**: Add version-aware get/set (already done), add persistent raw storage
4. **Offline mode**: Add fallback to cached package when rate-limited
5. **Tests**: Mock server tests for 429 handling, cache reuse, version-based refetch

## Current Status

- Rate limit UX: IMPLEMENTED (reads headers, prints message, handles >120s)
- Cache: PARTIALLY IMPLEMENTED (version-aware methods exist but not wired into fetch)
- Offline mode: NOT IMPLEMENTED
- Request reduction: NOT IMPLEMENTED (still makes 3+ calls per run)
- Raw persistence: NOT IMPLEMENTED

## Recommendation

The fundamental issue is that the user is on a **Starter plan** with a **monthly limit of 20 Tier 1 requests**. Even with optimal caching, the first run will consume 3 requests. Subsequent runs can reuse cached data if the Figma file version hasn't changed.

The cheapest solution is:
1. Implement persistent raw caching (saves responses to disk)
2. Reduce to 1 API call per run (fetch tree once at full depth)
3. Implement offline mode (use cached package when rate-limited)
4. Batch image exports

This would allow ~6-7 runs per month on a Starter plan, which is the maximum possible without upgrading.