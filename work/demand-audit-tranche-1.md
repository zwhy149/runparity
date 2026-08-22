# RunParity 真实需求证据审计：第一批（Tranche 1）

审计日期：2026-08-15

## 结论先行

本批纳入 **24 个公开 GitHub Issue/Discussion、24 个不同仓库**，四类各 6 例。它们证明的不是“市场规模”，而是一个更窄、但可复核的事实：开发者确实反复遇到“同一条命令在不同上下文中解析出不同可执行文件、运行时、配置或原生制品”的问题，而且现有处置常停留在重装、删缓存、写死绝对路径或手工比对日志，缺少统一的来源追踪与安全的单变量验证。

按 RunParity V1 的边界保守分级，本批共有：

- `proof`：7 例。可在离线、一次性 Linux fixture/backend 中只改变一个有类型的变量，并执行 A/B/A；这不等于可以在用户真实主机上直接修改。
- `observe`：15 例。V1 能采集和比较事实，但因 Windows/macOS、GUI/IDE、CI、跨编译或原生工具链等边界，不能安全完成因果证明。
- `refuse`：2 例。涉及私有 registry、凭据和网络，V1 应拒绝执行干预；案例仍能证明需求存在。

## 纳入与裁决规则

1. 只计公开 GitHub Issue/Discussion 的**直接页面**；搜索结果页仅用于发现候选，不计作案例。
2. 每例必须含实际症状、复现、日志或维护者诊断中的至少一种；概念讨论和纯功能建议不纳入。
3. 以 `owner/repo` 去重；同一组织下不同仓库仍是不同样本。
4. 平台只在帖子明确给出时写“明确”；从 `/Users/...`、`/work/...` 等路径推断时明确标注“推断”；其余写“未说明”。
5. `proof` 指 V1 有能力在**受控、可丢弃、离线**环境中做单变量 A/B/A，并产生 `VerifiedIntervention` 级证据；不是“已证明根因”。
6. `observe` 指可以输出候选、赢家、来源与不一致，但当前不应执行干预。`refuse` 指即使能看到部分配置，也不应触碰凭据、私有服务或联网验证。
7. “现有回答不足”不等于维护者回答错误；这里专指它还没有提供可移植、可自动化、可回滚的来源链与因果验证。

