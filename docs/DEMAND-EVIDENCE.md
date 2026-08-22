# Demand evidence: a targeted GitHub case audit

> **Evidence snapshot:** 2026-08-15  
> **Document role:** This document summarizes a deliberately targeted audit of
> public GitHub issues and discussions. It is evidence for problem shapes,
> diagnostic boundaries, and fixture design. It is **not** a random sample,
> prevalence study, search-volume study, market-sizing exercise, or forecast of
> GitHub stars, package downloads, retention, or adoption.

## Bottom line

The audit contains 72 direct GitHub issue or discussion pages from 72 distinct
`owner/repo` pairs. The sampling plan forced equal coverage of four predefined
failure families: 18 cases per family.

The selected cases show that the four failure shapes occur in multiple tools,
languages, package managers, IDEs, CI systems, and operating-system boundaries.
That supports using the taxonomy to design diagnostics and test fixtures. It
does not establish how common any family is, whether these are the four most
important families, or whether a given issue still affects the latest release.

Within this audit, the largest engineering disposition is `observe`, and every
selected native/ABI case is `observe`. This supports an observe-first product
boundary: expose executable, configuration, runtime, and artifact provenance
before considering an intervention. It does not imply that 46/72 of real-world
environment failures are inherently observe-only.

## Research question

The audit was designed to answer:

> Can we find separately reported, inspectable examples whose visible
> evidence fits the four proposed diagnostic families, and what safety boundary
> would each example require?

It was not designed to answer:

- how many developers encounter these problems;
- how often each failure family occurs;
- what users search for most often;
- whether unresolved issues outnumber resolved issues;
- how many users would install, star, retain, or pay for RunParity; or
- whether RunParity currently diagnoses or proves every selected case.

## Method

Three tranches were collected, each containing 24 cases: six cases for each of
the four predefined families. Repository reuse was prohibited across tranches.

Inclusion required a direct public GitHub Issue or Discussion with at least one
inspectable signal such as an actual failure, an expected/effective contrast,
commands or logs, a minimal reproduction, artifact-header evidence, maintainer
analysis, or a linked fix. Search pages were used only for discovery and were
not counted as evidence pages.

The unit of deduplication is the lower-cased `owner/repo` pair. This prevents one
repository from contributing multiple cases, but it does not make the cases
causally independent: two repositories may depend on the same shell, package
manager, runtime, operating-system loader, or upstream artifact.

### Engineering dispositions

These labels describe how a case could be handled under the product safety
model; they are not severity or popularity scores.

- `proof`: the mechanism appears suitable for a future, dependency-frozen,
  offline, disposable Linux fixture with one typed intervention and fresh
  A1/B/A2 arms.
- `observe`: useful provenance can be collected, but the visible case does not
  provide a safe, bounded intervention under the V1 policy, or it crosses a
  Windows, macOS, GUI, CI, cloud, native-toolchain, or external-artifact
  boundary.
- `refuse`: a meaningful experiment would require credentials, a private
  service, live network mutation, or another explicitly forbidden action.

An audit label of `proof` does **not** mean RunParity has reproduced the case,
proved a unique root cause, or shipped an isolated proof backend. Current and
planned behavior is defined by the [product requirements](./PRD.md),
[CLI contract](./CLI.md), [security model](./SECURITY-MODEL.md), and
[validation protocol](./VALIDATION.md). At this snapshot, isolated
`--attempt-proof` and runnable proof fixtures remain planned.

## Audited distribution

| Primary family | Cases | `proof` | `observe` | `refuse` | Bounded reading |
| --- | ---: | ---: | ---: | ---: | --- |
| `PATH_SHADOWING` | 18 | 6 | 12 | 0 | The selected cases require more than printing PATH: shell resolution, shims, parent-process state, IDE state, and child-process winners can disagree. |
| `RUNTIME_MANAGER_DRIFT` | 18 | 7 | 11 | 0 | Version declarations, installed runtimes, aliases, caches, wrappers, and effective payloads need separate provenance. |
| `CONFIG_PRECEDENCE` | 18 | 11 | 5 | 2 | Several selected precedence mechanisms are fixture-friendly, while credentialed registries establish an explicit refusal boundary. |
| `NATIVE_ABI_ARCH_MISMATCH` | 18 | 0 | 18 | 0 | The selected cases support preflight fingerprinting; none justified automated download, rebuild, replacement, or cross-toolchain intervention. |
| **Total** | **72** | **24** | **46** | **2** | These are within-audit engineering judgments, not population proportions. |

