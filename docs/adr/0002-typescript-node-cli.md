# ADR-0002: Use TypeScript on Node.js for the initial CLI

- Status: accepted
- Date: 2026-08-15

Implementation status: the TypeScript source CLI and package `bin` entry exist,
but the package remains private and unpublished at version `0.0.0`. Public `npx`
installation and the full Node release matrix are planned release work.

## Context

The first supported ecosystem is JavaScript/TypeScript, the primary adoption path is a no-global-install `npx` entry point, and Node.js 24 with pnpm 11 is already available in the development environment. Rust would improve single-binary distribution but would add a new toolchain before the product wedge is validated.

## Decision

Implement the initial `runparity` executable in strict TypeScript, publish it through npm, and expose it through the package `bin` field. Target controller launch compatibility with Node.js 18 and newer so it can inspect legacy failure environments; full feature support and release qualification target maintained Node.js 22 and 24. Keep platform observation and isolation behind narrow interfaces so native helpers can be introduced later without changing the public schema.

## Consequences

- Node.js 18 and 20 controller compatibility is observation-oriented and carries an EOL warning; it does not imply those runtimes are recommended or fully supported.
- The release matrix separately tests legacy startup compatibility and full behavior on maintained Node lines.
- Startup, package size, and dependency count are measured release gates.
- Security-sensitive platform primitives may later move to small native helpers rather than expanding the CLI surface.
- This ADR must be revisited if installation friction, startup, or executable provenance cannot meet the release gates.
