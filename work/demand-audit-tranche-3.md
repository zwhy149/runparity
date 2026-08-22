# RunParity 真实需求证据审计：第三批（Tranche 3）

审计日期：2026-08-15

## 结论先行

本批新增 **24 个已逐页打开核验的公开 GitHub Issue/Discussion、24 个不同的 `owner/repo`**；与前两批 48 个仓库的交集为 **0**，三批累计覆盖 72 个不同仓库。四类各取 6 例。

V1 保守裁决为：

- `proof`：6 例。仅表示可以把同一机制复制进依赖已固定、离线、一次性的 Linux fixture/backend，并对一个明确、allowlisted 的类型化变量做 A/B/A；不授权修改用户真实环境。
- `observe`：18 例。可以读取或计算候选、赢家、声明源、进程继承、缓存、运行时或制品指纹，但 GUI、Windows/macOS、CI、私有网络、跨架构、原生工具链，或缺少可执行的 typed intervention，使安全 proof 不成立。
- `refuse`：0 例。Git LFS 案例中的真实企业代理联网复验应拒绝，但该案例仍可通过脱敏静态证据做 `observe`，所以不把整例人为计成 `refuse`。

“用户原话式搜索意图”均为对帖子问题的短语化意译，不是逐字引文，也不是 GitHub、Google 或其他平台的搜索量数据。本审计不据此推断市场规模、下载量或收藏量。

## 纳入、证据和解决状态规则

1. 每个计数案例都是直接 GitHub Issue/Discussion 页面；搜索结果只用于发现，不计作案例。
2. 每例至少包含实际失败、可比较的 expected/effective 值、日志、最小复现、制品头信息或维护者/关联修复证据之一；纯观点帖不纳入。
3. `证据可见性=高`：直接页可见复现/日志以及关键 winner、版本、路径、header 或关联修复；`中`：平台和症状明确，但缺少一段决定性 provenance 或上游处置链。本批不纳入“低”证据案例。
4. `是否解决` 与 GitHub 状态分开：只有可见关联 PR、发布说明或明确验证结果才写“已解决”；Duplicate、Not planned、Stale、Closed 本身都不等于解决。
5. `proof` 只能在 disposable Linux fixture 中离线、单变量、可回滚地做 A/B/A；本轮只接受 `path.prepend`、`runtime.select`、`config.set`、`nativeArtifact.select` 四类 typed intervention。原帖位于 macOS/Windows/GUI/CI 时，即使机制可理解，仍默认 `observe`。
6. “现有处置缺口”是缺少可移植、可自动化、可回滚的 provenance 证据，不表示维护者的回答错误。

