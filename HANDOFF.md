# RunParity handoff

> Snapshot date: 2026-08-22 (Asia/Shanghai), second update  
> Workspace: `C:\Users\wmy\Documents\Codex\2026-08-15\0-2`  
> Current version: `0.0.0`, private source prototype, **pre-S0, first verified case**  
> This document is the single source of truth for a new conversation with no
> prior context. Read it fully, then `AGENTS.md`, `CONTEXT.md`, and
> `docs/adr/0001-*.md` through `0005-*.md` before changing behavior.

---

## 0. One-paragraph answer to "where are we" (做到哪里了)

RunParity 在 2026-08-22 第二轮完成了**从 0 到 1 的证据管线闭环**：在 WSL2 的
KVM 上构建了一台**独立 QEMU 全虚拟机**（Ubuntu 24.04.4、自己的内核与
systemd、非 root 账号 uid 1000、rootless Podman 4.9.3），对其跑通了
**十一项控制的后端资格探针电池**（全部 demonstrated，含用宿主内核
/proc 真相绑定嵌套用户命名空间的父视图），然后在该合格后端上真实执行了
`DEV-PATH-001` 的 **(A1→B→A2)×3 隔离实验**：6 个 A 臂复现同一失败签名
（exit 23 + `RP_FIXTURE_WRONG_NODE_PATH`），3 个 B 臂在恰好一个
`path.prepend` 干预下通过冻结 oracle（`RUNPARITY_OK:dev-path-001`），账本经
仓库验证器**独立重算**（签名、oracle、单增量 diff、安全标志）后接受
`fixture_status: verified`。语料现为 **0 scaffold / 15 implemented / 1
verified**。剩余工作是把其余 11 个 supported positives 逐一通过同一管线、
S0/S1 门、以及 npm 公开化——不再有任何"缺真实后端"类阻断。

## 1. What changed this round (本轮完成什么)

1. **Stage B 后端环境（真实）**：`work/vm/setup-vm.sh` 在 WSL2
   `/dev/kvm` 上以 `qemu-system-x86_64 -enable-kvm -cpu host` 启动
   noble cloud image（overlay qcow2 40G，cloud-init 注入用户 `rp` +
   subuid/subgid 100000:65536 + podman 4.9.3），hostfwd
   `127.0.0.1:2222→22`。VM 不是 WSL 发行版本身；hypervisor 链在收据里
   作为**声明**记录（`declaration_only: true`），隔离控制全部在 VM 内
   实证。
2. **Stage C 资格管线（产品代码）**：
   - `src/backend/remote-command.ts`：远程 argv 惰性方言白名单
     `/^[A-Za-z0-9_@%+=:,./-]+$/u`，传输永不转义/插值；
   - `src/backend/ssh-backend-transport.ts`：复用共享监督生命周期
     （单绝对 deadline、有界流、诚实清理标签）；
   - `src/backend/arm-isolation-policy.ts`：冻结 arm 旗标策略
     （network none / cap-drop ALL / no-new-privileges / read-only /
     keep-id:uid=10001 / pids 64 / memory 512MiB / cpus 1 / tmpfs /
     ro 资产挂载 / per-arm 可写 HOME / podman --timeout），canonical
     digest 绑定一切收据；
   - `src/backend/probes/*.mjs`：容器内事实探针（只写、网络、凭据、
     限额、分离后代、跨臂新鲜度）；
   - `src/backend/qualification-collector.ts` + `qualification-policy.ts`
     + `qualification-receipt.ts`：事实→判定→收据三段分离，11 项控制
     全部 demonstrated 才 qualified。
3. **Stage D 实验运行器（产品代码）**：
   `src/experiment-runner/`：`isolated-arm-runner.ts`（每臂新建即毁、
   归一化 argv 供差分）、`failure-signature.ts`（跨臂稳定签名，剔除
   时间/PID/容器名）、`oracle-evaluator.ts`、`proof-ledger.ts`、
   `proof-ledger-verifier.ts`（**唯一**能产出 VERIFIED_INTERVENTION 的
   模块，全部重算）、`path-family.ts`（PATH 族执行适配）。