## A. PATH_SHADOWING（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|
| P1 | [pnpm/pnpm #7124](https://github.com/pnpm/pnpm/issues/7124) | macOS、Windows、Linux（提问表单）；最终定位路径为 macOS | 终端中的 `pnpm -v` 是 8.7.6，但 `pnpm run dev` 内看到 8.7.5；嵌套脚本命中 Volta Node image 内的旧 pnpm，而不是 Volta shim。 | `PATH_SHADOWING` | `proof`（Linux fixture） | 处置依赖在脚本里手动 `which`、删除 Volta image 缓存并重装；没有列出全部候选、解释父/子进程为何选择不同，也没有可回滚 A/B/A。 |
| P2 | [volta-cli/volta #1354](https://github.com/volta-cli/volta/issues/1354) | macOS（`/Users/...`、zsh） | `volta list` 显示 Node 18.10，但 `node -v` 是 14.20；`.zshrc` 末尾追加的 `pnpm bin -g` 把具体 Node image 放到了 Volta shim 前面。 | `PATH_SHADOWING` | `proof`（Linux fixture） | 维护者需要人工检查完整 shell 启动文件；建议会改变用户的 pnpm 全局工作流，且没有自动展示 PATH 进入链、赢家和恢复后的复验。 |
| P3 | [modelcontextprotocol/servers #64](https://github.com/modelcontextprotocol/servers/issues/64) | macOS 15.1.1 明确；讨论中另有 Windows/fnm/Volta 报告 | GUI 应用没有继承正确的 NVM Node 环境，MCP server 无法启动；常见绕法是全局安装并把 Node 和脚本绝对路径写进配置。 | `PATH_SHADOWING` | `observe` | 绝对路径会随 Node 版本升级失效，不同管理器/系统需要不同 wrapper；全局安装又引入新状态，V1 不能在 GUI 宿主上安全做 A/B/A。 |
| P4 | [coreybutler/nvm-windows #1056](https://github.com/coreybutler/nvm-windows/issues/1056) | Windows 10、管理员命令行、NVM4W 1.1.11 | `nvm use latest` 声称已切到 Node 21.1，随后 `node` 却无法识别；诊断同时出现位置冲突/其他安装与 `active: none`。 | `PATH_SHADOWING` | `observe` | “切换成功”与“没有 active runtime”相互矛盾，重装/重启也未解决；现有诊断没有指出确切缺失或获胜 PATH 项，Windows V1 也尚不应修改。 |
| P5 | [Schniz/fnm #1551](https://github.com/Schniz/fnm/issues/1551) | Linux（CachyOS、KDE Plasma、Fish、systemd） | 非交互登录与终端各执行一次 `fnm env`，PATH 中叠加陈旧 multishell 目录；执行 `fnm use system` 后仍命中 fnm 默认 Node，而非 `/usr/bin/node`。 | `PATH_SHADOWING` | `observe` | 帖子给出了很好的进程树分析和交互 shell guard，但仍缺自动识别陈旧条目、说明会话继承来源并验证清理结果的通用工具；KDE/systemd 桌面会话也超出首个 proof backend。 |
| P6 | [openai/codex #24935](https://github.com/openai/codex/issues/24935) | macOS arm64、Apple Terminal、Volta | `npm install -g @openai/codex` 更新的是 Node image 下的 npm root，而实际运行的是 Volta packages root；诊断列出 5 个 `codex` 候选，版本始终不变。 | `PATH_SHADOWING` | `observe` | 现有 debug 已暴露多个候选，但补救仍是泛化的“修 PATH/npm prefix”，没有给出管理器特定的最小干预及恢复验证；真实更新还涉及联网和 macOS 主机。 |

## B. RUNTIME_MANAGER_DRIFT（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|
| R1 | [supabase/supabase Discussion #36530](https://github.com/supabase/supabase/discussions/36530) | 未说明；本地项目设置 | `DEVELOPERS.md` 要求 Node 20，`.nvmrc` 写 22，依赖又要求 22；按文档使用 20 后出现 `ERR_PNPM_UNSUPPORTED_ENGINE`。 | `RUNTIME_MANAGER_DRIFT` | `proof`（Linux fixture） | 三个项目契约互相冲突，帖子没有给出权威源或优先级；用户只能在安装阶段才发现，适合做静态 winner trace 与单 runtime 切换 fixture。 |
| R2 | [jdx/mise Discussion #7379](https://github.com/jdx/mise/discussions/7379) | 一条子报告明确为 macOS arm64；核心案例跨两台机器 | `.nvmrc` 是 `22`，`devEngines.runtime.version` 是 `>=22.12.0`；一台机器选择 Node 26.5.0，另一台选择恰好 22.12.0。 | `RUNTIME_MANAGER_DRIFT` | `observe` | 维护者建议用工具限定的 opt-out，并讨论语义差别，但没有解释两台机器为何做出不同选择；修改全局 manager 设置也不是单一、可移植的项目级验证。 |
| R3 | [angular/angular #47771](https://github.com/angular/angular/issues/47771) | 未说明 | 开发者切换 Angular 项目时用错 Node，安装依赖后到运行阶段才失败；只能手查 changelog/blog 再补 `.nvmrc`，因此请求明确的兼容矩阵。 | `RUNTIME_MANAGER_DRIFT` | `observe` | 兼容表能帮助查询，却不能在执行前把当前 runtime、项目 Angular 版本与项目自己的版本声明合并成可解释判定；帖子也没有足够精确的 fixture 输入。 |
| R4 | [actions/setup-node #1206](https://github.com/actions/setup-node/issues/1206) | GitHub Actions `ubuntu-latest`；表单亦勾选多 OS | `package.json` 通过 Corepack 要求 Yarn 4.6，缓存步骤却调用 `/usr/local/bin/yarn` 1.22.22 并报错。 | `RUNTIME_MANAGER_DRIFT` | `observe` | 讨论焦点是错误消息中的坏文档链接，而非缓存阶段为何在 Corepack 前命中全局 Yarn；错误没有输出 executable provenance 或 Corepack 状态。 |
| R5 | [pnpm/action-setup #227](https://github.com/pnpm/action-setup/issues/227) | GitHub Actions；runner OS 未明确 | v6 忽略 `package_json_file` 中的 `packageManager: pnpm@10.28.1`，错误版本把 lockfile 当成损坏；报告称影响数十个仓库。 | `RUNTIME_MANAGER_DRIFT` | `observe` | 报错归咎于 lockfile 语法，却不报告被选中的 pnpm 版本、来源以及配置文件为何未生效；外部 CI/action 不适合 V1 做有状态干预。 |
| R6 | [nodejs/node #50963](https://github.com/nodejs/node/issues/50963) | 未说明；问题按 Node 切换复现 | `packageManager` pin 因 Corepack 默认关闭而失效，切换 Node 后还会再次关闭；开发者容易忘记，只能把版本约束重复写到 `engines.pnpm`。 | `RUNTIME_MANAGER_DRIFT` | `proof`（仅限已缓存依赖的 Linux fixture） | 议题最终未采纳；依赖人的记忆和重复声明，且每次 runtime 切换都会重新漂移。可在一次性环境中把 `corepack enable` 作为唯一干预验证，但不得隐式下载。 |

## C. CONFIG_PRECEDENCE（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|
| C1 | [npm/cli #3985](https://github.com/npm/cli/issues/3985) | Alpine 3.13.6、Node 16.13、npm 8.1 | npm 6 中有效的 `npm_config__auth` 在 npm 8 对 scoped private registry 不再生效；`npm whoami` 仍成功，但 `dist-tag` 失败。 | `CONFIG_PRECEDENCE` | `refuse` | process substitution/临时 userconfig 的绕法依赖 shell，会屏蔽 `~/.npmrc`，还可能被项目 `.npmrc` 覆盖；任何验证都需真实凭据和私有网络。 |
| C2 | [yarnpkg/berry #2106](https://github.com/yarnpkg/berry/issues/2106) | 未说明；自托管 JFrog registry | home 配置含 registry token，项目配置设置 `npmAlwaysAuth: true`；registry 专属默认值优先，且把 registry block 移到项目后又因配置不深合并而丢失 home token，请求仍未认证。 | `CONFIG_PRECEDENCE` | `refuse` | 把 wrapper 放到 home 会改变用户全局状态，把 token 放项目又不安全；现有流程没有安全的 effective-config 来源链，proof 必须触碰凭据和 live registry。 |
| C3 | [cypress-io/cypress #8488](https://github.com/cypress-io/cypress/issues/8488) | macOS 10.15、CentOS 7 | 项目 `.npmrc` 设 `CYPRESS_INSTALL_BINARY=0`；CI 想用空环境变量恢复自动下载，但 falsy 判断忽略空值，npm config 继续获胜。 | `CONFIG_PRECEDENCE` | `observe` | 上游后续版本修复了行为，但原始错误不显示赢家来源或 falsy 分支；实际安装/下载需要网络，因此它适合作为优先级回归 fixture，而非对真实环境做 proof。 |
| C4 | [electron-userland/electron-builder #3058](https://github.com/electron-userland/electron-builder/issues/3058) | POSIX（由 `/work/...` 路径推断） | 复用生成的 effective config 会校验失败；`extends` 的父配置合并把 files filter 嵌套成错误结构。 | `CONFIG_PRECEDENCE` | `proof`（Linux fixture） | 错误只描述最终 schema 不合法，没有指出哪个父/子来源造成嵌套；需要开 DEBUG 后人工检查 YAML，适合固定版本离线 fixture 验证一项 merge 干预。 |
| C5 | [vitejs/vite #1930](https://github.com/vitejs/vite/issues/1930) | Windows 10 x64、Node 12.20.1、npm 6.14.10 | `.env` 值在应用的 dev/build 阶段可用，在 `vite.config.js` 求值时却是 `undefined`；用户改用 `dotenv-flow` 绕过。 | `CONFIG_PRECEDENCE` | `proof`（Linux fixture；Windows live host 仅 observe） | `undefined` 没有解释配置求值阶段和加载顺序；额外 loader 复制出第二套语义，而不是展示每个值在哪一阶段、从哪个源进入。 |
| C6 | [remix-run/remix #7934](https://github.com/remix-run/remix/issues/7934) | 未说明 | Remix 2.2/Vite 项目中，`.env` 的 `TEST`、`REMIX_TEST` 在 server loader 的 `process.env` 中均为 `undefined`，而 `import.meta.env.VITE_TEST` 有值。 | `CONFIG_PRECEDENCE` | `proof`（Linux fixture） | 同一个文件在不同 API/阶段呈现不同结果，原始错误没有 phase-specific provenance；可以用固定版本 fixture 验证单一加载桥接，但不应把所有变量无差别复制并改变暴露边界。 |

## D. NATIVE_ABI_ARCH_MISMATCH（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|
| N1 | [nodejs/node-gyp #3045](https://github.com/nodejs/node-gyp/issues/3045) | x64 构建机 → Raspberry Pi arm64 目标；host OS 未说明 | `node-gyp ... --arch=arm` 及其他值仍产出 x86-64 制品，只有 ia32 表现不同。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 评论建议设置 cross compiler，但依赖外部工具链；没有自动比对目标契约、编译器选择和产物 machine type，不能在 V1 安全 A/B/A。 |
| N2 | [lovell/sharp #3159](https://github.com/lovell/sharp/issues/3159) | Alpine Linux musl 构建机；目标 Linux glibc 与 Windows x64 | `npm install --arch=x64 --platform=linux sharp` 表面成功，却选择 `linuxmusl-x64`，与 glibc 目标不匹配。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | “安装成功”掩盖 libc 维度；现有处置没有在运行前同时报告 host libc、target libc 与所选预编译包，真正验证还涉及跨平台包获取。 |
| N3 | [WiseLibs/better-sqlite3 #1393](https://github.com/WiseLibs/better-sqlite3/issues/1393) | macOS（由 `/Users/...` 推断）、Node 22.18、Electron 37.3.1 | 原生模块按 `NODE_MODULE_VERSION 127` 编译，Electron 要求 136；`pnpm rebuild` 显示完成却仍错误，因为它按系统 Node 而非 Electron 重建。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 通用错误建议“rebuild/reinstall”，恰好会继续选错 runtime；维护者指向 Electron 工具，但没有展示实际 `.node` 产物来源、ABI 与可回滚复验。 |
| N4 | [electron/rebuild #886](https://github.com/electron/rebuild/issues/886) | 未说明 | `electron-rebuild` 内置的旧 `node-abi` 缺少 Electron 15 映射，生成 ABI 89，而运行时需要 98；绕法是 dependency-resolution override 到新版 `node-abi`。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 绕法被报告者称为不适合长期使用，会改依赖图；流程没有验证最终 `.node` header/ABI，也没有恢复步骤，原生 rebuild 超出首个 proof slice。 |
| N5 | [Automattic/node-canvas #2156](https://github.com/Automattic/node-canvas/issues/2156) | Windows 11、Node 18.12.1、Electron 21.0.1 | hello-world Electron 项目加载的 canvas 是 ABI 108，Electron 要求 109；报告者已尝试文档和既有 issue 中的 rebuild/install 指令仍失败。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 错误没有区分系统 Node ABI 与 Electron ABI，也未指出实际被加载制品的路径和构建者；Windows native backend 不在 V1 proof 范围。 |
| N6 | [microsoft/node-pty #860](https://github.com/microsoft/node-pty/issues/860) | Linux arm64 GitHub runner | 路径名是 `prebuilds/linux-arm64/pty.node`，实际 ELF 却是 x86-64；loader 误报 `Cannot find module`，手工 `file` 才揭示架构不匹配。 | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 表面错误把调查引向路径、双斜杠和权限，文件名又提供错误暗示；V1 可指纹识别产物，但获取/构建正确发布制品不属于安全单变量 proof。 |

## 完整性检查

| 检查项 | 结果 |
|---|---|
| 直接 Issue/Discussion 页面 | 24 |
| 不同 `owner/repo` | 24 |
| 每类样本 | 6 / 6 / 6 / 6 |
| 搜索结果页计入案例 | 0 |
| `proof / observe / refuse` | 7 / 15 / 2 |
| 重复 URL | 0 |

已关闭或已修复的 issue 仍可作为**历史需求与回归 fixture**，但不得据此宣称相应 bug 在最新版仍存在。组织相同但仓库不同（如 `pnpm/pnpm` 与 `pnpm/action-setup`）按仓库维度分别计数。

## 跨案例发现：V1 应优先输出什么

1. **错误经常指错层。** lockfile “损坏”、`Cannot find module`、建议 `npm rebuild` 或“命令不存在”，实际可能分别是 manager 版本、ELF 架构、Electron ABI 或 PATH 赢家错误。
2. **现有 workaround 经常一次改多个变量。** 重装、删缓存、全局安装、绝对路径和修改全局 manager 配置会破坏因果归因，也缺少恢复证据。
3. **最小且高价值的统一输出是 provenance。** PATH 类列候选与父/子进程赢家；runtime 类列当前可执行文件、manager 状态与所有项目声明；config 类列每个值的来源、阶段与覆盖关系（必须脱敏）；native 类列 runtime ABI/arch/platform/libc 与实际加载制品的 header/路径。
4. **`observe` 不是失败。** 本批 15/24 不应被 V1 自动“修复”，但可把数小时的猜测缩短成一个明确的不一致报告；这与产品的 trust boundary 一致。
5. **进入 `proof` 的门槛不能降。** 只有当 fixture 离线可复现、一次只改一个类型化变量、能恢复到 A、且信号确定时，才能升级；仅匹配相同错误字符串不构成证明。

## 抽样偏差与不能外推的结论

- **配额偏差：**四类人为各取 6 例，不能用本表推断四类问题的真实发生比例。
- **平台偏差：**PATH/Electron 案例偏 macOS、Windows，CI/native 案例偏 Linux；ARM、libc 和桌面会话的覆盖并不均匀。
- **可见性偏差：**只包含公开、可索引、英文为主的 GitHub 页面；排除了私有企业仓库、已删除帖子、聊天记录、中国开发者社区和未提交 issue 的失败。
- **报告者偏差：**能提供日志或最小复现的技术用户被过度代表；新手遇到同类问题后直接放弃的情况几乎不可见。
- **关键词偏差：**通过错误字符串、工具名和 mismatch/precedence 等词发现候选，会偏向已有诊断语言、热门仓库和容易复现的问题。
- **解决状态偏差：**有维护者回复、已关闭或已有 workaround 的帖子更易搜索到；真正无回复的长尾问题被低估。
- **时间偏差：**这是 2026-08-15 的页面快照；评论、重定向、issue 状态与上游行为此后可能变化。
- **平台标注不完备：**若帖子未声明 OS，本表没有凭经验强行补全；少数仅由路径推断的平台已显式标注。
- **“回答不足”是产品差距判断，不是用户研究：**没有测量解决耗时、成功率或用户是否接受 workaround，后续仍需访谈/可用性测试。
- **没有市场规模证据：**本批未使用搜索量、npm 下载量、issue 去重数量或星标转化数据，因此不能据此预测 GitHub stars、下载量或付费意愿。

