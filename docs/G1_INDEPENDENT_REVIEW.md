# SyncPath G1 独立审查与下一轮验收清单

审查日期：2026-09-16。范围：当前未提交的 monorepo、API、AppV2、OpenAPI、集成测试与开发文档。

**结论：基础实现已有，但 G1 不通过。** 当前工作区构建通过、21 个集成测试通过，并不能覆盖已经复现的跨租户读取、Viewer 越权写入、登录白屏及干净环境构建失败。

本轮仅新增本审查文档，未修业务代码、未提交 Git。所有动态数据验证使用新建的临时数据库和隔离 API；完成后已删除该临时数据库，没有对原开发/测试数据库执行测试清理。

## 1. 独立验证结果

| 检查 | 实际结果 | 判断边界 |
|---|---|---|
| 当前工作区 `npm run typecheck` | 通过 | 已存在 domain/dist |
| 当前工作区 `npm run build` | 通过；Web JS 418.57 KB，gzip 113.80 KB | CSS 仅 5.12 KB，不能据此认定 UI 正常 |
| 干净源码副本 `npm ci --no-audit --no-fund` | 通过，863 packages | 副本排除了 node_modules、dist、.env；包含当前未提交源文件，并非 Git 已提交版本 |
| 副本安装后直接 typecheck/build | 失败；API 7 处 TS2307，无法解析 @syncpath/domain | 顶层脚本没有先构建 domain |
| 独立数据库迁移 | 两个 migration 全部通过 | 先显式补建 domain，再构建隔离 API |
| 原有集成测试 | 4 文件、21/21 通过 | 只证明现有断言，未覆盖下列漏洞 |
| 浏览器登录页 | 样式缺失，内容挤在左上角 | 与 Tailwind 配置及 CSS 产物一致 |
| 浏览器登录 demo | 登录后白屏；React 报 `Rendered more hooks than during the previous render` | 隔离 Vite → 隔离 API → 临时 PostgreSQL |
| Bob 读取 Alice 私有项目的 entry | `GET /api/v1/entries/:id` 返回 200 和日志标题 | Bob 当时不属于 Alice 的工作区，跨租户泄漏已复现 |
| Viewer 修改项目 | 直接路由 403，嵌套路由 200 | 同一账号、同一项目、同一修改内容 |
| Viewer 删除项目 | 嵌套路由返回 204 | 不符合仅 Lead/Owner/Admin 可删除的约束 |
| 8 个并行 HTTP PATCH | 本次为 1 个 200、7 个 409 | 未动态复现丢失更新；源码仍存在先读后无条件写的竞态，见 RV-08 |

代码定位使用 codebase-memory Verify 层级，并核对当前源码。有关路径的 coverage 无已记录缺口，但 coverage 本身不代表全面审计。本报告不是所有安全问题的穷尽清单。

## 2. 必须处理的发现

### RV-01 · P1 · 按 ID 读取日志缺失项目授权

- 位置：`apps/api/src/modules/entries/entries.controller.ts:86-90`；`apps/api/src/common/rbac/guards.ts:147-152`。
- 原因：GET handler 没有 `@ProjectRoles`，Guard 对缺失权限元数据直接返回 true；后续 service 仅按 entry ID 查询。
- 影响：任意已登录用户在知道其他工作区 entry ID 时可读取正文。全局 SessionAuthGuard 只验证登录，无法弥补租户授权缺口。
- 实测：新建互不隶属的 Alice/Bob；Alice 建私有项目和日志；Bob 请求该 entry，得到 200 和标题 `Tenant A secret`。
- 修复：明确每条对象路由的项目授权；身份认证和租户/对象授权分别验证；为受保护路由缺失授权元数据设置校验或拒绝策略。
- 验收：跨租户 GET/PATCH/DELETE、列表及所有路由别名统一拒绝；不可见对象返回 404；正文不泄漏、数据库不变。

### RV-02 · P1 · 嵌套项目路由绕过项目角色

