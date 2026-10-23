# Publication review — 2026-10-22

This review prepared the existing Chog World project for its initial GitHub upload.

## Changes made during review

- Excluded private environment files, dependencies, caches, build output, local editor state and archives. Retained environment examples and the public deployment records required by tooling.
- Updated setup and deployment documentation to describe the implemented City, Cult, Soul and bot features. Discord transport remains unfinished.
- Handled failed City standing-instruction loads and added a regression test; completed the corresponding test server route.
- Serialized database test files to avoid contention on their shared migration advisory lock. Production migration locking was preserved.
- Patched Fastify and Vitest dependencies. Kept Solidity exactly 0.8.24 and scoped its temporary-file dependency override to tmp 0.2.7.

## Verification observed

| Check | Result |
| --- | --- |
| Root contract/tooling tests | 64 passed |
| City simulation/unit tests | 97 passed |
| City web tests, one worker | 28 passed, no unhandled errors |
| City typecheck, fixture build and server build | Passed |
| Cult typecheck and production web build with patched dependencies | Passed |
| Cult regular tests with patched dependencies | 131 passed; 83 database cases skipped by that command |
| npm lockfile audits: root, City, Cult | Zero known vulnerabilities reported |
| Staged source/private-file scan | No credential finding or private environment value match |

## Remaining verification limits

The PostgreSQL integration suite did not establish an all-green result during this review. Parallel runs queued on the migration lock. Serialization removed those queues, but the first serial API file had 11 passes and two 20-second timeouts in scenarios that advance the simulation through 20 and 36 database-backed ticks. No deadlock was observed in the inspected database activity. A complete passing serial run and investigation of those slow cases remain necessary; the results above do not imply that all database tests pass.

Run `npm.cmd --prefix cult run db:up` and `npm.cmd --prefix cult run test:db` to reproduce the database checks. Root and app setup are documented in the repository README. City builds also retain Vite's warning about large 3D bundles.

Public-chain deployment, production hosting, fork tests and a comprehensive security audit were outside this upload review. No public-chain transactions were sent.