4. **Stage E 验证通道（协议修正，ADR-0005）**：
   `fixtures/lib/evidence-verifier.mjs` 独立实现（与 runner 零共享代码）
   重算签名/oracle/单增量/A1≡A2/安全；`validate.mjs` 两处硬拒绝替换为
   真实验证；**账本绑定 manifest 的证据投影摘要**（canonical JSON 剥离
   四个晋升字段），晋升不再使绑定失效。
5. **收据工件（真实，已入库）**：
   - `fixtures/receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json`
     （+.facts.json 侧车）；
   - `fixtures/receipts/ledger/DEV-PATH-001.json`；
   - `fixtures/development/cases/DEV-PATH-001.json` 晋升 verified。
6. **驱动 CLI**：`src/fixtures-cli.ts`（`backend qualify` / `case run
   [--verified-at]` / `suite status`），仅维护者侧（tsx 运行，不进公共
   bin——artifact 测试断言 bin 只有 runparity）。
7. **文档**：ADR-0005、CONTEXT.md 契约状态段、docs/CLI.md、
   docs/VALIDATION.md、README.md、fixtures/README.md、index.json
   truthful_status_note 全部同步到 1 verified 现实。
8. **技能**：superpowers 的 test-driven-development、
   systematic-debugging、verification-before-completion、
   finishing-a-development-branch 已装入 `~/.zcode/skills/`。

## 2. Reproduction (如何复现/续跑)

VM 持续运行（WSL 内 qemu，pid 见 `/root/rp-backend-vm/qemu.pid`）。密钥
`C:/Users/wmy/.ssh/rp_backend_vm_key`，known_hosts
`C:/Users/wmy/.ssh/rp_backend_vm_known_hosts`，配置
`work/vm/backend-config.json`。若 VM 不在了：WSL 内
`bash /root/rp-backend-vm/setup-vm.sh && bash /root/rp-backend-vm/wait-vm.sh`，
再 `work/vm/prep-remote.sh`（资产/探针/密钥），镜像
`docker.1ms.run/library/node:22-bookworm-slim`（digest 见配置）。

```powershell
cd C:\Users\wmy\Documents\Codex\2026-08-15\0-2
$env:PATH = "C:\Users\wmy\AppData\Local\rp-tools\node_modules\.bin;" + $env:PATH
node ./node_modules/tsx/dist/cli.mjs src/fixtures-cli.ts backend qualify --config work/vm/backend-config.json --out <receipt.json> --facts-out <facts.json>
node ./node_modules/tsx/dist/cli.mjs src/fixtures-cli.ts case run --case DEV-PATH-001 --config work/vm/backend-config.json --receipt <receipt.json> --out <ledger.json> --verified-at <manifest的verified_at>
node fixtures/validate.mjs
```

**收据链操作顺序（协议）**：先定稿 manifest（biome 格式化）→
`node work/generate-build-receipt.mjs <CASE> <entrypoint>`（绑 manifest
字节）→ `case run --verified-at <manifest.verified_at>` → 晋升 manifest
四字段。manifest 任何再改动都要从 build receipt 重来。
`fixtures/receipts/**` 已加入 biome 忽略（字节即证据，永不重排）。

## 3. Repository state (仓库状态)

- Git 分支 main，**零提交**；全部文件 untracked。禁止 `git clean` /
  `git reset --hard`。`.gitignore` 已含 `work/pack-output/`。
- Windows 控制器 Node 24.15.0 + 独立 pnpm 11.19.0（DSH 坏 shim 坑仍
  在，见 §6）；Ubuntu 门 Node 22.22.1（`/root/runparity-linux` tar 镜像）。
- 最近一次双平台门：Windows vitest 全绿 + validator 0/15/1；Ubuntu
  vitest 340 过 / 22 跳过 / 0 失败（重同步后）。

## 4. What is finished (做完了啥)

- 上一轮全部成果（Host Observe 硬化、16/16 静态资产、双平台门）保持
  有效；本轮在其上叠加 Stage B/C/D/E 全链。
- 单测：`tests/backend-remote-command.test.ts`、
  `tests/backend-arm-policy.test.ts`、
  `tests/experiment-proof-ledger.test.ts`（干净序列 VERIFIED + 7 个
  对抗篡改全拦截：改签名、双增量、B 无 delta、A2 不复现、容器残留、
  传输拒绝、status 未过）。
- validator 26/26（含新协议下的自撰收据拒绝路径）。

## 5. What is blocking now (现在卡在哪)