- 位置：`apps/api/src/modules/projects/projects.controller.ts:25-28,65-101`；`apps/api/src/modules/projects/projects.service.ts:150-177`。
- 原因：`/workspaces/:workspaceId/projects/:id` 只有工作区成员校验；详情、修改、删除缺少项目角色检查。service 的 getById 也只要求工作区 membership。
- 实测：同一 Viewer 对 `/projects/:id` PATCH 得到 403，对嵌套路由 PATCH 得到 200，DELETE 得到 204。
- 修复：所有路由采用同一授权入口，同时核对 URL workspaceId 与对象实际 workspaceId，避免两套 controller 形成不同权限规则。
- 验收：Viewer 在两套路由都不能修改或删除；无私有项目授权的 Member 无法读取；伪造父工作区 ID 不能绕过检查。

### RV-03 · P1 · AppV2 登录后 Hook 顺序变化

- 位置：`apps/web/src/AppV2.tsx:195-212`，后续多个 useMemo/useCallback 同样位于条件 return 之后。
- 原因：未登录和探测状态提前 return，登录后才调用额外 Hook。
- 实测：浏览器点击 Sign In 后页面变白，控制台出现 Hook 顺序变化和 `Rendered more hooks than during the previous render`。
- 修复：将登录后的应用拆成独立组件，或确保每次 render 无条件以相同顺序调用所有 Hook。
- 验收：注册、登录、刷新恢复会话、注销、会话过期均正常；控制台无 Hook 错误；用浏览器 E2E 覆盖，不仅用 API curl。

### RV-04 · P1 · Tailwind 没有扫描迁移后的 src

- 位置：`apps/web/tailwind.config.cjs:3-10`。
- 原因：content 仍为 `./App.tsx`、`./components/**` 等旧路径，实际文件位于 `./src/**`。
- 实测：产物只有 5,120 bytes；缺少 `.flex`、`.grid`、`.bg-indigo-600`；登录页截图已确认布局和按钮样式丢失。
- 修复：扫描当前 Web 源码路径，例如 `./src/**/*.{ts,tsx}`，保留 index.html；确认动态拼接类名的可提取性。
- 验收：生产 preview 和 dev 均恢复 Slate/Indigo 品牌布局；至少检查登录、工作区、项目、日志弹窗和窄屏；关键 utility 确实进入产物。

### RV-05 · P1 · 干净安装缺少内部包构建

- 位置：根 `package.json:11-21`；`packages/domain/package.json:6-12`。
- 原因：domain exports 指向 dist；postinstall 只生成 Prisma；build/dev 未先构建 domain。当前机器遗留 dist 掩盖了依赖顺序问题。
- 实测：干净源码副本 npm ci 成功，随后 API typecheck/build 出现 7 个 TS2307，直接 require domain 也报 MODULE_NOT_FOUND。
- 补充：仓库没有 `apps/api/.env.example`；新环境还需要数据库连接配置、建库/迁移/种子数据。`dev:web && dev:api` 中前者是常驻进程，正常运行时不会执行后者；已有 `npm run dev` 才是并行入口。
- 修复：明确内部包拓扑构建、dev 前置准备或源码解析策略；提供环境样例和可重复的数据库启动/迁移流程；同步 README。
- 验收：无 node_modules、dist、本地 env 的副本，按文档设置必要变量后，从安装到 typecheck/build/dev/浏览器登录完整通过；依赖本地手工操作的步骤必须写明，不能称为安装即启动。

### RV-06 · P1 · 页面加载 effect 形成请求循环

- 位置：`apps/web/src/AppV2.tsx:149-160`；`apps/web/src/hooks/useApiData.ts:165-180,266-290`。
- 源码证据：effect 依赖整个 api 对象；refreshProjects/refreshEntries 更新 state；api 的 memo 依赖 state，每次响应都产生新对象并再次触发 effect。
- 影响：修复登录白屏后，选择工作区/项目可能持续请求并触发渲染。当前白屏阻断了这条 UI 路径，本轮未声称动态复现该循环。
- 修复：依赖稳定的刷新函数和选择 ID；按需要加入取消、去重和过期响应保护。
- 验收：选择工作区/项目只产生预期请求，静置不会持续刷新；快速切换不会将旧响应写入新视图。