## A. PATH_SHADOWING（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 用户原话式搜索意图（意译） | 证据可见性 | 是否解决 | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|---|---|---|
| T3-P1 | [microsoft/vscode-python-environments #653](https://github.com/microsoft/vscode-python-environments/issues/653) | Windows 10 主机、WSL2 Ubuntu 20.04、VS Code Remote | 已选 Conda 解释器 `/home/shawn/anaconda3/envs/ELM/bin/python`，终端也已激活；扩展刷新包时却执行 `/bin/python3 -m pip list` 并报没有 pip。 | “VS Code 选了 Conda，刷新包为什么还跑系统 Python？” | **高**：直接页同时给出 selected/resolved path、实际子进程和失败日志，并关联 #1175。 | **已解决**：Closed，页头关联 #1175；这是历史回归证据，不代表最新版仍有缺陷。 | `PATH_SHADOWING` | `observe` | 终端、编辑器选择和扩展子进程各有 winner；仅重选解释器不能说明哪一层覆盖了哪一层，GUI/WSL 状态也不应由 V1 自动改写。 |
| T3-P2 | [microsoft/WSL #1896](https://github.com/microsoft/WSL/issues/1896) | Windows WSL、Ubuntu 16.04 | `which npm` 显示 `/usr/bin/npm`，但裸跑 `npm` 却尝试执行 `/mnt/c/Program Files/nodejs/npm`；显式运行 `/usr/bin/npm` 正常。 | “WSL 的 npm 为什么越过 `/usr/bin` 去跑 Windows 版？” | **高**：直接页有 `whereis`、`which`、裸命令与绝对路径对照及精确报错。 | **部分解决**：Closed；页面可见重启或关闭 Windows PATH 注入等 workaround，未见本页关联的代码修复。 | `PATH_SHADOWING` | `observe` | 单看 PATH 或 `which` 会给出错误安全感；还需记录 shell command cache、Windows interop/PATHEXT 与实际 exec target，不能替用户全局关闭互操作。 |
| T3-P3 | [microsoft/terminal #11777](https://github.com/microsoft/terminal/issues/11777) | Windows Terminal 1.11、Windows build 21390 | PATH 已加入 ADB；普通 cmd/PowerShell 能运行，`wt.exe` 启动的 Terminal 却找不到，且同一 wt 进程的新 tab 继续继承旧环境。 | “PATH 已更新，为什么 wt.exe 打开的终端还是找不到 adb？” | **中**：版本、可执行文件位置和跨启动方式复现清楚，但本页没有 parent-process 环境快照或底层修复。 | **未证明**：Closed as Duplicate；本页没有可见关联 PR，Duplicate 只说明另有议题。 | `PATH_SHADOWING` | `observe` | PATH 文本相同不代表进程看到同一时间点的环境；需要 parent PID、启动方式和 environment snapshot age，而不是只建议重启。 |
| T3-P4 | [fish-shell/fish-shell #8553](https://github.com/fish-shell/fish-shell/issues/8553) | Debian / 通用 Unix fish login shell | 用户 `conf.d` 先执行，之后 Debian vendor 的 `00debian-profile.fish` 再改 PATH；用户配置因此被后到的 vendor 配置覆盖，只能移到 `config.fish` 或用同名文件遮蔽。 | “fish 为什么在读完我的配置后又把 PATH 覆盖了？” | **高**：直接页给出加载顺序算法、具体 vendor 文件和 PATH 后果。 | **未解决**：Open，列入 fish-future milestone；只有排序规避方案。 | `PATH_SHADOWING` | `proof`（Linux fixture） | 文档能解释静态顺序，但不能展示逐次 PATH mutation。fixture 的 vendor snippet 只改 PATH；唯一 `config.set` 是预制 user snippet basename：普通名（A）→同名 `00debian-profile.fish` 遮蔽（B）→普通名（A2）。 |
| T3-P5 | [pyenv-win/pyenv-win #469](https://github.com/pyenv-win/pyenv-win/issues/469) | Windows 11、WSL2、PowerShell | WSL 把 `python` 解析到挂载的 Windows pyenv-win shim，随后因 CRLF 得到 `/bin/sh^M: bad interpreter`；pipx 还引用已不存在的 `C:\Python311\python.exe`。 | “装 pyenv-win 后，WSL 为什么跑到 Windows 的 Python shim？” | **高**：直接页有两套 OS 路径、命令、错误和社区 workaround。 | **未解决**：Open；移除 Windows pyenv PATH 或改变排序只是局部 workaround。 | `PATH_SHADOWING` | `observe` | 全局移除 Windows PATH 会牺牲 WSL interop；应按命令列候选、来源、脚本换行/解释器 dialect 和实际 winner，不替用户做全局 PATH 手术。 |
| T3-P6 | [conda-forge/miniforge #249](https://github.com/conda-forge/miniforge/issues/249) | macOS 11.6.2 arm64、M1、VS Code | 两个终端都显示 Conda base 已激活；系统 Terminal 的 Python 是 Miniforge 3.9.7，VS Code terminal 的 `which python` 却是 `/usr/bin/python` / 2.7.16，`conda init --all` 全部显示 no change。 | “VS Code 里 Conda 显示已激活，为什么 Python 还是系统版本？” | **高**：直接页并列两个终端的 winner/version、active environment、osx-arm64 与 init 输出。 | **未证明**：Closed；本页无关联 PR或明确已验证修复，不能把关闭当成解决。 | `PATH_SHADOWING` | `observe` | activation banner 与 executable winner 可以分离；重复 init 没有解释 GUI 父进程、shell startup files 和 PATH 注入的先后关系。 |

## B. RUNTIME_MANAGER_DRIFT（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 用户原话式搜索意图（意译） | 证据可见性 | 是否解决 | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|---|---|---|
| T3-R1 | [oven-sh/setup-bun #146](https://github.com/oven-sh/setup-bun/issues/146) | GitHub Actions Linux runner（由 `/home/runner` 可见） | `.bun-version` 已从 1.3.0 改为 1.3.1；action 先记录 requested=1.3.1 和 cache hit，实际 `bun --revision` 却仍是 1.3.0，同一 cache key 删除后才恢复。 | “`.bun-version` 已升级，GitHub Actions 为什么还跑旧 Bun？” | **高**：requested、effective、cache key 与删除缓存后的对照都在直接页；发布说明也指回本 issue。 | **已解决**：[v2.1.3 release](https://github.com/oven-sh/setup-bun/releases/tag/v2.1.3) 明确记录 #169 会校验缓存 binary 与 requested version。 | `RUNTIME_MANAGER_DRIFT` | `observe` | 旧 action 已把矛盾写入日志却未结构化报警；删除远端缓存是破坏性手段，V1 应报告 cache provenance 而非自动清理 CI 状态。 |
| T3-R2 | [asdf-vm/asdf #2232](https://github.com/asdf-vm/asdf/issues/2232) | macOS Darwin arm64、zsh、asdf 0.18.0 | repo `.tool-versions` 从 Ruby 3.2.2 升至 3.2.3，本机只装 3.2.2；asdf 却误报“没有设置版本”并建议把共享文件改回旧版，实际执行 `asdf install` 后成功。 | “`.tool-versions` 明明写了 Ruby，为什么 asdf 说没有设置？” | **高**：Open/bug、完整最小复现、declared/installed 版本和纠正动作均可见。 | **部分解决**：用户本机可用 `asdf install` 恢复；issue 仍 Open，误导性诊断未解决。 | `RUNTIME_MANAGER_DRIFT` | `observe` | “已声明但未安装”被混成“未声明”，还诱导改共享契约。页面中的恢复动作是安装缺失 runtime，不是 V1 允许的离线 typed intervention；V1 只应输出 declared/installed/missing target。 |
| T3-R3 | [NousResearch/hermes-agent #21656](https://github.com/NousResearch/hermes-agent/issues/21656) | Debian 13.4 container、Podman/Docker、tag v2026.4.30 | installer pin Node 22，Dockerfile 通过 apt 得到 Node 20.19.2；依赖要求 Node ≥22，npm 只给 `EBADENGINE` warning，稍后 Vite 才误导性报无法解析 `clsx`。只换 Node 22 后 warning 消失且 build 成功。 | “Docker 里为什么先报 engine warning，最后却变成 Vite 找不到包？” | **高**：两个安装入口、actual/required Node、早期 warning、末端错误、复现命令和单变量成功对照都在页内。 | **部分解决**：Closed as Not planned；downstream workaround 已验证，上游 Dockerfile 未在本页解决。 | `RUNTIME_MANAGER_DRIFT` | `proof`（依赖预置的离线 Linux container fixture） | 表面错误把调查引向包解析；应把 Dockerfile、installer、package engine 与 effective Node 串成 ledger。依赖和 image 固定后，唯一 intervention 是 `runtime.select`：Node 20（A）→22（B）→20（A2）。 |
| T3-R4 | [gradle/gradle #15094](https://github.com/gradle/gradle/issues/15094) | Fedora 32、SDKMAN JDK 11、系统 OpenJDK 8 JRE、Gradle 6.7 | build 明确要求 Java 11 toolchain，`which java` 也指向 SDKMAN JDK 11；Gradle 扫描到只有 JRE 的系统 Java 8 后仍尝试探测并让整个 build 失败。 | “Gradle 配了 Java 11 toolchain，为什么被系统 Java 8 JRE 拖垮？” | **高**：目标版本、实际候选路径、JRE/JDK 文件差异、复现步骤和 stack trace 均可见。 | **已解决**：Closed，页头关联 #15137，并标入 6.8 RC1 milestone。 | `RUNTIME_MANAGER_DRIFT` | `observe` | `which java` 只描述 shell winner，不描述 Gradle 的 machine-wide discovery；本页未证明某个 allowlisted 单项配置能在 6.7 恢复，因此 V1 先输出全部候选、JRE/JDK 能力与拒绝原因，不隐藏/删除系统 JRE。 |
| T3-R5 | [rust-lang/rust #104723](https://github.com/rust-lang/rust/issues/104723) | macOS 12.5.1、Apple Silicon、Rosetta；rustup toolchain 自报 x86_64 host | `file $(which rustc)` 看到 arm64 wrapper，但 `rustc --version --verbose` 的 host 是 x86_64；bootstrap 因此按 x86_64 构建并与 arm64 Homebrew 库链接冲突。 | “M1 上 rustc 路径是 arm64，bootstrap 为什么仍按 x86_64 构建？” | **高**：wrapper 的 Mach-O、runtime self-report、host arch、linker 对照和关联修复均可见。 | **已解决**：Closed，页头关联 #110909；可作为历史回归样本。 | `RUNTIME_MANAGER_DRIFT` | `observe` | `which` 和 wrapper header 仍看不到 rustup 所选 payload/toolchain host；需把 wrapper、selected toolchain、inner executable 与 build triple 并列，macOS 跨架构不做自动干预。 |
| T3-R6 | [actions/setup-python #969](https://github.com/actions/setup-python/issues/969) | Windows enterprise self-hosted GitHub Actions runner | 在 Python 3.12.5 与 3.12.6 间切换时第一次失败、第二次成功；3.12.6 installer 被放入新目录，却把 Python 装进旧 `3.12.5/x64`，随后新目录 symlink 创建失败。 | “自托管 Windows runner 切 Python，为什么第一次仍装进旧目录？” | **高**：最小 workflow、setup.ps1 阶段、旧/新目录、双向切换和 first/second-run 对照均可见。 | **未证明**：Closed，但 Relationships=None、Development 无 PR；页面没有可见修复版本。 | `RUNTIME_MANAGER_DRIFT` | `observe` | 重跑会掩盖 stale installer/tool-cache target；应同屏报告 requested version、installer cache、destination 和 effective binary，Windows self-hosted 状态不能由 V1 清理。 |

## C. CONFIG_PRECEDENCE（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 用户原话式搜索意图（意译） | 证据可见性 | 是否解决 | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|---|---|---|
| T3-C1 | [oven-sh/bun #9877](https://github.com/oven-sh/bun/issues/9877) | WSL2 Linux x86_64、Bun 1.0.35→1.0.36/1.1、Vite 5.2.7 | 同一 `.env` 键在 Bun 1.0.35 可见，1.0.36 后经 `bun run` 进入 package script 时消失；讨论说明 runner 为避免外层 development env 覆盖子进程 production env 而改变加载阶段。 | “升级 Bun 后，为什么 package script 读不到 `.env`？” | **高**：MRE、版本 A/B、环境输出和设计动机都可见。 | **未解决**：Open，页面关联后续 #35710；未见已发布修复。 | `CONFIG_PRECEDENCE` | `proof`（固定版本 Linux fixture） | 问题是 outer runner 与 child process 的阶段性优先级，不只是“文件没加载”；按 stage 记录 source/winner，唯一 intervention 为 `runtime.select`：预装 Bun 1.0.36（A）→1.0.35（B）→1.0.36（A2）。 |
| T3-C2 | [eslint/eslint #17369](https://github.com/eslint/eslint/issues/17369) | RHEL、Node 16.19、npm 8.9、ESLint 8.45 | `--config` 指向项目根外的 `eslint.config.js`，但未设 `ESLINT_USE_FLAT_CONFIG=true` 时仍按 legacy mode 解析，产生与真实模式选择无关的类型/选项错误。 | “明明传了 `eslint.config.js`，为什么 ESLint 还按旧配置格式报错？” | **高**：最小 config、CLI、精确错误、位置/flag 对照与维护者解释均可见。 | **未解决（该版本）**：Closed as Not planned；后续主版本默认行为变化不等于此页有 backport。 | `CONFIG_PRECEDENCE` | `proof`（固定旧版 Linux fixture） | 输出没有声明 config mode、search root 和触发 mode 的来源；唯一 `config.set` 是 `ESLINT_USE_FLAT_CONFIG`：unset（A）→true（B）→unset（A2），不改用户文件。 |
| T3-C3 | [nuxt/nuxt #33587](https://github.com/nuxt/nuxt/issues/33587) | Windows 11、Node 22.21、Nuxt 3.15.4→3.19.3 | `extends: [layerA, layerB]` 按文档应让前者优先，3.19.3 却由后面的低优先级 layer 获胜；帖子提供 StackBlitz MRE 和旧版对照。 | “Nuxt layers 为什么后面的低优先级覆盖前面的？” | **高**：层顺序、期望/实际 winner、版本 A/B 与 MRE 可见。 | **已解决**：Closed，页头关联 #33654。 | `CONFIG_PRECEDENCE` | `proof`（固定版本 Linux fixture） | 最终页面只暴露 winner，不暴露各 layer 的 merge event；给 key 级来源链，唯一 `config.set` 是 `extends` 顺序：[A,B]（A）→[B,A]（B）→[A,B]（A2）。 |
| T3-C4 | [storybookjs/storybook #12270](https://github.com/storybookjs/storybook/issues/12270) | macOS 10.15.6、Node 13.12、Storybook 6.0.7、CRA preset | shell 与 env-cmd 提供的变量在 story 中都变成 undefined；讨论显示 Storybook 只公开特定前缀，并在 iframe webpack config 中重写 `process.env`，社区 workaround 需手补 DefinePlugin。 | “命令行已设环境变量，为什么 Storybook 里还是 undefined？” | **高**：复现、版本、过滤规则、bundler 阶段和 workaround 可见。 | **部分解决**：Open；存在 workaround，无可见上游修复。 | `CONFIG_PRECEDENCE` | `proof`（固定旧版 Linux fixture） | prefix filter 与 bundle-time replacement 是两个隐藏阶段。固定 fixture 同时探测两个非敏感键，唯一 `config.set` 是 env-key prefix：无允许前缀（A）→`STORYBOOK_`（B）→无前缀（A2）；oracle 只报告 presence，不输出值。 |
| T3-C5 | [git-lfs/git-lfs #5730](https://github.com/git-lfs/git-lfs/issues/5730) | Windows 10、Git LFS 3.5.1、Git 2.45、企业代理 | URL-specific 的空 `http.<url>.proxy` 本应禁用代理，Git LFS 却忽略空值，让 `HTTP[S]_PROXY` 获胜；Git clone 成功而 LFS checkout 得到 Bad Gateway，取消环境变量后恢复。 | “gitconfig 已禁用这个域名的代理，Git LFS 为什么仍走环境代理？” | **高**：配置、版本、Git/LFS 行为差、错误与环境变量对照可见。 | **未解决**：Open / backlog；只有 `NO_PROXY` 等 workaround。 | `CONFIG_PRECEDENCE` | `observe`（真实联网验证 `refuse`） | 私有 endpoint 与代理不能主动复验；V1 只能脱敏显示 candidate/winner 和空值语义，必须拒绝使用真实凭据或改写企业网络配置。 |
| T3-C6 | [nrwl/nx #23221](https://github.com/nrwl/nx/issues/23221) | Darwin arm64、Node 18.18、Nx 19 | `.env.production` 的直接键已覆盖 root `.env`，但引用该键的插值仍保留 root 展开结果，例如 direct value 是 production 而 dependent value 仍带 local 后缀；帖子有 MRE 和加载顺序 instrumentation。 | “Nx 生产变量已覆盖，为什么引用它的变量还保留本地值？” | **高**：MRE、两个文件、direct/dependent 值与 instrumented order 可见。 | **未证明**：Closed as Outdated；无关联 PR/发布说明，关闭不证明修复。 | `CONFIG_PRECEDENCE` | `observe` | 最终 merged map 隐藏了 expansion 发生时间；页面没有可控的 known-good 版本、修复或 allowlisted 单项 B，改变 Nx 内部 expansion timing 不是 V1 intervention。先输出每个 key 的 load/expand/overwrite 事件。 |

## D. NATIVE_ABI_ARCH_MISMATCH（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 用户原话式搜索意图（意译） | 证据可见性 | 是否解决 | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|---|---|---|
| T3-N1 | [prisma/prisma #25206](https://github.com/prisma/prisma/issues/25206) | Windows 11 Home ARM64、Node 20.17 arm64、Prisma 5.19.1 | generate 得到 query engine `.node`，加载时只报“not a valid Win32 application”；日志的 computed target 只有 `windows`，没有表达 CPU arch，而当时无 Windows ARM engine。 | “Windows ARM64 上 Prisma generate 成功，Client 为什么加载不了 DLL？” | **高**：OS/Node arch、版本、engine path、computed target 和 loader 错误可见。 | **未解决 / 不支持**：Closed as Not planned；无 ARM engine 修复。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | target label 丢失 CPU 维度，普通 loader 错误也不说 PE machine；应预执行比较 host、Node、PE header 与支持矩阵，不能生成缺失 engine。 |
| T3-N2 | [jax-ml/jax #18486](https://github.com/jax-ml/jax/issues/18486) | Raspberry Pi 4、Debian 11 64-bit、JAX 0.4.20、USB Coral Edge TPU | loader 声称找不到 `libtpu.so`，文件其实存在；维护者指出该库是 x86-64 Cloud TPU 包，不是 ARM 上的 Edge TPU 支持，用户随后确认理解。 | “`.so` 明明存在，JAX 为什么还说无法打开？” | **高**：平台、路径、loader 症状与维护者的架构/产品定位解释可见。 | **已解释但未提供支持**：Closed；不是通过修复让该 ARM/Edge TPU 组合可用。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 泛化的 loader errno 把 wrong-arch 与产品不兼容伪装成 missing file；需显示 ELF machine、host 和 accelerator support，不能替换上游库。 |
| T3-N3 | [conda/conda-libmamba-solver #388](https://github.com/conda/conda-libmamba-solver/issues/388) | macOS 11 arm64、Conda 23.5.2 | host/subdir 本应是 osx-arm64，但 `.condarc subdirs: osx-64` 强制下载 x64 包；libcrypto Mach-O 架构错误，表面却只报 OpenSSL unavailable / SSL failure。 | “OpenSSL 明明装着，Conda 为什么说 SSL 不可用？” | **高**：完整 conda info/config、channel subdir、包和路径信息可见。 | **未解决**：Closed as Not planned / stale 并锁定；无关联修复。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | SSL 表面症状掩盖配置强制的 x64 artifact；需把 subdir 来源、package record、Mach-O 与 host arch 连起来，macOS 环境不自动改包。 |
| T3-N4 | [pocketbase/pocketbase #757](https://github.com/pocketbase/pocketbase/issues/757) | Raspberry Pi 4、Linux arm64 | 标为 Linux ARM64 的 0.7.8/0.7.9 release binary 在树莓派执行仍报 `exec format error`，报告者判断下载物实际为 AMD64。 | “下载的是 linux-arm64，为什么树莓派仍报 exec format error？” | **中**：版本、平台、release label 和症状清楚，但直接页未给 `file`/header 输出或可见关联修复。 | **未证明**：Closed；本页没有明确修复提交、release 或复验。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | release filename 不能作为架构证据；V1 可在执行前比较 checksum/header 与 host，但不能仅凭报告断言上游当前 artifact 仍错误。 |
| T3-N5 | [flutter/flutter #156309](https://github.com/flutter/flutter/issues/156309) | Ubuntu 22.04.5 arm64、Flutter 3.24.2/3.24.3、Yocto/meta-flutter | Linux ARM64 artifacts archive 内的 `frontend_server_aot.dart.snapshot` 经 `file` 检测为 ELF x86-64，导致 ARM64 build 失败。 | “Flutter 的 linux-arm64 包为什么内含 x86-64 snapshot？” | **高**：host、Flutter versions、artifact member、`file` header 与构建场景可见。 | **未解决**：Open、P2、triaged。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | V1 能在解包后、执行前阻断错误 artifact 并给强干预证据，但不能重新发布上游 snapshot 或替用户运行 cross-build。 |
| T3-N6 | [kelektiv/node.bcrypt.js #1018](https://github.com/kelektiv/node.bcrypt.js/issues/1018) | macOS Apple Silicon M1/M2、Node 16.16、bcrypt 5.0.0 | darwin-arm64 N-API v3 预编译 asset 请求返回 404 后回退源码；另有用户加载到 x86_64 bcrypt Mach-O，arm64 Node 随即报不兼容。issue body 指出 5.1.1 已提供 ARM build。 | “bcrypt 在 M1 上为什么找不到 arm64 预编译包或加载成 x86_64？” | **高**：asset URL、ABI、版本、fallback 与架构 loader 信息可见。 | **已解决（升级路径）**：Closed；5.1.1 提供对应 ARM build，旧 5.0.0 本身不变。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 日志把 asset availability、source fallback、N-API 和 runtime architecture 分成多段；需合并为一条选择链，macOS native build 不自动干预。 |

## 机器完整性校验

校验方法：从三份审计 Markdown 中只提取形如 `https://github.com/<owner>/<repo>/(issues|discussions)/<id>` 的计数案例 URL，统一为小写 `owner/repo` 后做集合运算；supplemental release 链接不计案例。

| 检查项 | 结果 |
|---|---|
| 本批直接 Issue/Discussion 页面 | 24 |
| 本批不同 `owner/repo` | 24 |
| 本批重复案例 URL | 0 |
| 与 tranche 1 的仓库交集 | 0 |
| 与 tranche 2 的仓库交集 | 0 |
| 三批累计不同仓库 | 72 |
| 每类样本 | 6 / 6 / 6 / 6 |
| 本批 `proof / observe / refuse` | 6 / 18 / 0 |
| 证据可见性 `高 / 中 / 低` | 22 / 2 / 0 |
| 搜索结果页计入案例 | 0 |

关闭、重复或已修复案例可用作历史需求与回归 fixture，但不能证明最新版仍有同一 bug。不同仓库也可能共享同一 OS、runtime、package manager 或 native dependency，仓库去重不等于根因统计独立。

## 第三批对产品假设的增量修正

1. **PATH 诊断必须超越 PATH 字符串。** WSL 的裸命令与 `which` 不一致、Windows Terminal 继承旧环境、VS Code 的 selected interpreter 与子进程不同，要求输出 shell resolution、parent process snapshot、GUI extension state 和最终 exec target。
2. **manager 的“声明、缓存、已安装、payload”必须分层。** setup-bun 能读到新声明却恢复旧缓存；asdf 能读到声明却只缺安装；rustup wrapper 的架构还可能与内部 toolchain host 不同。单一“version”字段不足。
3. **effective config 需要事件日志，而非只给 merged value。** Bun、Storybook 和 Nx 的差异发生在 runner、child、bundle、expand 等不同阶段；Nuxt/ESLint 则由顺序或模式决定。报告至少要有 `source → stage → transform → winner`。
4. **native preflight 要核对真实 header，不信文件名。** `windows`、`linux-arm64`、wheel tag 或下载路径都可能缺少 CPU、格式、ABI、libc 或产品支持维度；执行前检查 PE/Mach-O/ELF 能把误导性 loader 错误前移。
5. **解决状态也是 fixture 元数据。** 有关联修复的历史样本适合做 known-bad/known-good 回归；Closed-but-unverified 只能做需求证据，不能标记为已修复基线。
6. **observe 中必须显式携带 refusal boundary。** 企业代理、远端 CI cache、GUI state 与上游 artifact 可以观察和解释；涉及凭据、网络写入、全局 PATH、缓存删除或系统包替换时应停止，而不是为了演示自动修复跨界。

## 抽样偏差与不能外推的结论

- **配额偏差：**四类人为各取 6 例，只为覆盖诊断面，不能推断四类的真实发生比例。
- **平台偏差：**PATH 样本明显偏 Windows/WSL/VS Code，native 样本偏 Apple Silicon、Windows ARM 和 Raspberry Pi；常规 x64 Linux 与纯 shell 的安静失败被低估。
- **生态偏差：**JavaScript/Node 与开发工具仍占多数；Java、Rust、Python、Dart、Go/原生制品的加入只能证明结构可迁移，不能证明首个 Node-focused V1 已覆盖这些生态。
- **公开与语言偏差：**仅含公开、可索引、英文为主的 GitHub 页面；私有企业仓库、中文社区、Discord/Slack、删除内容和未上报失败不在样本内。
- **关键词偏差：**发现过程围绕 PATH、wrong version、ignored config、ABI、ELF、arm64 等已知术语，可能漏掉完全不同措辞。
- **证据选择偏差：**带 MRE、日志、`which`、`file`、cache key、ABI 或维护者定位的帖子更易入选；新手只写“不能用”或直接放弃的样本被系统性低估。
- **证据可见性主观性：**“高/中”衡量的是直接页面能否复核诊断链，不是 issue 质量评分；GitHub 折叠评论、外链失效或未索引讨论会改变判断。
- **解决状态偏差：**有关联 PR、release 或清晰 workaround 的历史案例更容易核验；Open、无回复和被 stale bot 关闭的问题可能被低估。
- **年代偏差：**本批混合 2017–2026 的案例，适合形成 regression fixture，不适合估计当前版本故障率。
- **依赖关联偏差：**24 个不同 `owner/repo` 仍可能由同一底层 shell、runtime、package cache、OS loader 或 artifact pipeline 触发，因此不能当作 24 个独立根因。
- **proof 裁决偏差：**`proof` 只表示机制可迁移到固定、离线、一次性 Linux fixture；不表示原帖所在 Windows/macOS/CI/GUI 环境可安全修改。
- **搜索意图非搜索数据：**短语为研究者意译，不是用户逐字 query，也没有曝光、点击、搜索量或转化率支持。
- **无市场外推：**72 个不同仓库只说明问题跨仓库出现；不能据此预测 GitHub stars、npm 下载、留存、付费意愿或总可服务市场。
- **时间快照：**页面内容和状态截至 2026-08-15；上游之后可能修改状态、修复、重定向或删除内容。