没有硬阻断。剩余是**体量工作**：

1. 其余 11 个 supported positives 走同一管线（每案需要：执行适配器
   扩展、重跑收据链）。PATH-002/003 最快（同族复用 path-family）；
   RUNTIME 族需 `runtime.select` 干预型（扩展 experiment-runner 的
   干预类型与差分检查）；CONFIG 族需 env/npmrc 覆盖型；NATIVE 族需
   artifact-select 型。
2. S0 聚合门（≥9/12 verified、每类 ≥2/3）→ S1 密封语料（96 例，
   独立策展）→ S2 npm 发布。
3. 挑战案例（OOS 需 Windows/macOS 实机 Host Observe 重复）保持
   PARTIAL_EVIDENCE 即可，不阻断 S0。

## 6. Pitfalls already found — do not repeat (坑清单)

### 本轮新坑（最重要）

- **ssh.exe 需 `PROGRAMDATA`**：剥离环境后 ssh 秒退 255 且无输出（即使
  `-F NUL` 也解析 `%PROGRAMDATA%\ssh\ssh_config` 路径）。传输环境已加
  SystemRoot+PROGRAMDATA 并在缺失时 fail-fast。
- **docker.io 直连被 DNS 污染**（解析到 Twitter IP）：用
  `docker.1ms.run` 镜像仓（内容寻址 digest 与上游一致；收据如实记录
  acquisition mirror）。daocloud 对大 blob 会 stall，alpine 小镜像可用。
- **`podman info` JSON 键名**：`host.idMappings` 里是小写 `uidmap/gidmap`
  （对象数组，字段 container_id/host_id/size）；镜像 `Id` 是裸 64hex 无
  `sha256:` 前缀；`-d` 输出裸容器 ID 非 JSON。解析全部已适配。
- **嵌套用户命名空间**：容器内 `/proc/self/uid_map` 的"外部 ID"以
  pod-infra ns 坐标显示（rp=0），OCI 策略正确判
  `parent_root_uid_mapped`；资格层用宿主 `/proc/<State.Pid>/status +
  uid_map` 内核真相绑定（Uid 全 1000、CapEff 0、NoNewPrivs 1、无
  real-0 映射）后才算 demonstrated。
- **挂载路径即策略常量**：资产挂载点是 `/arm/assets`（冻结于
  arm-isolation-policy），探针 target argv 必须用 `/arm/assets/...`，
  不是自定义路径。
- **`podman --timeout N`**：超时杀容器 exit 255（不是 124/143）。
- **`podman top` 不可用**（容器内无 ps、宿主 cloud image 默认无
  procps）；用 `podman inspect --format json` 取 `State.Pid` 再读宿主
  /proc。`--format {{...}}` 的花括号不在远程白名单——一律
  `--format json`。
- **wsl.exe 传引号会碎**：复杂命令一律写本地脚本文件 → `tr -d '\r'` →
  WSL 执行（`work/vm/*.sh` 模式），并加 `MSYS_NO_PATHCONV=1` 防 Git
  Bash 路径改写。
- **biome 会重排 manifest/收据**：`fixtures/receipts/**` 已进 biome
  ignore；manifest 改动后必须重跑收据链（顺序见 §2）。JSON.stringify
  的 2 空格输出 ≠ biome JSON 风格，长嵌套数组必 diff。
- **账本-晋升鸡生蛋**：账本绑 manifest 证据投影（剥 4 字段）而非整
  文件字节；`case run --verified-at` 必须与 manifest 一致。
- **并行重载会抖时长敏感测试**（DEV-CONFIG-001 npm lifecycle、
  process-tree 窗口）：全量 verify 时停掉并行 apt/qemu 重活。

### 老坑（依旧有效，节选）

- DSH 坏 pnpm shim：先
  `export PATH=/c/Users/wmy/AppData/Local/rp-tools/node_modules/.bin:$PATH`。
- 资产/清单一变，收据即失效：先 `generate-build-receipt` 再
  `validate.mjs`；验证器测试别硬编码套件计数（本 round 把 fixture-assets
  的 DEV-PATH-001 形状断言更新为 verified）。
- Host 观测永不等于隔离证明；Windows/macOS 客机 Linux≠原生；一切
  verified 必须走 ProofLedgerVerifier + 独立证据验证器双实现。