### RV-07 · P1 · 默认测试清理会删除全部会话

- 位置：`apps/api/test/identity.e2e.test.ts:75-80`；`apps/api/vitest.config.ts`。
- 原因：`prisma.session.deleteMany({})` 没有限制 fixture；测试默认 API_BASE 为 :3000，PrismaClient 使用当前 DATABASE_URL，缺少强制独立测试目标的校验。
- 影响：按 README 在开发 API 旁运行测试，可能让所有开发用户退出。注释称只清测试数据，与实际不符。
- 修复：测试 runner 创建/销毁专用数据库与 API，验证目标身份；清理仅针对本次 fixtures；拒绝非测试数据库及默认生产/开发目标。
- 验收：在非测试目标上运行应在写入前失败；正常测试不影响 demo 或其他用户会话；失败退出也能清理本次临时资源。

### RV-08 · P1 · revision 比较与写入不是原子操作

- 位置：`apps/api/src/modules/projects/projects.service.ts:195-203,230-233`；`apps/api/src/modules/entries/entries.service.ts:95-112`。
- 源码证据：先比较预先读取对象的 revision，随后 `update({where:{id},...})`，数据库写入条件不包含 expectedRevision。
- 影响：两个请求若都在首次写入前读到同一 revision，均可通过内存检查并覆盖。现有测试是先完成首次请求，再提交第二次，并未构造该交错。
- 动态边界：本轮 8 个并发 HTTP 请求恰好得到一个成功，不能据此宣称竞态已复现或已消除。
- 修复：使用包含 id、revision 和授权/有效状态约束的原子条件更新；影响行数为 0 时返回 409；UI 保留失败方草稿并提供重取/比较。
- 验收：用确定性的屏障构造两个请求均读取 v1 的交错；只有一个提交 v2，另一个 409，最终正文与 revision 一致；浏览器草稿可恢复。

### RV-09 · P1 · 导入不具备声明的原子性与幂等性

- 位置：`apps/api/src/modules/imports/imports.service.ts:84-90,105-134,153-177,209-220`；`apps/api/test/imports.e2e.test.ts:287-336`。
- 原子性：源码无统一 `$transaction`；workspace、membership、project、project member、entries 分段写入，后续错误被 catch 后写成 summary，早期写入不回滚。
- 动态观察：提交错误类型的 `logs: {}`，API 仍返回 201；同一结果同时出现 `projectsCreated: 1`、`projectsSkipped: 1` 和 `(legacy.logs ?? []).slice is not a function`。该路径在创建项目后才解析 logs；本轮未在临时环境自动清理前完成额外 DB 对账，因此持久化路径判断以源码为依据。
- 幂等性：workspaceName 只用于复用工作区，每次 apply 都调用新的 project/entry create。现有测试是不同项目导入同一工作区并期待两个项目，没有验证同一文件重试。
- 修复：先严格预检和规范化实际旧数据形状，再以批次/文件身份和 source ID 建唯一约束与幂等记录；明确事务边界，失败回滚正式数据；返回可核对的计数和映射。
- 验收：同一文件串行/并发重复提交、提交后断网重试均只有一套记录；未知 schema/错误类型/非法日期/重复 ID 逐对象报错且正式数据无部分写入。
- 阶段边界：导入属于 G2；可以继续标为开发中，但不能在当前报告中宣称 AC-07/08 已完整达成。

### RV-10 · P2 · 软删除对象仍可通过列表或父容器访问

- 位置：`apps/api/src/modules/entries/entries.service.ts:21-36` 未加 `deletedAt: null`；`apps/api/src/common/rbac/guards.ts:205-220` 未核对 workspace.deletedAt。
- 影响：删除日志后刷新列表可重新出现；软删除工作区后，直接项目/日志路由可能仍放行。
- 修复：统一对象与父容器的有效性条件，避免 controller/guard/service 各自实现不同过滤规则。
- 验收：软删除后详情、列表、修改、缓存刷新均不可重新暴露对象；恢复若支持，必须走明确权限和状态转换。

## 3. 验收编号和范围校正

权威基线为 `SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md` §8.3、§9.2。

