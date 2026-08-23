# RunParity handoff（第五版 — 交接给下一个对话/GPT）

> 快照日期：2026-08-23（Asia/Shanghai）  
> 仓库：本地 `C:\Users\wmy\Documents\Codex\2026-08-15\0-2`，**已发布到 GitHub
> https://github.com/zwhy149/runparity**（main 分支，最新提交 `2b1d122`）  
> 读完本文件 → `AGENTS.md` → `CONTEXT.md` → `docs/adr/0001..0005`，再动手。
> 目标：**把 GitHub CI 修到全绿并推送，完成"可发布最终版"**。

---

## 0. 一句话现状（做到哪里了）

产品与证据链**已全部完成并推送**：12/12 supported positives 在真实隔离后端上
VERIFIED_INTERVENTION，两个平台挑战案例在真硬件上 verified（Windows 本机 +
GitHub Actions macOS），语料 **0 scaffold / 2 implemented / 14 verified**
（2 个 implemented 是按设计只做 Host Observe 的硬负例）。S1 首批密封评测已
跑完并入库。README 已按高星库标准重排（SVG banner、终端演示图、badges、
mermaid、折叠区）。**唯一卡点：GitHub Actions 的 CI 矩阵 6 个 job 里 5 个
红**（只有 Node 22 / ubuntu 绿）——本地双平台门全绿，红的全是"CI runner
首次覆盖的环境差异"（macOS 首次全量跑、Windows 8.3 短路径、Node 24 矩阵）。

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
6. **CI 适配第一轮（已推 `dfae889` + `2b1d122`）**：修了 8.3 短路径断言
   （realpathSync.native 归一 ×6 处）、动态运行时 ABI 断言删除 ×3、边界脱敏
   断言平台无关化 ×2。**部分起效**（ubuntu Node22 转绿）。

## 2. 现在卡在哪（精确到 job 与根因模式）

`gh run list -R zwhy149/runparity --workflow=ci.yml` 最后一次（2b1d122）：
**绿：Node 22/ubuntu。红：Node 22+24/windows、Node 22+24/macos、Node 24/ubuntu。**

已确认的三类根因（修法模式已验证，照抄即可）：

### A. Windows runner：8.3 短路径（`C:\Users\RUNNER~1\...`）
- 症状：`expected 'C:\Users\runneradmin\...' to be 'C:\Users\RUNNER~1\...'`。
- 已修 6 处，**还有残留**（`doctor.windows-shim.test.ts` 第二处 cwd-search
  已修但同文件可能还有；用 grep 找所有裸比较路径的断言）。
- 修法模板：比较两侧 `realpathSync.native(x ?? "")`，不要 toBe 裸路径。

### B. macOS（首次全量跑这套测试）：管道分块差异 + 平台语义
- 边界脱敏类（cli-contract）：macOS pipe chunking 让 64KiB 摘录边界落点
  不同 → 走"全脱敏 [REDACTED]"而非"[REDACTED_BOUNDARY]"——**两者都是合规
  结果**。已改 2 处为"包含其一"；同类还有：
  `suppresses a truncated capture when a multiline learned secret crosses
  the tail`（同文件，同修法：硬断言只留"明文不出现"，标记断言二选一）。
- 其余 macOS 失败（posix `skips an earlier non-executable PATH file`、
  `evidence-file` canonical identity、`host-observe` captured cwd、
  fixture-assets 的 PATH-001/RUNTIME-001/OOS-002 smoke）**需要逐个看日志定
  位**——大概率也是路径形态（macOS 无 8.3 但有 /private/var 软链
  vs /var/tmp 形态差异 → 同样 realpathSync.native 归一可解）或执行位差异。
- 查日志命令：
  `RID=$(gh run list -R zwhy149/runparity --workflow=ci.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId'); gh run view $RID -R zwhy149/runparity --log-failed | sed 's/\x1b\[[0-9;]*m//g' | grep -E "FAIL |AssertionError" | sort -u`

### C. Node 24 矩阵：运行时 ABI 与 fixture 层不匹配
- NATIVE fixture 的 matching 层是 ABI 127（Node 22 编译）。Node 24
  运行时 ABI 137：加载 mismatched(137) 层会**成功**→A 臂不失败→断言反转。
- fixture-assets.test.ts 里的 `t.skip` 守卫在 `matching ABI !==
  process.versions.modules` 时跳过——确认所有 NATIVE smoke 都在 spawn 断言
  **之前**执行守卫（此前有三处动态断言在守卫之前，已删，见 dfae889）。
  Node24/ubuntu 还挂的 fixture-assets 用上面的日志命令看具体是哪个测试，
  多半是同类（守卫顺序或另一处硬编码）。
- **禁止**为了让 Node 24 过而弱化断言；正确做法是守卫/参数化。

## 3. 下一步（按序，直到推送全绿）

1. `gh auth status` 确认仍以 zwhy149 登录（token 有 workflow scope；8 月 22
   日已设备流登录过，一般还在；若失效让用户在浏览器完成
   `gh auth login -h github.com -p https --web` 设备流）。
2. 用 §2 的日志命令拉当前红的每个 job 的失败清单，按 A/B/C 三类模式逐一修
   （每修一类：本地 `pnpm exec vitest run <file>` 定向验证 → 全量 → commit）。
   **修法纪律：只做根因修复（路径归一 / 断言语义平台无关 / ABI 守卫），绝不
   改产品代码去迁就测试，绝不删除安全断言（"明文不出现"类必须保留）。**
3. 本地全量门：`pnpm verify`（注意 §4 的管道退出码坑！确认真的 RC=0 再提交）。
4. `git push` → 轮询 CI 直到 6/6 job 绿
   （`gh run watch <id> -R zwhy149/runparity` 或循环 `gh run list --json
   status,conclusion`）。若只剩偶发抖动（§4），`gh run rerun <id> --failed`。
5. 绿后收尾：README 的 CI badge 会自动变绿（已指向 zwhy149/runparity）；
   检查 dependabot 开的 PR（vitest/upload-artifact 升级）——CI 绿后再考虑
   合并或忽略；更新本 HANDOFF §0；`git push`。
6. （可选，超出"CI 绿"范围）路线图下一站：诊断覆盖三缺口（S1 已量化排序：
   PATH 多候选 finding、NATIVE stderr 分类器、CONFIG finding 边界）→ 重跑
   `node fixtures/sealed/evaluate.mjs` → S2 npm 发布（`runparity-fixtures`
   永不进公共 bin）。

## 4. 坑清单（踩过的，别再踩）

### 本轮新坑（最重要）

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
- **macOS pipe chunking**：脱敏边界类断言改成"合规结果之一"，硬断言只留
  明文不出现。
- **Node 24 矩阵**：任何 `process.versions.modules`/`.node` 层相关断言前必
  须有 ABI 守卫且守卫在 spawn 之前。

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

# 提交推送
git add -A && git commit -m "..." && git push
```

## 6. 给下一个对话的第一条指令

> 先读本 HANDOFF 全文与 `docs/adr/0005`。跑 `gh auth status` 确认登录。
> 拉取 CI 最新失败清单（§2 命令），按 A（Windows 8.3）/B（macOS 管道与
> 路径形态）/C（Node 24 ABI 守卫）三类模式逐 job 修复；每类修完本地定向
> 测试 + 全量 verify（警惕 §4 管道退出码坑）+ 小步 commit。全绿后推送、
> 轮询 CI 6/6、更新本 HANDOFF §0 并提交。只做根因修复，不弱化任何安全
> 断言，不碰已验证的收据链。CI 全绿即为本阶段"最终版"交付标准。
