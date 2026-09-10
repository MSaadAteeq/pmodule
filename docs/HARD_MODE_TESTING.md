# Hard Mode Reliability Testing

This project now includes a strict reliability gate for backend interview-critical flows.

## Run

From repo root:

```bash
npm run test:hard-mode
```

Custom sizing / thresholds:

```bash
PARAKEET_LOAD_USERS=25 PARAKEET_LOAD_RECORDS=8 PARAKEET_SOAK_WORKERS=10 PARAKEET_SOAK_MS=60000 npm run test:hard-mode
```

The script will:

1. Start the cloud backend (`backend/server.js`)
2. Run negative API tests (invalid auth/input)
3. Run concurrent load tests (parallel signup/session/usage/record)
4. Run a short soak phase (continuous request traffic)
5. Print JSON report + strict pass/fail checks

Optional chaos mode (fault injection in backend):

- `PARAKEET_CHAOS=1`
- `PARAKEET_CHAOS_ERROR_RATE=0.02` (2% injected 503 responses)
- `PARAKEET_CHAOS_DELAY_MS=140`
- `PARAKEET_CHAOS_JITTER_MS=180`
- `PARAKEET_CHAOS_PATH_PREFIXES=/auth,/usage,/coupon`

## Pass/Fail checks

- request error rate must be `0%`
- `/usage/record` p95 <= `350ms`
- `/usage/record` max <= `700ms`
- `/usage` p95 <= `1200ms`
- `/auth/signup` p95 <= `6000ms`
- `/auth/session` p95 <= `4500ms`

If any check fails, the command exits with code `1`.

## Why this matters

Interview sessions depend on reliable request handling with low latency spikes. This test helps catch regressions before release.