The per-tranche recorded dispositions are:

| Tranche | Repositories | `proof` | `observe` | `refuse` |
| --- | ---: | ---: | ---: | ---: |
| 1 | 24 | 7 | 15 | 2 |
| 2 | 24 | 11 | 13 | 0 |
| 3 | 24 | 6 | 18 | 0 |

The rubric became more explicit over the tranches, especially around typed
interventions and the difference between “closed” and “solved.” The aggregate
above reports the labels recorded in the three audits; it should be recoded as
a whole if the policy or intervention allowlist changes.

## Representative direct evidence

The links below are illustrative, not exhaustive and not ranked. They were
chosen to span tranches, ecosystems, and boundary types. Across the full audit,
pages include historical or fixed regressions as well as reports that are open,
unsupported, duplicated, stale, or closed without a visible fix. GitHub state
is not treated as a resolution verdict.

### `PATH_SHADOWING`

- [pnpm/pnpm #7124](https://github.com/pnpm/pnpm/issues/7124): the top-level
  `pnpm -v` and the pnpm version observed inside a child script disagreed,
  exposing a wrapper/image winner that a single `which` check would miss.
- [pypa/virtualenv #2340](https://github.com/pypa/virtualenv/issues/2340):
  activation produced Python and pip winners from different environments.
- [microsoft/WSL #1896](https://github.com/microsoft/WSL/issues/1896):
  `which npm` reported the Linux path while bare command execution attempted
  the Windows installation; the absolute Linux path worked.
- [microsoft/vscode-python-environments #653](https://github.com/microsoft/vscode-python-environments/issues/653):
  the selected Conda interpreter and terminal activation disagreed with the
  Python executable launched by an extension subprocess.

### `RUNTIME_MANAGER_DRIFT`

- [supabase/supabase Discussion #36530](https://github.com/supabase/supabase/discussions/36530):
  project documentation, `.nvmrc`, and dependency engine requirements named
  incompatible Node expectations.
- [python-poetry/poetry #5190](https://github.com/python-poetry/poetry/issues/5190):
  the pyenv-selected interpreter and the interpreter used to create a Poetry
  environment diverged.
- [oven-sh/setup-bun #146](https://github.com/oven-sh/setup-bun/issues/146):
  the action read the requested Bun version correctly but restored an older
  cached binary; [release v2.1.3](https://github.com/oven-sh/setup-bun/releases/tag/v2.1.3)
  records a fix for cache-version validation.
- [gradle/gradle #15094](https://github.com/gradle/gradle/issues/15094):
  a declared Java toolchain and the shell winner were both suitable, but
  machine-wide discovery of a standalone JRE still failed the build.

### `CONFIG_PRECEDENCE`

- [npm/cli #3985](https://github.com/npm/cli/issues/3985): a private-registry
  authentication case demonstrated why live credentials and registry mutation
  belong behind `refuse` rather than an automated proof attempt.
- [docker/compose #9737](https://github.com/docker/compose/issues/9737): a
  version change reversed the observed precedence between a shell value and
  `.env`, providing a clear expected/effective contrast.
- [oven-sh/bun #9877](https://github.com/oven-sh/bun/issues/9877): the same
  `.env` data behaved differently across Bun versions and runner/child stages.
- [git-lfs/git-lfs #5730](https://github.com/git-lfs/git-lfs/issues/5730): an
  empty URL-specific proxy setting and ambient proxy variables produced a
  different winner in Git LFS than in Git.

### `NATIVE_ABI_ARCH_MISMATCH`

- [microsoft/node-pty #860](https://github.com/microsoft/node-pty/issues/860):
  an artifact stored under a Linux ARM64 path had an x86-64 ELF header.
- [anthropics/claude-code #29661](https://github.com/anthropics/claude-code/issues/29661):
  a macOS ARM64 install path received a Linux ARM64 ELF binary, showing that CPU
  architecture alone is not an adequate platform identity.
- [prisma/prisma #25206](https://github.com/prisma/prisma/issues/25206): a
  computed `windows` target omitted the CPU dimension on Windows ARM64 and
  surfaced later as a generic loader failure.
- [flutter/flutter #156309](https://github.com/flutter/flutter/issues/156309):
  an archive labeled for Linux ARM64 contained an x86-64 executable member.

## User-language search-intent clusters

The audits paraphrased issue symptoms into short, user-like phrases. The
clusters below are non-exclusive researcher coding, not verbatim queries and
not search-volume data.

| Paraphrased intent cluster | Common families | What a useful report should answer |
| --- | --- | --- |
| “I installed or upgraded it; why am I still running the old version?” | PATH, runtime | Which binary or cache won, where it came from, and which declaration it contradicted. |
| “The environment is selected or activated; why is another executable running?” | PATH, runtime | The selected state, all executable candidates, shim/wrapper chain, and final exec target. |
| “It works in my terminal; why not in the IDE, CI job, container, or child script?” | PATH, runtime, config | Parent process, launch boundary, environment snapshot, stage, and subprocess winner. |
| “The config file contains the value; why was it ignored or overwritten?” | Config | Search start/stop boundaries, ordered sources, transformations, and the effective winner. |
| “Why does the same variable differ between dev, build, server, and browser?” | Config | The evaluation phase, exposure/filter rule, expansion timing, and bundle/runtime boundary. |
| “The file exists; why does the loader say missing, invalid, or unable to open?” | Native/ABI | Binary format, CPU, ABI, libc where relevant, loader runtime, and actual artifact path. |
| “The download says ARM64 or the right platform; why is the binary x86-64 or for another OS?” | Native/ABI | Archive-member header and checksum versus filename, manifest label, host, and target contract. |
| “Install or rebuild succeeded; why does execution still fail?” | Native/ABI, runtime | Installer runtime, build runtime, shebang/launcher runtime, artifact ABI, and loaded file identity. |

These phrases are suitable for issue-form prompts, fixture names, CLI help, and
documentation headings. They are not evidence that one phrase is searched more
often than another.

## Product boundaries derived from the evidence

| Repeated evidence pattern in the selected cases | Bounded product implication | Explicit non-goal |
| --- | --- | --- |
| A command name, `which` result, shim, IDE selection, and child-process executable can disagree. | Record requested command, candidate list, resolved/canonical path, shim or shebang chain, parent/child boundary, and effective executable. | Do not rewrite global PATH, shell startup files, IDE settings, or manager state automatically. |
| Version files, package contracts, aliases, installed versions, caches, wrappers, and payloads can name different runtimes. | Compile a contract ledger and report every relevant source separately from the effective runtime. | Do not install runtimes, delete caches, or silently choose which declaration is authoritative. |
| Configuration values change across search roots, merge order, expansion, filtering, and evaluation phases. | Emit a secret-conscious `source → stage → transform → winner` trace for supported keys. | Do not print secret values, infer user intent, or broaden support to registry/auth keys without a reviewed policy. |
| Artifact filenames and platform labels can disagree with PE, Mach-O, ELF, ABI, or libc identity. | Fingerprint the actual loaded or about-to-be-loaded artifact and compare it with host/runtime/target facts before execution where possible. | Do not fetch, rebuild, replace, or republish missing native artifacts in V1. |
| Many cases cross Windows, macOS, GUI, CI, cloud, private-network, or native-toolchain boundaries. | Prefer `observe` or `refuse` and state the missing evidence and boundary explicitly. | Do not present a suggestion, workaround, or correlated difference as causal proof. |
| A subset appears suitable for a single-variable isolated experiment. | Future proof attempts require a qualified disposable backend, fixed dependencies, one typed intervention, a frozen oracle, and fresh A1/B/A2 arms. | The audit itself is not a runnable fixture, a `VERIFIED_INTERVENTION`, or evidence that the current prototype can perform proof. |
| Credentialed registry and proxy cases can be diagnostically informative without being safe to replay. | Redact recognized sensitive material, avoid persistence where possible, and refuse live credential/service mutation. | Do not claim reports are secret-free or safe to publish without human review. |

The evidence supports a narrow promise: make environment selection and
provenance visible, and prove only what a controlled experiment actually
establishes. It does not support a generic “repair everything” promise.

## Sampling bias and validity limits

- **Quota bias:** each family was forced to exactly 18 cases. Category counts
  therefore cannot estimate natural frequency or rank the families.
- **Targeted, not random:** discovery queries were built around known concepts
  such as wrong version, PATH, ignored configuration, ABI, ELF, and ARM64. This
  makes the audit useful for taxonomy coverage but weak for discovering unknown
  failure families.
- **Ecosystem bias:** JavaScript and Node.js tooling is overrepresented because
  the intended first product slice is JavaScript/TypeScript. Python, Java, Rust,
  Dart, Conda, Docker, and other ecosystems test transferability but do not form
  balanced ecosystem strata.
- **Platform bias:** the sample deliberately stresses Windows/WSL, macOS and
  Apple Silicon, IDEs, CI/cloud, Raspberry Pi, and ARM. Ordinary x64 Linux
  failures and uneventful success cases are underrepresented.
- **Public-source and language bias:** only public, indexable, mostly
  English-language GitHub reports were eligible. Private enterprise incidents,
  local-language forums, Discord/Slack threads, deleted content, and failures
  that users never reported are absent.
- **Evidence-density bias:** reports with logs, `which`, `file`, ABI numbers,
  cache keys, minimal reproductions, or maintainer analysis were easier to
  include. Users who only wrote “it does not work” or abandoned the tool are
  underrepresented.
- **Time bias:** the corpus intentionally mixes multi-year historical
  regressions with newer reports. That is useful for regression-fixture design
  but cannot estimate the defect rate of current releases.
- **State bias:** Open and Closed are workflow labels, not standardized outcomes.
  Closed pages include fixes, duplicates, unsupported combinations, stale or
  outdated reports, local workarounds, and pages with no visible fix. The first
  two tranches did not uniformly code resolution outcome, so this document does
  not publish an aggregate resolution rate.
- **Dependency bias:** 72 unique repositories are not 72 independent root
  causes. Several cases can share a runtime, shell, package manager, operating
  system, native library, or release pipeline.
- **Classification bias:** many cases plausibly span more than one family. Each
  row records one primary family for fixture and reporting design. The
  `proof/observe/refuse` label is a conservative engineering judgment and can
  change when the policy or available backend changes.
- **Search-intent bias:** the phrases above are paraphrases produced during
  analysis. They are not verbatim user queries and have no exposure, click,
  ranking, or conversion measurements.
- **Link and status drift:** issue contents, redirects, labels, and states can
  change after the 2026-08-15 snapshot.

## Reproducibility checks

The three source ledgers were machine-checked by extracting only direct URLs of
the form
`https://github.com/<owner>/<repo>/(issues|discussions)/<id>`, lower-casing
`owner/repo`, and comparing sets.

| Check | Result |
| --- | ---: |
| Extracted direct Issue/Discussion URLs | 72 |
| Unique direct Issue/Discussion URLs | 72 |
| Unique lower-cased `owner/repo` pairs | 72 |
| Cases per primary family | 18 / 18 / 18 / 18 |
| Recorded `proof / observe / refuse` | 24 / 46 / 2 |
| Representative links above | 16 unique links; all reopened successfully on 2026-08-15 |
| Search-result pages counted as cases | 0 |

The Supabase repository Discussion URL currently redirects to GitHub's canonical
organization Discussion URL; the direct source remains reachable. Supplemental
links such as a release page are not counted as cases.

## What this evidence can support

It can support:

- the existence of inspectable examples fitting each proposed family across the
  selected 72 repositories;
- a provenance-first CLI and report schema;
- a conservative separation between observation, isolated proof eligibility,
  and refusal;
- selection of public incidents for later fixture qualification; and
- user-facing terminology grounded in reported symptoms rather than internal
  taxonomy names alone.

It cannot support:

- population prevalence, category ranking, or overall developer popularity;
- search volume, market size, willingness to pay, or adoption forecasts;
- expected GitHub stars, forks, clones, package downloads, or retention;
- a claim that the latest version of every linked project remains affected;
- an aggregate upstream resolution rate;
- a claim that repository uniqueness implies root-cause independence; or
- a claim that RunParity currently reproduces, diagnoses, or proves all 72
  cases.