| 项目 | 正确口径 |
|---|---|
| G1 | 需要 AC-01～04、10；明确不接受越权。当前 RV-01/02 已触发拒绝条件 |
| AC-01 | 身份生命周期的 API 部分有 6 个通过测试；完整浏览器流程被 RV-03 阻断 |
| AC-02/03 | 现有 8 个测试只覆盖部分路径；RV-01/02 证明授权矩阵不完整 |
| AC-04 | 成员撤权、在线缓存收敛、重连拒绝缺少闭环；不能归为不相关后续工作 |
| AC-09 | 是上海/洛杉矶时区、日期拖动和多视图一致性，不是 revision |
| AC-10 | 才是 revision 冲突及 UI 草稿保留；现有 projects 测试应重标编号并补真实交错 |
| AC-06～08 | 属于 G2 导入；当前仅有部分预检、字段处理和工作区复用测试 |
| AC-05 | 属于后续只读分享，无需为关闭 G1 提前实现全部分享功能 |
| RLS | DEV-005 和 §7.1 明确要求，尚未实现就应列为 G1 欠项；应用层 Guard 已存在不能视为等效完成 |
| DEV-004/006 | 还应逐项对账邀请/密码重置、审计/Outbox、分页/契约同步等约定，避免把 API 骨架等同完整工作包 |

还需修正文档事实：README 称每次 build 自动生成 Web client types，但顶层 build 未串联 dump/generate；README 称 OpenAPI 3.1，当前 snapshot 为 3.0.0。G1 需要可重复生成和 CI diff 检查；建议由显式脚本/CI 输出契约，避免 API 启动无条件写工作目录。

## 4. 下一轮开发顺序与出口

建议下一轮命名为 **G1.1 修复与补验**，先完成已有约束；Comments 留在 G2，AI Gateway 留在既定 S5。

| 顺序 | 工作 | 完成条件 |
|---|---|---|
| 1 | 修 RV-01/02，并统一软删除与租户边界 | 为每个对象/别名路由建立 read/create/update/delete 授权矩阵；跨租户 404、Viewer 写入 403、DB 无改变 |
| 2 | 修 RV-03/04/06，恢复浏览器主流程 | 登录→选工作区→建项目→写日志→刷新→注销完整 E2E；样式截图通过，无 Hook 错误及请求风暴 |
| 3 | 修 RV-05/07，建立可重复验证环境 | 新源码副本按 README 安装/配置/迁移/启动成功；测试不接触开发数据库；CI 执行同一流程 |
| 4 | 修 RV-08，实现原子更新和冲突 UI | 真实并发一个成功、一个 409；失败草稿保留，重取后能手动恢复修改 |
| 5 | 补 ProjectMembers/撤权、RLS、必要审计和契约同步 | AC-03/04 针对已有资源完成；运行账号与迁移账号分离；连接复用隔离和角色绕过测试；生成契约无 diff |
| 6 | 处理 RV-09，或明确保留为 G2 未验收项 | 禁止使用“已原子化/幂等”描述未满足的行为；进入 G2 前安排 AC-06～08 完整验收 |

未实现的附件、搜索、AI 等资源可在验收记录中标注“尚未进入该资源的交付阶段”，同时保留后续完整验收要求；不能将这些子项写成已经通过。

## 5. 提交策略

- 当前工作区同时包含文件搬迁、删除、依赖和功能修改，不应直接将 `git add --renormalize .` 的结果命名为“纯行尾提交”：该命令也会暂存已跟踪文件当前的功能修改和删除。
- 先保存/隔离现有工作，再准备可审查提交。每个提交 diff 应与标题一致；如果无法可靠分离已混合的历史步骤，优先提交明确描述的 monorepo 迁移基线和后续修复，不虚构纯格式历史。
- 建议拆分维度：monorepo/构建环境、身份与权限、项目日志与原子版本、OpenAPI/client、Web 接入、导入、文档与验收证据。每组说明前置依赖和可运行边界。
- 在 RV-01/02/03 未关闭时，可以保存 WIP，但不能标记为 G1 验收通过或可发布版本。
