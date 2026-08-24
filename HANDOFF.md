# RunParity handoff（第七版 — v0.1.0 已公开发布）

> 快照日期：2026-08-24（Asia/Shanghai）
> 仓库：本地 `C:\Users\wmy\Documents\Codex\2026-08-15\0-2`，**已发布到 GitHub
> https://github.com/zwhy149/runparity**（main 分支；v0.1.0 发布提交 `02e552b`）
> 读完本文件 → `AGENTS.md` → `CONTEXT.md` → `docs/adr/0001..0005`，再动手。
> 本阶段目标：**已达成——`runparity@0.1.0` 已发布到 npm latest，GitHub Release
> 与全平台门禁均已完成**。

---

## 0. 一句话现状（做到哪里了）

产品、证据链、发布文档、跨平台 CI 和首个公开版本 **均已完成**：12/12 supported
positives 在真实隔离后端上得到 VERIFIED_INTERVENTION，两个平台挑战案例在
真硬件上 verified（Windows 本机 + GitHub Actions macOS），语料保持
**0 scaffold / 2 implemented / 14 verified**（2 个 implemented 是按设计只做
Host Observe 的硬负例）。S1 首批密封评测已入库，README 已按发布级仓库重排。
本地 `pnpm verify` 退出码 0；发布提交 `02e552b` 的 GitHub Actions run
[`32684989045`](https://github.com/zwhy149/runparity/actions/runs/32684989045)
已 **7/7 全绿**（Node 22/24 × Ubuntu/Windows/macOS 共 6 个矩阵任务，另加在
Node 24 与最低支持 Node 18 上执行 tarball 的 Packed CLI smoke）。npm 包
[`runparity@0.1.0`](https://www.npmjs.com/package/runparity/v/0.1.0) 已挂到
`latest`；Git 标签和 [GitHub Release v0.1.0](https://github.com/zwhy149/runparity/releases/tag/v0.1.0)
都指向 `02e552b`。从仓库树外的全新目录和全新 npm cache 执行公网
`npx runparity@0.1.0` 的 version/help/doctor 烟测均成功。

## 1. 做完了啥（全部已推送）

1. **证据管线全链（8 月 22 日）**：QEMU-KVM 独立 Ubuntu VM + rootless Podman
   4.9.3 → 11 项控制资格探针电池（含宿主内核 /proc 绑定嵌套 userns）→
   12 案 (A1→B→A2)×3 真实验证（四种单 token 干预类型：path.prepend /
   env.value / mount.source / argv.token）→ 独立验证器双实现重算 →
   validator 0/2/14。
2. **doctor --attempt-proof 拒绝流**：win32/darwin→
   RP_UNSUPPORTED_PLATFORM_ISOLATION，linux→RP_SANDBOX_UNAVAILABLE，
   exit 78，观察内容零变化。
3. **挑战案例收官**：OOS-001 原生 Windows 3 次稳定拒绝 verified；
   OOS-002 通过 `.github/workflows/oos-002-macos.yml` 在**真 macOS** 上 3 次
   稳定拒绝（workflow 支持 `--verified-at` 固定时间戳输入，账本已入库）。
4. **S1 首批密封语料**：冻结种籽 20260822、24 例、双平台评测结果入库
   （`fixtures/sealed/evaluation-*.json`）：RUNTIME 4/4、challenge 零误报
   16/16、PATH/NATIVE/CONFIG finding 覆盖缺口被量化（4/16 in-scope，无 S1
   达标声明）。协议修订（程序化故障注入替代人类双盲）写入 docs/VALIDATION.md。
5. **README 发布级重排**：`docs/assets/banner.svg` + `demo-terminal.svg`
   （真实输出）、CI/License/Node/状态/语料徽章、mermaid 管线图、语料状态表、
   对比表、折叠深读区。
6. **CI 适配第一轮（`dfae889` + `2b1d122`）**：初步归一 Windows 8.3 路径、
   调整动态 ABI 与边界脱敏断言。
7. **跨平台契约收口（`de93d3e`）**：所有剩余临时目录/可执行文件比较统一走
   `realpathSync.native`；macOS 大输出子进程改用 `process.exitCode` 等待管道
   排空；OOS-002 的 macOS SDK 输出改为真实语义断言；Node 24 在任何 native
   smoke spawn/断言之前按 ABI 127/137 差异明确跳过。只改测试，未碰封存资产、
   manifest、receipt 或 ledger。
8. **文件系统能力检测（`a9af490`）**：资产清单的大小写冲突测试不再用操作
   系统名猜测卷语义，而是确认临时卷能否同时保存 `Alpha.txt`/`alpha.txt`；
   Linux 继续执行拒绝测试，默认 Windows/macOS 大小写不敏感卷明确跳过。
9. **v0.1.0 发布元数据（`3b1b01b`）**：去掉 `private`，补齐 repository /
   homepage / bugs / public publishConfig / CHANGELOG；加入 `prepublishOnly=pnpm verify`
   和 `prepack=pnpm build`；README 改为公网 npx 快速开始。CLI 版本不再硬编码，
   而是从随包 `package.json` 读取并 fail-closed 校验 semver。
10. **最低运行时门禁**：packed smoke 在构建后切到 Node 18 再执行同一 tarball；
    完整开发门仍使用 Node 22/24，因为固定的 pnpm 11.19.0 要求 Node >=22.13。
11. **npm bin 契约修复（`02e552b`）**：npm 11 会把 `./dist/cli.js` 规范化为
    `dist/cli.js`；发布预演先发现命令映射会被自动修正，元数据与 artifact 断言
    均改为规范值。第一次发布候选 CI 因旧 artifact 断言六平台共同红；确定性
    红绿复现后只修契约，第二次 CI 7/7 全绿。
12. **首发完成**：npm 账户启用 `auth-and-writes` 2FA，正式 `npm publish` 内部
    再跑完整 verify；最终上传 8 个预期文件（约 93.8 kB，shasum
    `6e754ec26e10b56f06ab179d96eef01a853fd7fb`）。registry、dist-tag、隔离安装、
    外部目录 npx、Git tag 和 GitHub Latest Release 均独立核验。

## 2. 现在卡在哪

**没有发布阻断。v0.1.0 已公开可用。** 发布提交的 run `32684989045` 结论为
`success`：Ubuntu、Windows、macOS 上的 Node 22/24 六矩阵全部成功，packed
tarball 在 Node 24/18 的 `--version`/`--help` 烟测也成功。npm `latest` 是
`0.1.0`，GitHub Latest Release 是 `v0.1.0`。

本轮唯一的非阻断观察：第一次发布候选 run `32684172023` 的 Node 22/Windows
在一个故意创建脱离子进程的测试完成所有行为断言后，删除临时目录时遇到一次
`EBUSY`；该目标用例随后在本机 Node 22 **连续 40 次通过**，第二次 CI 的
Windows 22/24 也均通过。清理已有 20 次线性退避，因此没有吞掉异常来制造假绿；
若未来连续复现，必须捕获新的锁持有证据再修。

## 3. 下一步

本阶段不需要继续发布或重发 0.1.0。新对话先确认 `main`、npm、Release 与最新
CI；不要因为旧 handoff 里的红灯描述重复修改。后续工作都应另立范围：

1. 若要做 GitHub 维护，可单独审查 Dependabot PR；依赖升级必须完整跑同一
   7-job 门，不能因当前全绿直接合并。
2. 若要进入下一产品阶段，优先使用 S1 已量化的诊断覆盖缺口（PATH 多候选
   finding、NATIVE stderr 分类器、CONFIG finding 边界），修改后重跑密封评测，
   不得沿用当前 S1 数字宣称新能力。
3. npm 版本不可覆盖；下一次行为/功能发布按 SemVer 使用 `0.2.0`，纯兼容修复
   使用 `0.1.1`。先更新 CHANGELOG/版本与契约测试，再走同一完整门、npm 2FA、
   公网安装、Git tag、GitHub Release 顺序。不要尝试重发 `0.1.0`。
4. 发布自动化仍未建立 trusted publishing/provenance；如要自动化，应单独设计
   GitHub OIDC trusted publisher，并保持当前本地 2FA 流程作为清晰的人工边界，
   不要把长期 npm token 写入仓库、日志或对话。

## 4. 坑清单（踩过的，别再踩）

### 本轮新坑（最重要）

- **npm 11 会规范化 bin 路径**：`"./dist/cli.js"` 在 publish dry-run 中会被
  自动修正；使用 `"dist/cli.js"`，并让 artifact 测试断言规范值。每次正式发布
  前必须先看 `npm publish --dry-run --ignore-scripts --json` 的 warning。
- **npm 发布强制 2FA**：`npm login --auth-type=web` 只完成身份登录；账户还必须
  启用 `auth-and-writes`。正式 publish 会给出 `/auth/cli/` 网页授权链接，用户
  在浏览器完成 2FA；绝不要在对话里传密码、OTP、恢复码或 token。
- **公网 npx 烟测必须离开源码树**：在 RunParity 根目录或其 `.pack` 子目录运行
  `npm exec --package=runparity`，npm 会向上发现同名本地 package，造成“命令未
  找到”的假失败。使用 `%TEMP%` 下无父级 package.json 的新目录和新 cache。
- **Git HTTPS 代理可能在握手时 EOF**：本轮 schannel/OpenSSL/HTTP1.1 均曾被
  代理截断，而 GitHub API 正常。不要关闭 TLS 校验。若必须用 Git Data API，
  远端父提交、blob、tree、commit SHA 和 `force=false` 必须逐层校验；普通 Git
  恢复后优先回到标准 push（本轮 tag 已正常 git push）。
- **管道吃掉退出码**：`pnpm verify | grep ...; echo RC=${PIPESTATUS[0]}`
  后面接 `&&` 链，链判断用的是**管道最后一个命令**的退出码——曾经 verify
  红着还 commit+push 了（2b1d122 就是这么推出去的）。**改用
  `set -o pipefail` 或把 verify 单独一步、确认输出后手动 git。**
- **并发负载抖动**：全量 vitest 并行时 DEV-CONFIG-001 npm lifecycle /
  doctor.process-tree 排水 / path-provenance 会**轮换性抖挂**（单独跑必过，
  三次全量里挂不同文件）。判定标准：单独重跑该文件过了=抖动；连续两次挂
  同一处=真回归。CI 上如果只有这类偶发红，重跑 job 即可
  （`gh run rerun <id> --failed`）。
- **模型请求中断**（"Model request Failed"）：**小步提交**，每完成一个独立
  修复就 commit（本地即存档），不要攒大提交。
- **8.3 短路径 / /private/var 软链**：所有涉及 tmpdir/cwd/executable 的
  断言一律 realpathSync.native 两侧归一。
- **大输出后立即 `process.exit()` 会截断管道**：边界脱敏测试用
  `process.exitCode` 让 stdout 自然排空；`[REDACTED]` 与
  `[REDACTED_BOUNDARY]` 都可以是合规展示，但"明文不出现"和应截断时的
  `truncated` 仍是硬断言。
- **Node 24 矩阵**：任何 `process.versions.modules`/`.node` 层相关断言前必
  须有 ABI 守卫且守卫在 spawn 之前。
- **macOS 不等于大小写敏感卷**：默认 APFS 与 Windows 常见卷都是大小写不
  敏感；文件系统测试必须探测当前卷能力，不能按 `process.platform` 猜。
- **Windows 临时目录偶发 `EBUSY`**：只有在行为断言已通过、同一位置单独/
  重跑通过且此前矩阵通过时才按 flake 处理；连续两次同点失败则加固清理等待。

### 环境与工具链（老坑，依旧有效）

- pnpm 坏 shim：先
  `export PATH="/c/Users/wmy/AppData/Local/rp-tools/node_modules/.bin:$PATH"`。
- wsl.exe 传引号会碎：复杂命令写本地脚本文件 → `tr -d '\r'` → WSL 执行，
  加 `MSYS_NO_PATHCONV=1`。
- Git Bash `/tmp` ≠ node 的 `C:\tmp`：跨进程传文件用绝对路径或 `%TEMP%`。
- GitHub 直连被墙时用代理 `git -c http.proxy=http://127.0.0.1:7897`（gh
  CLI 走自己的 token，不需要）。
- biome 已忽略 `fixtures/receipts/**`（字节即证据）；**收据链顺序**：manifest
  定稿→biome 格式化→`node work/generate-build-receipt.mjs <CASE> <entrypoint>`
  →实验/run-host `--verified-at <manifest 值>`→账本入库→validate。manifest
  任何再改动都要从 build receipt 重来。
- 测试计数断言随晋升漂移：validator.test.mjs / fixture-assets.test.ts 的
  形状与计数断言要跟着语料状态更新（当前基线 **0/2/14**；copied-root 降级
  测试=降一档：0/3/13）。
- 硬负例（DEV-NEG-001/002）**按设计永远 implemented**，别去"验证"它们。
- Host 观测永不等于隔离证明；一切 verified 必须走账本+独立验证器双实现。

### 复现环境（若需要重跑证据，CI 修复不需要）

VM：WSL2 KVM 内 QEMU Ubuntu 24.04.4（脚本 `work/vm/*.sh`，密钥
`C:/Users/wmy/.ssh/rp_backend_vm_key`，配置 `work/vm/backend-config.json`）。
镜像仓用 docker.1ms.run（docker.io 被 DNS 污染）。外部运行时已就位：
node-24.15.0/22.23.2/22.22.1 于 VM `/home/rp/assets-external/`。若 VM 消失按
`work/vm/setup-vm.sh → wait-vm.sh → prep-remote.sh → prep-cases.sh` 重建。

## 5. 常用命令

```bash
# 本地门（Windows，Git Bash）
export PATH="/c/Users/wmy/AppData/Local/rp-tools/node_modules/.bin:$PATH"
pnpm verify                          # biome+tsc+vitest+validator+artifacts
node fixtures/validate.mjs           # 预期 0 scaffold / 2 implemented / 14 verified
node --test fixtures/validator.test.mjs

# Ubuntu 门（同步+verify）
wsl.exe -d Ubuntu -- bash -c "cd /mnt/c/Users/wmy/Documents/Codex/2026-08-15/0-2 && tar --exclude=node_modules --exclude=dist --exclude=.git --exclude=work/pack-output -cf - . | (cd /root/runparity-linux && tar -xf -) && cd /root/runparity-linux && pnpm verify"

# CI
gh run list -R zwhy149/runparity --workflow=ci.yml --limit 3
gh run view <id> -R zwhy149/runparity --log-failed   # 看红 job 日志
gh run rerun <id> -R zwhy149/runparity --failed      # 偶发抖动重跑

# 已发布版本核验（npx 要在仓库树之外执行）
npm view runparity@0.1.0 version dist-tags.latest dist.integrity --json
gh release view v0.1.0 -R zwhy149/runparity
cd /tmp && npx --yes runparity@0.1.0 --version       # POSIX；Windows 用 %TEMP% 新目录

# 提交推送
git add -A && git commit -m "..." && git push
```

## 6. 给下一个对话的第一条指令

> 先读本 HANDOFF 全文与 `docs/adr/0005`，再用 `git status`、`git log -1` 和
> `gh run list -R zwhy149/runparity --workflow=ci.yml --limit 3` 核对当前事实。
> CI 修复和 v0.1.0 首发已经完成，不要重复发布或修改旧 tag。先独立核验 npm
> `latest=0.1.0`、GitHub Release `v0.1.0` 和 release commit CI 7/7。除非出现
> 新的可复现失败，否则保持已验证的收据链不动；任何新功能、依赖升级或下一
> 版本都作为新阶段重新规划、TDD、全量验证。
