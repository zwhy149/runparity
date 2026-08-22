# RunParity 真实需求证据审计：第二批（Tranche 2）

审计日期：2026-08-15

## 结论先行

本批新增 **24 个公开 GitHub Issue/Discussion、24 个不同仓库**；与 `demand-audit-tranche-1.md` 的 24 个 `owner/repo` **交集为 0**，两批合计 48 个不同仓库。四类仍各取 6 例。

V1 保守裁决为：

- `proof`：11 例。仅表示能在离线、一次性 Linux fixture/backend 中做单变量 A/B/A；不授权修改用户真实环境。
- `observe`：13 例。能输出候选、赢家、声明源、运行时或制品指纹，但 GUI、Windows/macOS、CI、云平台、跨架构与原生工具链使安全 proof 不成立。
- `refuse`：0 例。本批没有纳入必须依赖真实凭据、私有 registry 或 live service 写操作的案例；不应为追求类别分布而人为把 `observe` 改成 `refuse`。

新增的“用户原话式搜索意图”是对帖子问题的**短语化意译**，用于设计 README、CLI help 与 fixture 名称；它不是逐字引文，也不是搜索量数据。

## 纳入与裁决规则

1. 每例均为已直接打开核验的公开 GitHub Issue/Discussion；搜索结果只用于发现，未计作案例。
2. 每例需有实际症状、复现、日志、确定性配置计算或维护者定位；仅有泛泛观点不纳入。
3. 本批内部按 `owner/repo` 去重，并与 tranche 1 的仓库集合做差集检查。
4. 平台未写明时不猜测；只有日志路径足够明确时才标注“推断”。
5. `proof` 必须可离线固定依赖、一次只改一个类型化变量、恢复到 A，并得到确定信号。仅能解释或复现错误不等于 proof。
6. “现有处置缺口”指缺少可移植、可自动化、可回滚的 provenance/A-B-A 证据，不代表维护者回答错误。