- 其余老坑（脱敏/解析器/活动对象/shim）见 git 历史里的上一版 HANDOFF
  或 docs/SECURITY-MODEL.md。

## 7. What to do next (下一步，按序)

1. 任何改动后双平台 `pnpm verify`（Windows + Ubuntu 同步命令见 §8）。
2. PATH-002/003 接入 path-family（新增 case plan：资产子目录、target
   argv、PATH 条目、干预目录）→ 跑真实实验 → 晋升。
3. RUNTIME/CONFIG/NATIVE 三族的干预类型扩展（experiment-runner 的
   intervention 类型 + 差分检查 + 证据适配器）。
4. S0 门：12 supported positives 全 verified 后按 docs/VALIDATION.md
   的 S0 指标自评。
5. S1 密封语料（96 例独立策展、双盲冻结）→ S2 npm 公开化（发
   `runparity` 包；`runparity-fixtures` 保持不入公共 bin）。
6. 每轮结束更新本 HANDOFF。

## 8. Commands for a new conversation

```powershell
cd C:\Users\wmy\Documents\Codex\2026-08-15\0-2
$env:PATH = "C:\Users\wmy\AppData\Local\rp-tools\node_modules\.bin;" + $env:PATH
pnpm verify
node fixtures/validate.mjs
node --test fixtures/validator.test.mjs
git status --short
```

Ubuntu 同步 + 验证：

```bash
wsl.exe -d Ubuntu -- bash -c "cd /mnt/c/Users/wmy/Documents/Codex/2026-08-15/0-2 && tar --exclude=node_modules --exclude=dist --exclude=.git --exclude=work/pack-output -cf - . | (cd /root/runparity-linux && tar -xf -) && cd /root/runparity-linux && pnpm verify"
```

VM 管理（WSL 内）：`/root/rp-backend-vm/setup-vm.sh`（重建）、
`wait-vm.sh`（等 cloud-init + rootless 冒烟）、`prep-remote.sh`（资产/
探针/密钥推送）、`mirror-race.sh`（镜像仓测速）、`bind-test2.sh`
（内核真相绑定冒烟）。源脚本在仓库 `work/vm/`。

## 9. Key files and where to look

| Area | Files |
| --- | --- |
| 资格/传输/策略 | `src/backend/`（remote-command、ssh-backend-transport、arm-isolation-policy、qualification-*、probes/） |
| 隔离实验/账本 | `src/experiment-runner/`（isolated-arm-runner、failure-signature、oracle-evaluator、proof-ledger(-verifier)、path-family） |
| 驱动 CLI | `src/fixtures-cli.ts`（docs/CLI.md 有契约） |
| 独立证据验证器 | `fixtures/lib/evidence-verifier.mjs` + `fixtures/validate.mjs` |
| 真实收据 | `fixtures/receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22*.json`、`fixtures/receipts/ledger/DEV-PATH-001.json` |
| VM 脚本/配置 | `work/vm/`（setup-vm、wait-vm、seed-and-spike、mirror-race、bind-test2、prep-remote、backend-config.json） |
| 架构决策 | `docs/adr/0001..0005`（0005 是本轮资格+账本 ADR） |
| 单测 | `tests/backend-*.test.ts`、`tests/experiment-proof-ledger.test.ts`、`tests/fixture-assets.test.ts` |
| 领域真相 | `CONTEXT.md`、`docs/VALIDATION.md`、`docs/CLI.md`、`docs/SECURITY-MODEL.md` |

## 10. Working style for the next conversation

小 TDD 切片：复现→红测→窄修→定向测→双平台 verify→文档只写已绿行为。
改 manifest/资产 → 重跑收据链（§2 顺序）。改 arm 策略/探针 → 重跑资格
验证 + 受影响实验。声明只到证据为止：1/12 verified 是管线证明，不是 S0
达标。

## 11. First instruction for the next conversation

> 读本 HANDOFF、`AGENTS.md`、`CONTEXT.md`、ADR-0001..0005。先跑双平台
> `pnpm verify` + `node fixtures/validate.mjs` 复绿（预期 0/15/1）。VM
> 与密钥按 §8 就绪；若 VM 已消失按 §2 重建。下一步从 PATH-002/003 接入
> path-family 开始扩展 verified 集合。任何声明不得超出已重算的证据。
