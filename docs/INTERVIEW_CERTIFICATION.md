# Interview Certification Gate

This is the release gate for interview reliability confidence.

## Command

From repo root:

```bash
npm run test:certify-interview
```

This runs three phases:

1. **baseline** - standard hard-mode load
2. **endurance** - longer soak run
3. **chaos** - injected latency + small error rate to verify resilience bounds

Each phase writes a JSON report to `reports/reliability/` and returns pass/fail.

Final verdict:

- `GO` -> all phases pass
- `NO_GO` -> one or more phases fail (do not release)

## Endurance duration

Default endurance soak duration is 90 seconds.

Override:

```bash
PARAKEET_CERT_ENDURANCE_SOAK_MS=300000 npm run test:certify-interview
```

## Release checklist (must be true for GO)

- `npm run build` passes
- `cargo test -j 1` passes
- `npm run test:hard-mode` passes
- `npm run test:certify-interview` returns `GO`
- no known blocker in packaging/build pipeline
- manual smoke pass on target OS:
  - sign in
  - start listening
  - stop/start rapidly 5-10 times
  - typed question fallback works
  - no freeze while answer streams