## A. PATH_SHADOWING（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 用户原话式搜索意图（意译） | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|---|
| T2-P1 | [microsoft/vscode #73166](https://github.com/microsoft/vscode/issues/73166) | macOS、NVM、VS Code integrated terminal | 外部 shell 使用项目期望版本，VS Code 新开的集成终端总回到 NVM default；手动 `nvm use` 仅维持到下一次重启。 | “VS Code 终端为什么不读取 `.nvmrc`？” | `PATH_SHADOWING` | `observe` | GUI 启动环境、login shell 与 integrated terminal 继承链没有被统一展开；手动切换不持久，V1 也不应改写 macOS/VS Code 启动设置。 |
| T2-P2 | [direnv/direnv #253](https://github.com/direnv/direnv/issues/253) | Windows Git Bash / MinGW | Git Bash 原本使用 `/c/...` 和冒号分隔 PATH；Windows 版 direnv 处理 `.envrc` 后输出 `C:\...;...`，随后 `ls`、`which` 等命令也可能失去可执行路径。 | “direnv 为什么把 Git Bash 的 PATH 弄坏了？” | `PATH_SHADOWING` | `observe` | 讨论只能按 Cygwin/MinGW/原生 Windows 猜运行上下文；缺少转换前后逐项 provenance 与 shell dialect 判定，Windows backend 不适合 V1 干预。 |
| T2-P3 | [asdf-vm/asdf-nodejs #434](https://github.com/asdf-vm/asdf-nodejs/issues/434) | Linux（由 `/home/arch` 推断） | `.tool-versions` 选择 Node 22.13.0，其内置 npm 是 10.9.2；`which npm` 又确实指向 asdf shim，但运行结果却是 npm 11.6.3，多位同事的 lockfile 因此产生差异。 | “asdf 的 npm shim 为什么还是跑错版本？” | `PATH_SHADOWING` | `proof`（Linux fixture） | “shim 路径正确”仍不能回答 shim 最终 dispatch 到哪里；需同时展示 shim、目标脚本、Node image 和版本，并在一次性 fixture 中以一次 reshim/target 更改完成 A/B/A。 |
| T2-P4 | [pypa/virtualenv #2340](https://github.com/pypa/virtualenv/issues/2340) | Ubuntu 22.04 LTS x86_64 | `virtualenv --creator=venv` 生成 `env/bin` 与 `env/local/bin` 两套 activation；激活前者得到环境内 Python + 用户目录 pip，激活后者又得到系统 Python + 环境内 pip。 | “激活 venv 后为什么 Python 和 pip 不属于同一环境？” | `PATH_SHADOWING` | `proof`（固定版本 Linux fixture） | 单独看 `python --version` 或 `pip --version` 都可能像正常；需要成对解析 executable、shebang 与 sysconfig 路径，并以唯一 activation/creator 变化复验。 |
| T2-P5 | [pyenv/pyenv #2348](https://github.com/pyenv/pyenv/issues/2348) | Ubuntu 22.04 amd64 | `pyenv global 3.9.12` 后 Python 正确，`pip` 却仍命中 `~/.local/bin/pip`；pyenv 安装目录内明明存在对应 pip。 | “pyenv 切了 Python，为什么 pip 还是用户目录那个？” | `PATH_SHADOWING` | `proof`（Linux fixture） | 现有调查依赖逐个执行 `which`；没有把 pyenv shim、用户级 executable、脚本 shebang 与目标解释器连成一条链，也没有安全验证 PATH 单项调整。 |
| T2-P6 | [microsoft/vscode-python #23493](https://github.com/microsoft/vscode-python/issues/23493) | macOS Darwin x64、VS Code、zsh | `python.defaultInterpreterPath` 按 `${workspaceFolderBasename}` 指向各项目 venv，但切换文件夹后扩展沿用先前显式选择/启动时激活的解释器；日志同时出现多个不同 Python 路径。 | “VS Code 切项目后为什么还用上一个项目的 Python？” | `PATH_SHADOWING` | `observe` | 设置值、扩展持久状态、启动环境、terminal activation 与 language server 进程各自有赢家；仅重选解释器不能解释优先级，GUI 状态也超出 V1 proof。 |

## B. RUNTIME_MANAGER_DRIFT（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 用户原话式搜索意图（意译） | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|---|
| T2-R1 | [nvm-sh/nvm #2797](https://github.com/nvm-sh/nvm/issues/2797) | macOS 11.5.2、Apple Terminal、zsh | `nvm use 16` 后当前 shell 是 16.14.2；关闭并新开终端又回到 14.18.2，用户不清楚“当前选择”和“新 shell 默认值”的区别。 | “`nvm use` 成功后，新终端为什么又变回旧 Node？” | `RUNTIME_MANAGER_DRIFT` | `proof`（Linux fixture） | 常见回答只说 `nvm use` 是会话级或让用户设 default；缺少当前 shell、default alias、`.nvmrc` 与启动脚本的 winner trace，可在 disposable shell fixture 中单改 default 做 A/B/A。 |
| T2-R2 | [python-poetry/poetry #5190](https://github.com/python-poetry/poetry/issues/5190) | Windows 10/WSL2、Manjaro；讨论另含 macOS | pyenv 当前已从 Python 3.9.9 切到 3.8.5，Poetry 新建的环境仍使用安装 Poetry 时的 3.9.9；另有日志声称选择 3.9.7，实际 `.venv` 却是 3.10。 | “Poetry 为什么不用 pyenv 当前选中的 Python？” | `RUNTIME_MANAGER_DRIFT` | `proof`（Linux fixture） | `poetry env use` 是有效但手工的补救，用户甚至修改 `pyvenv.cfg` 与 symlink；现有输出没有分清 Poetry 自身 runtime、候选 interpreter、项目约束和最终 venv runtime。 |
| T2-R3 | [astral-sh/uv #7118](https://github.com/astral-sh/uv/issues/7118) | 未明确；帖子提及 Homebrew CPython | 安装后遗忘的 uv-managed PyPy 3.9 抢先于 PATH 中的 CPython 3.9；`uv venv --python python3.9` 只打印“Python 3.9.19”，没有说明实现类型。 | “uv 指定 `python3.9` 为什么选成了 PyPy？” | `RUNTIME_MANAGER_DRIFT` | `proof`（Linux fixture） | 版本号相同掩盖 implementation 与来源优先级；卸载 PyPy能改变结果却是破坏性处置，应以候选排序、implementation 字段和显式单项 selector 做 A/B/A。 |
| T2-R4 | [nodejs/corepack #560](https://github.com/nodejs/corepack/issues/560) | macOS/Homebrew（`/opt/homebrew`） | 开启 `COREPACK_ENABLE_AUTO_PIN=1`、重装 Corepack/Node 后，项目仍不写 `packageManager`；维护者最终发现 `$HOME/package.json` 已定义该字段并被向上发现。 | “Corepack 为什么不给当前项目写 `packageManager`？” | `RUNTIME_MANAGER_DRIFT` | `proof`（Linux fixture） | 重装完全没有触及祖先配置；普通输出只显示 LastKnownGood pnpm，不展示向上搜索到的项目根和 pin 来源。可在 fixture 中只加入/移除祖先 `package.json` 验证。 |
| T2-R5 | [denoland/deno #31130](https://github.com/denoland/deno/issues/31130) | macOS Tahoe 26.0.1 Intel + GitHub Actions | `deno upgrade` 把本机 2.5.4 判断为最新，显式指定 2.5.5 才成功；CI 又同时提供 `.dvmrc` 2.5.5 与 `deno-version: 2.x`，setup action 无法解析。 | “Deno 明明有新版本，为什么 upgrade 和 CI 都选不到？” | `RUNTIME_MANAGER_DRIFT` | `observe` | 本机 release channel、远端元数据、version file 与 action input 同时参与；真实复验依赖网络和 CI，V1 最多报告声明冲突与已安装版本，不能离线证明上游发布状态。 |
| T2-R6 | [vercel/vercel Discussion #8238](https://github.com/vercel/vercel/discussions/8238) | Vercel 云构建；本地 OS 未说明 | 用户希望固定 Node 16.16.0，但平台仅保证 major 并可能滚动 minor/patch；`package.json#engines` 还会覆盖 Project Settings 选择。 | “Vercel 怎么锁死精确 Node 版本？” | `RUNTIME_MANAGER_DRIFT` | `observe` | 平台按策略升级并有多处声明，回答“只能固定 major”不能帮助复现本地/CI exact runtime；外部平台选择无法由 V1 干预，只能明确 effective contract 与不可证明边界。 |

## C. CONFIG_PRECEDENCE（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 用户原话式搜索意图（意译） | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|---|
| T2-C1 | [docker/compose #9737](https://github.com/docker/compose/issues/9737) | GitHub Actions；host OS 未说明 | Compose 2.9.0 中 `.env` 的 `bar` 覆盖命令前注入的 shell 值 `foo`，与 2.7.0 行为相反；维护者随后承认该变化反直觉并回退。 | “为什么 shell 环境变量覆盖不了 Docker Compose 的 `.env`？” | `CONFIG_PRECEDENCE` | `observe` | 临时建议把每个值写成 `${VAR:-default}` 会改写全部配置；真正复验依赖 Docker/CI，V1 应先展示版本、shell、`.env` 与插值 winner，而非启动容器。 |
| T2-C2 | [motdotla/dotenv #501](https://github.com/motdotla/dotenv/issues/501) | 未说明；Create React App / Node preload | `.env` 看似突然“不加载”；讨论中的具体原因之一是目标键已存在于 `process.env`，dotenv preload 默认不覆盖，另有 CRA 前缀规则参与。 | “dotenv 为什么读了 `.env` 却还是旧值？” | `CONFIG_PRECEDENCE` | `proof`（脱敏 Linux fixture） | DEBUG、CRA 前缀与 `override` 分散在不同回答；需对值做脱敏后报告“文件已读但 ambient env 获胜”，并只切换一次 override 策略验证，不能打印 secret 内容。 |
| T2-C3 | [microsoft/TypeScript #57486](https://github.com/microsoft/TypeScript/issues/57486) | 跨平台；monorepo 示例 | 子 `tsconfig` 写入自己的 `paths`/`typeRoots` 后，父配置中的对象/数组整体被覆盖而非合并；多层 monorepo 只能复制配置、扩大 root 配置或加脚本。 | “`tsconfig extends` 为什么把父级 `paths` 全覆盖了？” | `CONFIG_PRECEDENCE` | `proof`（Linux fixture） | 当前行为有定义但 computed config 不直观；workaround 容易漂移。V1 可静态生成来源级 diff，并仅移除/改写一个 child key 做 A/B/A，无需提出新的 merge 语法。 |
| T2-C4 | [prettier/prettier-vscode #3442](https://github.com/prettier/prettier-vscode/issues/3442) | Linux（`/home/...`）、VS Code | 用户设置了绝对路径、`${userHome}` 或 `${env:XDG_CONFIG_HOME}` 的 `prettier.configPath`，扩展仍回退默认值；同一配置文件在其自身目录又可被发现。 | “VS Code Prettier 为什么忽略 `configPath`？” | `CONFIG_PRECEDENCE` | `observe` | 日志显示 fallback，却不把变量展开、workspace trust、local config 与 extension setting 的优先级连成一条链；GUI 扩展宿主不适合 V1 自动改设置。 |
| T2-C5 | [webpack/webpack #2537](https://github.com/webpack/webpack/issues/2537) | 未说明；讨论含 Windows 示例 | `webpack -p` 会对 bundle 应用 production 优化，却不让 `webpack.config.js` 求值阶段的 `process.env.NODE_ENV` 变成 production；大量用户把编译期替换误认为进程环境。 | “为什么 `webpack -p` 了，配置里的 `NODE_ENV` 还是空？” | `CONFIG_PRECEDENCE` | `proof`（固定旧版 Linux fixture） | workaround 包括 CLI 显式设 env、检查 argv 或 `--env`，容易一次改变多个语义；V1 应区分 config-evaluation 与 bundle-define 两个阶段并做单输入复验。 |
| T2-C6 | [babel/babel Discussion #12605](https://github.com/babel/babel/discussions/12605) | 未说明；Webpack/Babel CLI 复现 | `.babelrc` 未作用于另一个 package boundary 下的 `@babel/runtime`，Promise polyfill 没进入产物；改为 project-wide `babel.config.json` 后才出现，因为 `.babelrc` 搜索在 package root 停止。 | “为什么 Babel 的 `.babelrc` 不处理 `node_modules` 里的 runtime？” | `CONFIG_PRECEDENCE` | `proof`（固定版本 Linux fixture） | “不要 exclude runtime”仍不足，因为文件范围本身可能阻止配置生效；需要输出 config search boundary、适用文件和最终插件集，再只切换 config scope 验证。 |

## D. NATIVE_ABI_ARCH_MISMATCH（6/6）

| ID | 直接证据 / 仓库 | 平台 | 症状 | 用户原话式搜索意图（意译） | 类别 | V1 裁决 | 为何现有回答/处置仍不足 |
|---|---|---|---|---|---|---|---|
| T2-N1 | [anthropics/claude-code #29661](https://github.com/anthropics/claude-code/issues/29661) | macOS Apple Silicon arm64 | 安装第一阶段下载正确 Mach-O，第二阶段在 darwin-arm64 路径拿到的却是 Linux ARM64 ELF；symlink 后执行报 `exec format error`，checksum 与 Linux manifest 项吻合。 | “Apple Silicon 上为什么装到 Linux ELF 版 CLI？” | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 重跑安装只在上游对象已纠正后偶然有效；V1 可在执行前核对 path label、header 与 checksum，但无法证明或修复外部发布桶内容。 |
| T2-N2 | [yarnpkg/yarn #9058](https://github.com/yarnpkg/yarn/issues/9058) | Windows 构建机 → Linux/Raspberry Pi 目标 | 用户在 Windows 生成供树莓派运行的 `node_modules`，到目标机加载 sqlite3 时得到 `invalid ELF header`；在树莓派本机安装则正常。 | “Windows 装好的 `node_modules` 放到树莓派为何报 invalid ELF？” | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | “在目标机重装”能绕开却不解释 install platform flags、产物 header 与目标 arch/libc 的组合；跨平台安装、下载或编译超出安全 proof。 |
| T2-N3 | [openclaw/openclaw #42697](https://github.com/openclaw/openclaw/issues/42697) | macOS 15.3.1、Apple M3 Pro、native arm64 Node | `uname`、`arch`、`process.arch` 与 Node Mach-O 都显示 arm64，依赖的 postinstall 却报告 darwin/x64 并拒绝安装；清缓存、重装、强制 `arch -arm64` 均无效。 | “所有检查都是 arm64，postinstall 为什么认成 x64？” | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 现有尝试反复改缓存与安装状态，仍未记录 postinstall 实际子进程、检测输入和预编译包候选；macOS/native build chain 不适合 V1 proof。 |
| T2-N4 | [tobi/qmd #319](https://github.com/tobi/qmd/issues/319) | 未说明；Unix shebang、Bun + nvm Node 示例 | `bun install -g` 把 better-sqlite3 编成 Bun ABI 141，但 CLI shebang 是 `/usr/bin/env node`，运行时命中 Node 22 ABI 127，所有命令都 `ERR_DLOPEN_FAILED`。 | “Bun 全局安装成功，CLI 为什么一运行就 ABI 不匹配？” | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 改用 npm 或加入 runtime wrapper 都是有状态分发变更；V1 可同时报告 installer runtime、shebang winner 和 `.node` ABI，但不应替项目选择长期 launcher 策略。 |
| T2-N5 | [OHF-Voice/linux-voice-assistant Discussion #246](https://github.com/OHF-Voice/linux-voice-assistant/discussions/246) | Raspberry Pi 2B、armhf/armv7l 32-bit Linux | 标为 `linux_armv7l` 的 Python wheel 内仍装入 x86-64 `libtensorflowlite_c.so`，加载时报 `wrong ELF class: ELFCLASS64`；上游根本没有 armhf build。 | “armv7 wheel 为什么带 x86-64 的 `.so`？” | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 指南可以手工替换/自行编译，但需要第三方源码和工具链；V1 最可靠的价值是安装前比较 wheel tag、ELF machine/class 与 host，不能生成缺失制品。 |
| T2-N6 | [puppeteer/puppeteer #10172](https://github.com/puppeteer/puppeteer/issues/10172) | Debian/Raspberry Pi ARMhf 或 ARM64、Node 20.1 | Puppeteer 在 ARM 主机仍下载 x86-64 Chrome；`file` 明确显示 ELF x86-64，最终只报笼统的 browser process 启动失败。 | “Puppeteer 在 ARM 上为什么下载 x86 Chrome？” | `NATIVE_ABI_ARCH_MISMATCH` | `observe` | 上游把问题归为无可用 ARM binary/重复议题；V1 可把“启动失败”前移成下载物架构检查，但选择系统 Chromium、第三方包或模拟器是产品策略，不能自动干预。 |

## 完整性检查

| 检查项 | 结果 |
|---|---|
| 本批直接 Issue/Discussion 页面 | 24 |
| 本批不同 `owner/repo` | 24 |
| 与 tranche 1 仓库交集 | 0 |
| 两批累计不同仓库 | 48 |
| 每类样本 | 6 / 6 / 6 / 6 |
| 搜索结果页计入案例 | 0 |
| 本批 `proof / observe / refuse` | 11 / 13 / 0 |
| 本批重复 URL | 0 |

关闭、重复或已修复的 issue 仍可作为历史需求和回归 fixture，但不代表最新版仍有相同 bug。仓库唯一不等于底层原因独立：例如 wrapper 项目可能最终指向同一个 runtime 或 native dependency；本表没有把这种关联错误地当成 24 种根因。

## 第二批对产品假设的增量修正

1. **问题并非 Node 专属。** Python 的 `python`/`pip` 配对、Poetry/pyenv/uv 的解释器选择与 Node manager 漂移呈同一结构：声明的版本、实际 executable 和创建环境时的 runtime 可能分别来自不同源。
2. **仅显示版本号不够。** CPython 与 PyPy 可共享“3.9”，arm64 ELF 与 arm64 Mach-O 也共享“arm64”；报告至少还需 implementation、binary format、ABI、libc、来源路径和选择阶段。
3. **搜索边界本身是一等配置来源。** Corepack 向上找到 `$HOME/package.json`、Babel 在 package boundary 停止、TypeScript child object 整体覆盖 parent；effective config 必须输出“在哪里开始/停止查找”。
4. **GUI/CI/云平台需要明确降级为 observe。** VS Code、GitHub Actions、Vercel 与外部发布桶能提供高价值事实，但不应为了展示“自动修复”而跨越主机或服务边界。
5. **用户搜索语言多从表面症状开始。** “装了还是旧版”“invalid ELF”“配置被忽略”“Python 和 pip 不一致”比抽象术语 `PATH_SHADOWING` 更适合 README 标题、issue form 提示与 fixture 名称；CLI 内部仍应保留稳定的类型化 family。

## 抽样偏差与不能外推的结论

- **配额偏差：**四类人为各取 6 例，只用于覆盖检查，不能推断真实发生比例。
- **跨生态扩展偏差：**为检验结构是否可迁移，本批主动加入 Python、Docker、TypeScript、Babel 与浏览器二进制分发；这会高估跨语言通用性相对首个 Node-focused V1 的即刻价值。
- **JavaScript 仍占多数：**即使扩展生态，GitHub 可检索样本仍明显偏 Node/JavaScript 工具链。
- **平台偏差：**PATH/config 样本偏 macOS、Windows 与 GUI，native 样本偏 ARM/Raspberry Pi；常规 x64 Linux 的“安静失败”覆盖不足。
- **公开与语言偏差：**仅包含公开、可索引、英文为主的 GitHub 页面，排除私有企业仓库、中文社区、Discord/Slack、删除内容和未上报失败。
- **可诊断性偏差：**含日志、`which`、`file`、ABI 数字或最小复现的帖子更容易入选；新手只描述“不能用”或直接放弃的样本被低估。
- **关键词偏差：**检索围绕 wrong version、PATH、ignored config、ABI、ELF、arm64 等已知术语，可能遗漏完全不同措辞和非技术用户搜索。
- **年代偏差：**本批混合历史行为与 2025–2026 案例，适合 fixture 多样性，不适合判断当前版本缺陷率。
- **解决状态偏差：**已关闭、已有 maintainer 定位或 workaround 的案例更易验证；长期无回复问题被低估。
- **依赖关联偏差：**不同 `owner/repo` 可能由同一底层依赖或平台机制触发，因此 24 个仓库不能等同 24 个独立根因。
- **裁决偏差：**`proof` 按“可在 disposable Linux fixture 证明”判定，不表示原帖所在 macOS/Windows/CI 环境可被安全修改；`refuse=0` 是本批选题结果，不是产品无需拒绝机制。
- **搜索意图非搜索数据：**短语是研究者基于帖子意译，不是用户逐字查询，也没有 Google/GitHub 搜索量、点击率或转化率支持。
- **无市场规模推断：**即使两批达到 48 个不同仓库，也不能据此预测 GitHub stars、npm 下载量、留存、付费意愿或总可服务市场。
- **时间快照：**页面内容与状态截至 2026-08-15；上游修复、重定向、评论或发布物之后可能变化。

