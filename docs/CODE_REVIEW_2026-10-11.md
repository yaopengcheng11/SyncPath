# SyncPath 深度代码审查与验收记录

日期：2026-10-11
审查对象：当前本地工作区，包含尚未提交的业务代码与迁移。
综合结论：**发现 8 项 P1 和 13 项 P2/架构缺口，当前版本不满足面向不互信团队的多租户发布条件。** 其中后端 5 项 P1，前端 3 项 P1。 现有 114 项测试全部通过，但没有覆盖下述关键攻击与撤权场景。
整改状态：B-01～B-13、F-01～F-08 均待修复。本轮后端工作为审查和隔离验证，未修改业务源码或现有业务数据；前端视觉实施、导出修复和文档更新单独记录在文末。

## 1. 结论与发布阻断项

最优先处理 **B-01：工作区邀请接口允许请求体覆盖已授权的 workspaceId**。任意注册用户可以创建自己的工作区，然后借助该工作区的邀请接口，把自己加入另一个已知 ID 的工作区并成为 Admin。该问题已在可丢弃数据库中完成真实 HTTP 复现，受害私有项目从 404 变为 200。

B-02～B-05 分别涉及撤权后的在途写入、软删除账号仍可登录、SSE 在降级或注销后持续推送，以及旧项目权限在重新邀请时复活。应在继续扩展协作能力前完成这一组权限闭环。

前端发布阻断项是 **F-01 跨账号剪贴板正文残留、F-02 撤权后敏感缓存与编辑角色不收敛、F-03 撤销覆盖或删除同事后续修改**。三项已使用真实源码与可控传输/状态 mock 验证，尚未完成真实双浏览器业务验收。

| ID | 优先级 | 当前发现 | 证据强度 | 状态 |
|---|---|---|---|---|
| B-01 | P1 / 发布阻断 | 邀请请求覆盖租户 ID，跨租户获得 Admin | 源码、真实 HTTP、无数据库的最小复现 | 待修复 |
| B-02 | P1 / 发布阻断 | 撤权提交后，已通过 Guard 的卡片修改仍可成功 | 源码、数据库锁屏障、真实 HTTP | 待修复 |
| B-03 | P1 / 发布阻断 | 软删除账号仍能登录及写入普通业务 API | 源码、真实 HTTP | 待修复 |
| B-04 | P1 / 发布阻断 | 角色降级和注销后，旧 SSE 继续推送受限活动 | 源码、真实 HTTP/SSE | 待修复 |
| B-05 | P1 / 发布阻断 | 移出工作区后保留的项目角色在重邀时复活 | 源码、真实 HTTP、临时库查询 | 待修复 |
| B-06 | P2 | Owner 可以自降级，工作区进入零 Owner 状态 | 源码、真实 HTTP、临时库查询 | 待修复 |
| B-07 | P2 | 管理员的项目列表、详情与有效角色不一致 | 源码、真实 HTTP | 待修复 |
| B-08 | P2 | OpenAPI 与生成类型同步，但关键 schema/参数缺失 | 源码、受控契约检查、内存重新生成比对 | 待修复 |
| B-09 | P2 | 注册字段错误返回 500，缺少统一运行时字段校验 | 源码、真实 HTTP | 待修复 |
| B-10 | P2 | 项目修改和删除不发布协作事件 | 当前生产调用点源码检查 | 待修复 |
| B-11 | P2 | 项目永久删除未校验用户实际看到的版本 | Controller、Service、API Client 源码 | 待修复 |
| B-12 | P2 | 导入缺少整体事务、批次幂等和可靠的名称冲突处理 | 当前导入路径源码检查 | 待修复 |
| B-13 | P2 / 架构验收缺口 | 数据库 RLS 尚未落地 | 当前全部 7 个迁移与 Prisma 接入源码 | 待修复 |

P1 表示应先于多租户发布处理的权限或数据完整性问题；P2 表示需要排入明确整改迭代的功能、可靠性或架构问题。B-13 的生产账号权限未核验，不能由源码推断账号实际是 superuser 或具有 BYPASSRLS。

## 2. 审查与验证边界

- 本轮范围包括 `apps/api/src` 的身份、工作区、成员、项目、卡片、分享、提及、历史、导入和协作路径，以及 Prisma schema/迁移、OpenAPI 和 API Client。
- 本轮没有可调用的 `search_graph`、`index_status`、`check_index_coverage`。图项目、generation 和覆盖率均为 unknown。结构定位使用精确源码读取与定向搜索；不声称取得 MCP 图覆盖或完成无遗漏证明。
- 所有业务结论均根据当前文件重新确认。文件链接中的行号是本次审查时的一基行号；后续整改可能使行号移动。
- 既有测试通过当前编译产物运行。执行前确认所有 API 源文件都有对应 `dist` JavaScript，且没有源文件修改时间晚于对应产物；关键漏洞位置还比对了产物内容。没有重新执行 API build，避免影响正在运行的开发 watch。该检查不能替代未来 CI 的干净构建。
- 定向安全验证只向本轮创建的临时 API/数据库创建可丢弃 fixture；没有调用生产服务，也没有迁移、重置或清理现有业务数据库。
- B-10～B-13 为当前源码与契约证据，未额外声称取得真实双客户端、故障注入或生产权限实测。

## 3. 具体问题与验收标准

### B-01｜P1：工作区邀请接口允许跨租户 Admin 提权

**定位**：[workspace-members.controller.ts:37](../apps/api/src/modules/workspace-members/workspace-members.controller.ts#L37)、[workspace-members.service.ts:64](../apps/api/src/modules/workspace-members/workspace-members.service.ts#L64)、[main.ts:26](../apps/api/src/main.ts#L26)。

**触发与影响**：Controller 使用 `this.members.invite({ workspaceId, actorRole: ctx.workspaceRole, ...body })`。请求体中的同名字段覆盖了路径租户和服务器角色上下文。Guard 校验的是 URL 中的工作区，Service 却向请求体指定的工作区写入成员，且没有重新查验操作者在该目标租户中的权限。当前没有全局字段白名单校验拦截额外属性。

**实测证据**：攻击者注册并创建自己的工作区，先读取受害私有项目得到 404；随后向自己的工作区发送以下邀请请求，得到 201。再次读取受害私有项目得到 200，`myRole` 为 `Lead`，因为目标 workspace Admin 具有项目管理权限。

```http
POST /api/v1/workspaces/<attacker-workspace-id>/members
Content-Type: application/json

{
  "workspaceId": "<victim-workspace-id>",
  "userId": "<attacker-user-id>",
  "role": "Admin"
}
```

请求必须使用攻击者自己的有效 session；无需受害工作区已有成员权限。上述 ID 均来自本轮临时 fixture。

**修复建议**：逐字段取出 `userId`、`identifier`、`role`，禁止请求体覆盖授权上下文；引入运行时字段白名单；Service 接收 actor ID 并核验其在实际目标工作区中的当前权限，避免把客户端输入或调用方传来的角色字符串当作授权证明。

**验收标准**：

- 相同攻击请求返回 422/400 或按白名单策略忽略额外字段；受害工作区不得新增 membership。
- 分别注入 `workspaceId`、`actorRole` 及二者组合，均不能改变服务端授权目标。
- HTTP 用例断言攻击前后受害项目始终不可访问，受害成员表未变化。
- 正常 Owner/Admin 邀请仍可成功，Member 邀请仍被拒绝。

### B-02｜P1：撤权提交后，在途卡片修改仍能写入

**定位**：[entries.service.ts:165](../apps/api/src/modules/entries/entries.service.ts#L165)、[project-members.service.ts:183](../apps/api/src/modules/project-members/project-members.service.ts#L183)、[guards.ts:215](../apps/api/src/common/rbac/guards.ts#L215)。

**触发与影响**：请求先通过 ProjectRolesGuard，然后等待 timeline/project 锁。期间成员权限可能已被撤销。卡片写入事务在得到锁后只检查卡片 revision，不重新检查当前权限，已失去权限的用户仍能提交内容。CAS 不能替代授权一致性。

**实测证据**：在临时数据库持有项目 `FOR UPDATE` 锁，发起 Bob 的 PATCH 并确认数据库活动显示请求阻塞在 timeline 锁；Owner 移除 Bob 项目权限返回 204；释放锁后 Bob 的 PATCH 仍返回 200，保存标题 `Written after revoke committed`。撤权事务明确先于受保护写入提交。

**修复建议**：为撤权与受保护写入定义一致的锁顺序和事务边界；获得串行化边界后再读取当前成员权限。仅在事务外多查一次角色仍有相同竞态。应覆盖卡片、项目、成员和分享等受保护写入路径。

**验收标准**：

- 使用确定性的数据库锁屏障复现；撤权先提交时，在途写入返回 403/404，卡片内容、revision、历史和通知均不变化。
- 写入先合法提交时，其完整事务保留，撤权后新的写入立即拒绝。
- 并发测试不得仅依赖随机 sleep；验证无死锁，并检查失败事务没有留下历史/通知副本。

### B-03｜P1：软删除账号仍能登录和写入普通业务 API

**定位**：[session-auth.guard.ts:73](../apps/api/src/modules/identity/session-auth.guard.ts#L73)、[users.service.ts:52](../apps/api/src/modules/identity/users.service.ts#L52)、[sharing.service.ts:163](../apps/api/src/modules/sharing/sharing.service.ts#L163)。

**触发与影响**：身份 Guard 与密码登录只要求用户存在且 `status === 'active'`，忽略 `deletedAt`。SharingService 有额外检查，因此不同 API 对同一账号的有效性判断不一致。触发前提是账号被后台或运维置为软删除；本轮未发现公开用户删除接口。

**实测证据**：临时 fixture 用户设置非空 `deletedAt`、保留 active 后，旧 session 的 `/sessions/me` 返回 200，用户名密码重新登录返回 200，旧 session 创建工作区返回 201。

**修复建议**：统一账号有效性为 `deletedAt === null && status === 'active'`；登录、session Guard、邀请对象和长连接复核共享该规则。账号停用/删除应撤销 session，并与 B-04 的流终止联动。

**验收标准**：

- suspended 与 soft-deleted 用户的新登录、既有 cookie、普通读写、分享读取均拒绝；错误响应不泄露敏感账号详情。
- 账号删除后，现有 session 和长连接在规定时限内失效。
- 活跃账号行为不变；HTTP 测试明确覆盖软删除但 status 仍 active 的组合。

### B-04｜P1：降级和注销后，旧 SSE 继续推送受限项目活动

**定位**：[workspace-members.controller.ts:50](../apps/api/src/modules/workspace-members/workspace-members.controller.ts#L50)、[collaboration.service.ts:64](../apps/api/src/modules/collaboration/collaboration.service.ts#L64)、[sessions.service.ts:61](../apps/api/src/modules/identity/sessions.service.ts#L61)。

**触发与影响**：移除项目/工作区成员会调用 `collaboration.revoke`，但工作区角色降级不通知订阅。注销仅改写 session。SSE 在握手时授权，后续没有 session 生命周期或权限复核，流也没有绑定具体 session。失去权限后仍能获得操作者、对象 ID、活动时间和 Presence；本次未观察到正文从该事件流泄露。

**实测证据**：Admin 打开私有项目 SSE，收到 snapshot；Owner 将其降为 Member 且不赋予项目角色，随后直接 GET 项目返回 403，原 SSE 仍收到 `entry.created`。继续注销会话，logout 返回 200、`/sessions/me` 返回 401，原 SSE 仍收到下一条 `entry.created`。

**修复建议**：降级后重算已有订阅权限；按具体 session 绑定连接，注销、到期、账号停用均终止相关流；增加有时限的权限复核，保障撤权 ≤5 秒。若以后多进程部署，撤权消息必须跨实例传播。

**验收标准**：

- 真实 SSE 连接在 workspace Admin→Member 且无项目角色后 ≤5 秒终止，之后不再收到项目事件。
- 注销、到期、账号停用分别终止相应 session 的流；其他合法 session 按产品策略保留。
- 撤权后重连被拒绝；客户端清空失效页面缓存。
- 增加真实 HTTP/SSE 测试，不仅手工调用内存 Subject 测试事件分发。

### B-05｜P1：重新邀请工作区成员会恢复全部旧项目权限

**定位**：[workspace-members.service.ts:124](../apps/api/src/modules/workspace-members/workspace-members.service.ts#L124)、[project-members.service.ts:108](../apps/api/src/modules/project-members/project-members.service.ts#L108)。

**触发与影响**：移出工作区只删除 membership，保留其所有 project_members。重新邀请为普通 Member，或者通过另一个项目邀请而补建 workspace membership，都会使 Guard 再次接受历史 Lead/Editor 角色。管理员无法通过“移除后重新以普通成员加入”实现权限重置。

**实测证据**：Bob 原为私有项目 Editor；移出工作区返回 204、读取项目返回 404，但数据库仍有一条旧 project membership；仅重邀 workspace Member 返回 201，读取旧项目恢复 200/Editor，并可创建卡片，返回 201。

**修复建议**：工作区移除时在同一事务中删除或失效该工作区下的项目角色；重新邀请必须重新授权。若产品确实要恢复历史权限，应独立展示并由管理员明确选择，不应隐式发生。

**验收标准**：

- 移除→重邀普通 workspace Member 后，旧私有项目仍不可访问，旧项目写入被拒绝。
- 移除→邀请进入另一个项目后，仅新授权项目可访问。
- 工作区撤权、项目角色清理和协作撤权通知保持一致；任一事务失败不能留下部分授权。

### B-06｜P2：Owner 自降级使工作区没有 Owner

**定位**：[workspace-members.service.ts:91](../apps/api/src/modules/workspace-members/workspace-members.service.ts#L91)、[workspace-members.service.ts:98](../apps/api/src/modules/workspace-members/workspace-members.service.ts#L98)。

**触发与影响**：实现约束了新增 Owner 必须对应 workspace.ownerId，却允许现有 Owner 把自己改为 Member。ownerId 不变，Owner membership 消失，后续 Owner-only 操作不可执行，也缺少正常恢复路径。

**实测证据**：Owner PATCH 自己为 Member 返回 200；Owner membership 数量为 0；随后 DELETE workspace 返回 403。

**修复建议**：禁止最后 Owner 自降级。需要所有权转移时，提供独立操作，在同一事务里更新 ownerId 和相关 membership，并明确目标用户资格。

**验收标准**：

- 唯一 Owner 自降级/自移除被拒绝，workspace.ownerId 与 Owner membership 保持一致。
- 若实现所有权转移，成功后恰有一个 Owner；失败、并发或重复请求不产生零 Owner/多 Owner。
- 前端限制之外，直接 API 请求也执行相同规则。

### B-07｜P2：管理员的项目列表与直接读取不一致

**定位**：[projects.service.ts:51](../apps/api/src/modules/projects/projects.service.ts#L51)、[projects.service.ts:73](../apps/api/src/modules/projects/projects.service.ts#L73)、[projects.service.ts:209](../apps/api/src/modules/projects/projects.service.ts#L209)。

**触发与影响**：列表仅返回 workspace-visible 或显式 projectMember 的项目，没有应用 Owner/Admin 对私有项目的管理权限。列表 myRole 也只取 projectMember，详情却将 Owner/Admin 视为 Lead，造成项目消失或 UI 错误显示为无权限。

**实测证据**：workspace Admin 对私有项目直接 GET 为 200/Lead，同工作区列表却不包含该项目。

**修复建议**：统一列表过滤、详情检查、成员角色与 effective role 计算。对 Owner/Admin、显式 Lead/Editor/Viewer、无项目角色的 Member 分别定义一致策略。

**验收标准**：

- Owner/Admin 能列出与其直接读取权限一致的项目，并得到正确的 effective role。
- 同一账号的 list、detail、entries 与 UI 能力提示一致。
- 普通成员不会因统一逻辑而看到无权查看的私有项目，列表总数与分页也执行相同过滤。

### B-08｜P2：OpenAPI 同步检查通过，但关键契约仍丢失

**定位**：[sessions.controller.ts:24](../apps/api/src/modules/identity/sessions.controller.ts#L24)、[workspaces.controller.ts:16](../apps/api/src/modules/workspaces/workspaces.controller.ts#L16)、[project-members.controller.ts:34](../apps/api/src/modules/project-members/project-members.controller.ts#L34)、[openapi.json:38](../packages/contracts/openapi.json#L38)、[openapi.json:1012](../packages/contracts/openapi.json#L1012)。

**触发与影响**：注册、登录、工作区创建和修改使用 type-only 导入的请求 DTO，运行时请求 schema 成为 `Function`。项目成员 GET 缺少路径中的 projectId 参数，PATCH/DELETE 也缺这个参数；成员返回是 object[] 或没有响应 schema。外部工具和后续客户端生成不能获得真实契约，当前手写 ApiClient 类型掩盖了缺失。

**契约证据**：受控 OpenAPI 的上述请求指向 `#/components/schemas/Function`；项目成员 GET 的 parameters 为空。本轮在内存重新生成 TypeScript，结果与受控 generated.ts 完全一致，均为 55,032 bytes。因此“重新生成无 diff”只能证明同步，不能证明契约有效。

**修复建议**：为 DTO 保留运行时引用或显式声明 ApiBody；完整声明路径参数及 response DTO；对契约内容增加语义检查。

**验收标准**：

- 注册、登录、创建/修改工作区请求具有明确字段、必填项与约束，生成文档中不再出现无意义的 Function schema。
- 每个路径模板参数在对应 operation 中均被声明为 required path parameter。
- 成员列表和写操作响应具有明确 schema，ApiClient 不再用手写类型掩盖缺失。
- CI 同时执行生成无 diff 和关键 schema/参数语义检查。

### B-09｜P2：字段错误返回 500，运行时验证不完整

**定位**：[sessions.controller.ts:47](../apps/api/src/modules/identity/sessions.controller.ts#L47)、[sessions.controller.ts:65](../apps/api/src/modules/identity/sessions.controller.ts#L65)、[api-exception.filter.ts:49](../apps/api/src/common/http/api-exception.filter.ts#L49)。

**触发与影响**：注册手工校验失败抛普通 Error，被 filter 翻译为 500。登录先设置 reply.code(422) 再抛 Error，也会被 filter 改成 500。DTO 的 TypeScript 类型和 Swagger 注解不构成运行时约束；B-01 就利用了未知字段进入 Service。

**实测证据**：非法邮箱注册返回 500，响应 code 为 `internal_error`，服务端记录普通 `Error: Invalid email`。

**修复建议**：为输入失败使用稳定的 422/400 异常与字段详情；统一类型、长度、枚举、空值及未知字段检查。授权参数必须独立于 DTO 白名单防护，不能只靠前端或类型系统。

**验收标准**：

- 缺失/非法邮箱、空 body、错误类型、非法 enum、过长字符串及未知字段均按契约返回 4xx，不产生 500。
- 响应包含稳定 code 和可公开的字段详情；内部日志与用户错误区分处理。
- 正常注册、登录和业务写入不回归，B-01 注入用例同时通过。

### B-10｜P2：项目修改和删除未发布协作事件

**定位**：[project-by-id.controller.ts:62](../apps/api/src/modules/projects/project-by-id.controller.ts#L62)、[project-by-id.controller.ts:81](../apps/api/src/modules/projects/project-by-id.controller.ts#L81)、[projects.controller.ts:95](../apps/api/src/modules/projects/projects.controller.ts#L95)、[collaboration.service.ts:14](../apps/api/src/modules/collaboration/collaboration.service.ts#L14)。

**触发与影响**：用户 A 修改项目名称/日期，或永久删除项目后，另一用户已打开的协作页面不会由后端收到项目变化通知。当前声明了 `project.updated` 类型，但生产项目更新路径没有调用 publish；两种项目删除路由也没有删除事件或订阅收敛处理。

**源码证据**：两个项目 Controller 仅依赖 ProjectsService，更新/删除在 Service 返回后直接响应；在当前 API 源码中检查 event publish 调用点，没有对应项目更新发布。此项没有额外声称双浏览器实测。

**修复建议**：事务成功后发布项目更新/删除事件，包含对象 ID、revision/eventId；删除应关闭相关订阅并清空服务端 Presence。为工作区删除定义同样的客户端收敛路径。失败事务不发布成功事件。

**验收标准**：

- 两个真实客户端打开同一项目，一端更新后另一端及时更新名称、日期等；两种项目路由表现一致。
- 永久删除后另一端退出失效视图、清理缓存和 Presence，不继续显示可编辑对象。
- 409/403/事务回滚不产生成功事件；断线重连通过重新取数恢复。

### B-11｜P2：项目永久删除没有用户侧版本基线

**定位**：[project-by-id.controller.ts:80](../apps/api/src/modules/projects/project-by-id.controller.ts#L80)、[projects.controller.ts:117](../apps/api/src/modules/projects/projects.controller.ts#L117)、[projects.service.ts:359](../apps/api/src/modules/projects/projects.service.ts#L359)、[api-client/index.ts:200](../packages/api-client/src/index.ts#L200)。

**触发与影响**：A 打开旧项目页面或删除确认框，B 已保存更新，A 随后确认永久删除。API 不接收 A 看到的 expectedRevision；Controller 在删除请求中读取数据库最新 project，再用这份最新 revision 做 DELETE CAS。这个 CAS 只能发现请求执行期间的变化，无法发现用户确认基于旧页面。永久删除会一并清除项目内容和历史。

**源码证据**：两种删除 Controller 都只接收 ID，没有客户端基线；ApiClient.deleteProject 只发送 ID；Service 比较的是 Controller 刚查到的 revision。本轮没有额外执行该 HTTP 场景。

**修复建议**：为永久删除定义客户端确认基线，至少要求 expectedRevision；项目下新增/修改卡片使用独立 timelineRevision，需决定并显式保护这类内容变化。冲突后重新展示将被删除的最新范围，要求用户再次确认。

**验收标准**：

- A 持有旧基线，B 更新后，A DELETE 返回 409，项目及全部子对象/历史保持不变。
- 确认期间新增卡片或修改历史相关内容时，按已确定的 timelineRevision 策略阻止静默删除新内容。
- 缺少必需基线的请求被拒绝；刷新范围并重新确认后才能删除。
- 嵌套与直接删除路由、API Client 和 UI 使用同一协议。

### B-12｜P2：导入缺少整体事务、批次幂等和可靠名称冲突处理

**定位**：[imports.service.ts:90](../apps/api/src/modules/imports/imports.service.ts#L90)、[imports.service.ts:117](../apps/api/src/modules/imports/imports.service.ts#L117)、[imports.service.ts:153](../apps/api/src/modules/imports/imports.service.ts#L153)、[imports.service.ts:246](../apps/api/src/modules/imports/imports.service.ts#L246)。

**触发与影响**：同一导入重复执行会在按名称复用的工作区里重复创建项目；中途失败可能保留部分工作区、membership、项目或卡片。apply 没有执行 validate 的 MAX_PROJECTS 限制。makeUniqueSlug 返回基础 slug，没有使用传入的 exists 检查，两个用户导入同名 workspace 会触发唯一键冲突，正常导入被打断。

**源码证据**：工作区、membership、项目、项目成员分步直接写入；卡片 bulkCreate 各自事务；项目级 catch 将异常转换为 skipped，但没有恢复已落库的前半段。同名仅用于工作区查找，不构成文件 hash/schema/目标工作区级幂等键。此项为当前源码检查，没有重新执行导入故障注入。

**修复建议**：建立验证过的导入批次，绑定 payload hash、schema version、目标工作区与幂等键；apply 重用完整输入验证并重新授权；明确批次原子或可恢复分段协议，避免注释声称整体事务而实际部分成功。可靠处理 slug 冲突和同名工作区歧义。

**验收标准**：

- 相同批次重复/并发 apply 返回同一结果，不增加重复项目、卡片、成员或历史。
- 在 workspace、project、entry 步骤注入失败，数据结果符合明确的回滚/恢复协议，错误报告可追踪。
- 直接调用 apply 不能绕过数量、日期、类型和敏感字段规则。
- 不同用户导入同名工作区可获得独立合法 slug，或收到明确、可操作的 4xx 冲突；不能裸露为 500。

### B-13｜P2：RLS 第二层保护尚未实现

**定位**：[prisma.service.ts:12](../apps/api/src/common/prisma/prisma.service.ts#L12)、[schema.prisma:1](../apps/api/prisma/schema.prisma#L1)、[开发框架 §7.1](../docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md#L323)。

**触发与影响**：当前隔离依赖应用层 Guard/Service。B-01 这样的漏检会直接到达数据库，缺少文档要求的第二层行级策略。PrismaService 中关于 RLS 的内容是未来实现说明。

**源码证据**：审查当前全部 7 个迁移及 Prisma 接入，没有 ENABLE/FORCE ROW LEVEL SECURITY、CREATE POLICY 或事务内租户上下文设置。未查询现有开发/生产数据库的运行账号权限，不能推断其是否 superuser、是否拥有业务表或 BYPASSRLS。

**修复建议**：明确应用/迁移账号分离，定义租户上下文与受限运行账号的 RLS 策略；结合项目/成员/分享等对象关系设计访问路径，不让分享能力依赖全局绕过。策略落地不能代替 B-01～B-05 的业务授权修复。

**验收标准**：

- 以真实非 superuser、非 BYPASSRLS、非表所有者的应用角色执行数据库集成测试。
- 无租户上下文默认拒绝；错误租户读取和写入均拒绝；合法上下文仅能触达目标范围。
- 连接池复用、事务回滚、并发租户请求不会串用上下文；使用事务内 SET LOCAL 或等效机制并验证。
- 迁移角色和应用角色配置独立；分享、导入、成员管理与历史操作仍通过对应授权测试。

## 4. 本轮验证记录

### 4.1 现有测试

执行命令：

```bash
node --import tsx apps/api/scripts/run-integration-tests.ts
```

结果：7 个迁移成功；14 个文件、114 个测试全部通过；Vitest 耗时 19.19 秒；runner exit 0。为追加定向安全验证，另以 `--watch` 保持独立临时服务，该次既有 114 项测试也通过。

| 测试文件 | 用例数 |
|---|---:|
| sharing.e2e.test.ts | 23 |
| hard-delete.e2e.test.ts | 7 |
| collaboration.test.ts | 16 |
| timeline-history.e2e.test.ts | 10 |
| authorization.e2e.test.ts | 10 |
| self-mentions.e2e.test.ts | 7 |
| tenancy.e2e.test.ts | 8 |
| imports.e2e.test.ts | 5 |
| projects.e2e.test.ts | 5 |
| mention-timeline.e2e.test.ts | 6 |
| identity.e2e.test.ts | 8 |
| mentions.e2e.test.ts | 5 |
| members.e2e.test.ts | 3 |
| concurrency.e2e.test.ts | 1 |
| **合计** | **114** |

分享并发接受用例执行期间，Prisma 输出过由应用重试处理的写冲突日志；相关测试最终通过。不能把这类已被覆盖并恢复的预期并发日志直接当作新失败。

### 4.2 追加的定向验证结果

| 场景 | 观测结果 | 对应问题 |
|---|---|---|
| 请求体覆盖目标 workspaceId | 受害私有项目 404 → 邀请 201 → 读取 200/Lead | B-01 |
| 项目锁阻塞写入，先完成成员撤权 | 撤权 204；释放锁后 PATCH 200，内容确实保存 | B-02 |
| 用户 deletedAt 非空、status active | me 200、重新登录 200、创建工作区 201 | B-03 |
| Admin 降为无项目权限的 Member | 普通读取 403，旧 SSE 仍收到 entry.created | B-04 |
| 同一 SSE 用户随后注销 | me 401，旧 SSE 仍收到后续 entry.created | B-04 |
| 移出 workspace 后仅重新邀请 Member | 旧 Editor 恢复；旧私有项目读取 200、创建卡片 201 | B-05 |
| Owner 自降为 Member | PATCH 200、Owner 行数 0、删除工作区 403 | B-06 |
| Admin 私有项目列表与详情 | 详情 200，但列表缺失该项目 | B-07 |
| 从 OpenAPI 在内存重新生成类型 | 与受控 generated.ts 完全一致，55,032 bytes | B-08 的同步验证 |
| 非法邮箱注册 | 500 / internal_error | B-09 |

上述用例是本轮临时执行的定向验证，尚未写入仓库测试文件；后续修复必须将对应场景固化为回归测试。

### 4.3 隔离与清理

创建并由 runner 清理的两个临时数据库：

- `syncpath_test_1791730811043_43a646fb0d67`，临时 API 端口 60775。
- `syncpath_test_1791730907456_ed0c9425a801`，临时 API 端口 61327。

runner 日志确认数据库删除及自有子进程停止；随后检查两个临时端口均为 ECONNREFUSED。第二次 watch 经主动 Ctrl-C 停止，内部 Vitest 退出 130、包装进程最终退出 1；这是主动结束持续测试进程，不是 114 项测试失败。

没有执行现有业务库清理脚本、迁移 reset、生产数据写入，也没有执行 API build。

## 5. 已关闭的旧问题：测试数据库目标保护

旧报告中“集成测试默认直接打 demo 数据库”的结论不适用于当前受支持的执行入口，应关闭该项。

当前 [run-integration-tests.ts:89](../apps/api/scripts/run-integration-tests.ts#L89) 为每次执行创建随机 `syncpath_test_*` 数据库，限定本机连接，并设置独立 API 端口和 ownership token。[integration-safety.ts:20](../apps/api/scripts/integration-safety.ts#L20) 校验环境、数据库名称与目标；[vitest.config.ts:5](../apps/api/vitest.config.ts#L5) 在加载测试前验证 API probe，避免测试钩子先接触错误数据库。

本轮实际验证了临时库创建、迁移、API 身份探针、测试执行及清理。未来 CI 应继续使用这一入口；不能因为某个测试文件内部存在默认 API_BASE 就推断正常 runner 仍会使用 demo 数据库。

## 6. 建议整改顺序

1. 先修 B-01，补跨租户额外字段注入测试，审计其他把请求体展开到授权上下文的路径。
2. 联合处理 B-02～B-05，统一身份有效性、事务内权限复核、撤权清理与 SSE 生命周期。
3. 处理 B-06、B-07、B-09，统一角色不变量、查询可见性与运行时输入校验。
4. 修 B-08、B-10、B-11，完善契约、协作传播和永久删除基线。
5. 对 B-12、B-13 明确里程碑并实现导入与数据库隔离验收，不再将文档说明视作已实现能力。

关闭每一项时，记录修复提交、对应新增测试、真实运行结果与仍保留的限制。现有测试数量增加本身不能代替指定场景通过。

## 7. 前端审查

本次范围为当前 `AppV2`、`useApiData`、`useProjectCollaboration`、卡片剪贴板、Timeline、编辑器、比较视图与共享只读页。代码基于本轮工作区重新读取；文件链接的行号已在视觉样式改动后重新核对。知识图谱工具本轮不可用，以下依据精确源码及说明过的临时验证，不声称 MCP 索引完整覆盖。

**新的视觉样式、主题和组件外观不等于以下业务问题已经修复。** 本文中的 F-01～F-08 仍需单独实现与验收。前端业务审查使用只读源码与临时 harness，没有修改相应业务逻辑或数据库；独立的视觉实施与全量 Web 验证见第 8 节。

此前使用 `/tmp` 中的临时脚本，将真实 TypeScript 源码编译并注入 React 状态和 API 传输 mock，确定性验证了缓存回填、403 后缓存保留、账号切换后剪贴板保留与撤销返回值；脚本已删除。该验证证明相关函数逻辑，不能替代浏览器交互、真实身份服务或数据库集成测试。下面明确区分此类实测和纯源码推导。

### F-01 — P1：剪贴板跨账号保留私密正文

**位置**：[cardClipboard.ts](../apps/web/src/utils/cardClipboard.ts#L26)、[invalidateSession / signOut](../apps/web/src/hooks/useApiData.ts#L159)、[工作台退出](../apps/web/src/AppV2.tsx#L295)、[时间轴粘贴](../apps/web/src/components/Timeline.tsx#L407)。

**触发与影响**：Alice 在任务内复制私密卡片，退出后在同一个页面登录 Bob；Bob 在自己的可编辑任务按 Ctrl/Cmd+V，仍会取得 Alice 的标题、summary、notes、mention IDs。React 通过 `key=user.id` 重建工作台，不会重建模块级 `cards`。当前仅删除任务、工作区或卡片时清空剪贴板，正常退出、身份失效和账号切换都不清理。

**实测/源码证据**：真实 `useApiData` / `cardClipboard` 编译后的 mock harness 执行 `signOut()` → `signIn({id:'bob'})`，`cardClipboard.read()` 仍返回 `Alice private / secret body`。`Timeline` 的粘贴处理直接读取模块单例，没有 accountId 或来源权限校验。

**建议修复**：剪贴板显式绑定当前 accountId；身份失效和切换时同步清空，读取时也检查所属账号。若剪贴板保留跨任务功能，记录来源 projectId，撤权时清理该来源。对 `mentionedUserIds` 做数组复制，避免把可变数组作为所谓快照共享。

**验收标准**：Alice 复制后退出、会话过期、切换 Bob 均无法在 Bob 会话读取或粘贴原卡；同一账号跨任务复制仍按产品约定工作；撤权后对应剪贴板不可用。测试必须穿过 App 身份切换流程，不能仅在单元测试 `beforeEach` 中手工 clear。

### F-02 — P1：撤权只关闭协作流，正文和编辑角色不会收敛

**位置**：[协作事件和撤权分支](../apps/web/src/hooks/useProjectCollaboration.ts#L111)、[entries 刷新](../apps/web/src/hooks/useApiData.ts#L258)、[工作台编辑能力](../apps/web/src/AppV2.tsx#L353)、[Timeline 编辑权限](../apps/web/src/AppV2.tsx#L872)。

**触发与影响**：任务已打开时，成员被移除，或 Editor 被降级成 Viewer。`membership.updated` 与 `project.updated` 都只刷新 entries；403/404 分支关闭 SSE、清理在线协作者，却保留项目、日志与角色缓存。已加载的私密正文仍可在当前页面显示和导出；角色降级后页面继续显示编辑入口，直到写入被服务器拒绝。这里的问题是客户端撤权收敛，不能据此声称后端新请求已经越权成功。

**实测/源码证据**：mock harness 先缓存卡片，再让 `refreshEntries` 返回 403，缓存仍完整保留。协作 Hook 没有清理业务缓存或更新项目角色的回调；`AppV2` 的可编辑判断持续读取旧 `myRole` 与工作区 role。

**建议修复**：建立统一的项目访问失效处理。成员/项目变更事件同步更新项目与工作区权限；401 失效会话，403/404 清理敏感正文并退出详情，阻断后续导出；降级但仍有读取权时更新 role 并切换为只读。必要时提供有界的访问重新确认，避免只依赖一条 SSE 消息。旧请求不得在失效之后把缓存恢复。

**验收标准**：两个浏览器会话完成 Editor→Viewer、私有项目移除成员、工作区删除测试；在约定的收敛时限内，编辑控件和正文按权限变化更新，撤权后不能从当前 UI 导出旧缓存。再测失效结果先到、旧成功响应后到，确保正文不会重新出现；保留草稿的策略须与敏感内容隐藏策略明确区分。

### F-03 — P1：撤销会用最新 revision 删除或覆盖同事的后续修改

**位置**：[UndoEntry 数据结构](../apps/web/src/AppV2.tsx#L42)、[撤销实现](../apps/web/src/AppV2.tsx#L559)、[撤销粘贴的删除](../apps/web/src/AppV2.tsx#L571)、[撤销移动版本](../apps/web/src/AppV2.tsx#L579)、[时间轴撤销提示](../apps/web/src/components/Timeline.tsx#L417)。

**触发与影响**：A 粘贴一张卡，B 随后补充重要内容，A 按 Ctrl/Cmd+Z；撤销读取 B 修改后的最新 revision 并发起 DELETE，CAS 会认可此版本，B 的内容可能被删除。移动同理：B 已重新安排日期后，A 的撤销会用最新 revision 把日期改回旧值。UndoEntry 没保存自己的操作完成版本，所以“有 CAS”并没有保护后来者的改动。另外，撤销提前出栈、吞掉所有失败，并立即显示成功。

**实测/源码证据**：从当前 `AppV2` 提取真实 `handleUndo` 放入 mock harness，缓存提供同事修改后的 revision 3；函数提交 DELETE revision 3。即使 DELETE promise 拒绝，它仍立即返回 `Undid paste of ...`。未对真实数据库执行删除。

**建议修复**：记录自己操作完成后的 afterRevision、afterDate 和 projectId。只有对象仍等于本操作结果时才能直接逆操作；后续版本变化时拒绝撤销或要求用户明确确认。撤销改为异步，等待逆操作结果，按逐项结果报告成功/失败，之后再更新历史，避免无限重试与静默丢失并存。

**验收标准**：两人先后修改后，撤销不能静默删除对方文本或覆盖对方日期；锁定、撤权、断网、409、部分失败都有准确反馈；未得到服务端确认时不能显示“已撤销”；快速连续 Ctrl/Cmd+Z 不得并发重放同一条历史。

### F-04 — P2：旧刷新响应可覆盖刚保存的新版本

**位置**：[项目刷新](../apps/web/src/hooks/useApiData.ts#L248)、[日志刷新](../apps/web/src/hooks/useApiData.ts#L258)、[更新日志缓存](../apps/web/src/hooks/useApiData.ts#L351)、[选中任务时加载](../apps/web/src/AppV2.tsx#L288)、[SSE 重连加载](../apps/web/src/hooks/useProjectCollaboration.ts#L139)。

**触发与影响**：GET 在修改前启动，随后 PATCH 成功并更新缓存，旧 GET 最后返回；刷新函数直接替换整组数据，已保存的新正文和 revision 会回退成旧值。进入任务时的 effect、SSE onopen 和多个事件均可产生并发刷新。类似竞态可使已删卡片短暂重现，或使后续编辑产生人为的版本冲突。

**实测/源码证据**：mock harness 中 PATCH 后缓存为 `{revision:2,title:'saved new text'}`，让之前挂起的 GET 返回后，缓存变成 `{revision:1,title:'old text'}`。现有 auth epoch 只针对账号切换，不能控制同账号、同资源上的请求顺序。

**建议修复**：按资源串行/合并刷新，建立 mutation generation，拒绝修改前发起的 GET 回填；结合对象 revision 与删除 tombstone 处理对象合并。单纯 latest-request ID 不能覆盖 GET→mutation→旧 GET 返回的情形。

**验收标准**：用可控 deferred 请求测试 GET→PATCH→旧 GET、GET→DELETE→旧 GET、两个 GET 逆序完成和撤权期间旧响应返回；确认保存/删除结果不回退，revision 不降低，后续读取可恢复最新服务器状态。

### F-05 — P2：普通工作台没有跨标签页身份核对

**位置**：[仅挂载时探测会话](../apps/web/src/hooks/useApiData.ts#L122)、[普通项目请求](../packages/api-client/src/index.ts#L171)、[普通 entry 请求](../packages/api-client/src/index.ts#L206)、[通知请求](../apps/web/src/hooks/useMentionInbox.ts#L10)。

**触发与影响**：标签 A 仍显示 Alice，另一标签退出 Alice 并登录 Bob，浏览器 cookie 随之变成 Bob。原标签 A 的正常项目、日志与通知请求没有携带预期用户；当两人都能访问同一个任务时，原标签的操作可按 Bob 的身份执行，页面仍显示 Alice。后端仍按实际 cookie 鉴权，此处是当前页面所显示身份与实际操作身份不一致，不能描述为服务端租户隔离必然失效。

**实测/源码证据**：源码确认普通工作台仅启动时 `/me`，auth epoch 不感知其他标签的 cookie 变化；普通请求未使用 `expectedUserId`。共享页、mentions timeline 和 history 已存在预期用户核对，普通工作台没有。未进行双浏览器账号写入实测。

**建议修复**：将现有 `X-SyncPath-User-Id` 能力统一到认证请求层与服务端全局校验；配合 BroadcastChannel / visibility revalidation 及时刷新 UI。身份变化时中止旧异步批次，清理缓存与剪贴板，并采用明确的草稿恢复方案。

**验收标准**：双标签 Alice→Bob 切换后，原标签不能继续以 Bob 身份提交 Alice 页面上的操作；读取与 SSE 也应退出旧身份上下文。覆盖换账号、同账号重新登录、会话失效、后台标签恢复及尚未完成的批量粘贴。

### F-06 — P2：首次直接进入比较视图时，已有卡片显示为空

**位置**：[进入比较页](../apps/web/src/AppV2.tsx#L736)、[比较页缓存读取](../apps/web/src/AppV2.tsx#L849)、[MultiTimelineView](../apps/web/src/components/MultiTimelineView.tsx#L12)。

**触发与影响**：刷新网页后，在工作台直接选中两个此前未打开的任务，再点 Compare。此时只加载过 projects，entries cache 没有这两个任务的数据；handleEnterMultiView 只 setView，比较页将缺失缓存当成空对象，因此有卡片的任务显示成空时间轴。即使曾经打开过，比较期间也没有对应刷新，可能展示过期结果。

**实测/源码证据**：源码中加载 entries 的选择 effect 依赖 `selectedProjectId`，进入比较页不改变它；比较页和 MultiTimelineView 仅消费传入缓存，没有自己的加载状态或请求。该项为确定的调用链推导，未重复运行浏览器验证。

**建议修复**：按选中任务 ID 加载比较页数据，为每个任务展示 loading/error/empty 的区别，并定义可见状态刷新或订阅策略；切换选择时取消或忽略过期响应。

**验收标准**：刷新后直接比较两份未单独打开的有卡任务，能正确展示全部卡片；慢请求显示加载态，单项失败显示可重试错误，真实空任务才显示空态；比较期间他人修改按约定更新。

### F-07 — P2：纯键盘无法完成核心新增、查看和编辑操作

**位置**：[卡片打开容器](../apps/web/src/components/Timeline.tsx#L875)、[快捷键处理](../apps/web/src/components/Timeline.tsx#L315)、[日期轴新增](../apps/web/src/components/Timeline.tsx#L949)、[先选日期才出现的新增按钮](../apps/web/src/components/Timeline.tsx#L988)。

**触发与影响**：键盘用户 Tab 到 Timeline 后，无法逐一聚焦卡片并进入详情；卡片是只有 onDoubleClick 的 div，缺少打开用的语义按钮/键盘动作。日期轴也是鼠标操作，浮动新增按钮必须先通过鼠标选中日期才出现。现有 Ctrl+A、方向键移动、折叠/锁按钮无法替代选择单卡和打开编辑器。共享只读 Timeline 也无法仅用键盘打开卡片详情。

**实测/源码证据**：当前卡片没有 tabindex/role/Enter/Space handler；快捷键集合没有打开所选卡或指定日期新增动作。视觉样式增加的 `sp-timeline-card` 不会自动提供这些交互语义。该项为源码检查，没有声称已完成屏幕阅读器实测。

**建议修复**：提供语义化卡片打开 button，或完整的 roving focus + Enter 方案；增加始终可达的 Add card 控件及带标签的日期选择。只读用户也能键盘打开详情。焦点样式、返回焦点和可访问名称随交互一并实现。

**验收标准**：完全不使用鼠标，可从工作台进入任务、选择某一张卡、打开/关闭详情、选择日期创建卡；只读共享页可键盘阅读详情但无写入入口；屏幕阅读器宣布卡片名称、日期和打开语义；Tab 不会停在视觉不可见且无说明的小按钮上。

### F-08 — P2：异步操作完成后污染另一任务的撤销栈

**位置**：[单一撤销栈与切任务清理](../apps/web/src/AppV2.tsx#L508)、[粘贴完成后入栈](../apps/web/src/AppV2.tsx#L539)、[移动完成后入栈](../apps/web/src/AppV2.tsx#L623)。

**触发与影响**：任务 A 批量粘贴/移动尚未结束时，返回工作台打开任务 B。切换任务的 effect 清空同一个 undoStack ref，但旧任务 A 的 callback 完成后仍向该 ref push；B 的 Ctrl/Cmd+Z 于是拿到 A 的历史，查不到 B 对应对象，却返回撤销成功。重新打开 A 又会清空历史，原操作难以撤销。

**实测/源码证据**：UndoEntry 不包含 projectId，pushUndo 使用稳定 callback 写同一个 ref；粘贴和移动完成后没有检查当前任务或操作 epoch。该项是异步控制流推导，未额外运行慢网浏览器验证。

**建议修复**：撤销历史按 projectId 分桶，每项保存所属项目；异步完成更新原项目历史，视图切换不能更改其归属。若产品只允许当前任务历史，使用操作 epoch 丢弃过期 UI 入栈结果，并明确告知无法撤销的策略。可与 F-03 一起修复，但验收需覆盖不同触发条件。

**验收标准**：让任务 A 的批量操作请求延迟，期间进入 B；A 完成后，B 的撤销不能消费 A 的历史或显示虚假成功。重新进入 A，历史表现符合约定；再覆盖切工作区与退出/换账号中断的批次。

### 当前已改善的行为与验证边界

- AuthScreen 已没有历史 Guest 坏入口；不重复报 G1 的旧问题。
- LogEditor 已保存编辑 baseline，展示最新版本并要求确认覆盖，当前比 G1.2 的简单 warning 完整。需要修复的是 App 缓存与撤销等相关边界，不能把这些改进描述为不存在。
- SharedContentView 当前按 user/source scope 隔离，传 expectedUserId，串行轮询，离线/错误时隐藏正文，只读卡片没有写 handler。未发现历史“共享视图直接可改”的问题；F-07 的键盘读取缺口仍适用。
- `useApiData` authEpoch 能挡住本标签已执行身份切换之前请求的缓存回填；它不解决 F-04 的资源级竞态，也不感知 F-05 的其他标签 cookie 切换。
- `Timeline.delete.test.tsx` 将移动、粘贴、撤销 handler mock 掉，`cardClipboard.test.ts` 仅验证模块复制行为。现有这两组测试不能作为 App 身份隔离、撤权收敛、真实撤销或请求竞态已经通过的证据。需补 App/Hook 组合流程测试及少量浏览器端验收。


## 8. 视觉实施与验收

### 已实施

- 在 `apps/web/src/index.css` 建立 `--sp-*` 语义颜色，统一浅色与炭灰暗色的页面、面板、输入、边界、正文、选中和焦点。暗色主按钮改用浅灰反色，保留靛蓝交互及危险/成功/提醒语义。
- 收紧工作台顶栏、账户菜单、项目切换、任务卡片和登录界面的字号、间距与字重；任务日期、可见范围、角色、勾选与打开入口有明确层次。
- 比较视图同步收紧顶栏和时间线外框；收到分享的重复进入按钮改用中性次操作，减少浅色列表中的大面积靛蓝色块。
- 编辑、创建、分享、导出与确认弹窗统一毛玻璃表面、圆角、遮罩和中性标题栏；成员、设置、历史面板沿用同一表面。窄屏顶栏和底部工具允许换行。
- 时间线保留三种节点层次，改善日期与摘要可读性，不再通过整张过去卡片变灰和半透明来表示时间；保留既有选中、拖动和快捷键业务逻辑。
- Mermaid 预览沿用主题 token；长中文和长英文标题按宽度换行，保留全文、转义与私密信息边界。SVG ID 增加实例区分，避免开发热更新时 ID 冲突导致空预览。
- PNG 白底导出只在 html2canvas 的克隆文档切换浅色，白底/透明模式都显式处理时间线内外背景，原页面主题保持不变。

### 验证证据

| 检查 | 本轮结果 | 证据边界 |
| --- | --- | --- |
| API 集成测试 | 14 文件，114/114 通过 | 一次性数据库与独立 API；不覆盖全部本次新增攻击场景 |
| 定向安全验证 | B-01～B-07、B-09 按各项记录完成真实隔离 HTTP/SQL/SSE 复现 | 临时 fixture，未修改业务数据库 |
| API / API Client 类型检查 | 通过 | 未重新构建运行中的 API watch；详见第 2 节 |
| Web 类型检查、测试、生产构建 | 16 文件，109/109 通过；类型检查及生产构建通过 | 新增长标题测试 4 项、PNG 导出流程测试 3 项 |
| CSS token 对比度 | 40 组通过；浅/暗正文最低 4.82/6.11，控件边界最低 3.16/3.68 | 明确实体颜色组合，不代表全产品无障碍认证 |
| 浏览器界面 | 明暗工作台、时间线、选中卡片、编辑/创建/导出弹窗、比较页、收到分享、中英文、390×844 窄屏 | 真实组件，传输层使用虚构内存 fixture；不冒充真实身份/协作端到端验收 |
| 中文与 @成员 | 编辑器中文填入、候选菜单选择张三正常 | 不包含硬件输入法 composition 实测 |
| Mermaid 实际预览与下载 | 长标题文字边界不溢出节点，实际 `.mmd` 保留全文并排除私密笔记 | 本地真实 Mermaid 渲染和浏览器下载 |
| PNG 实际下载 | 白底和透明图均 3840×1038；角落 RGBA 分别为 255/255/255/255 与 0/0/0/0 | 白底图已视觉检查，原页面继续为暗色 |

临时 `design-check.html/.jsx` 和 `design-surface-check.html/.jsx` 已移除，未进入正式入口或生产构建。开发 fixture 热更新期间出现过重复 createRoot 警告，属于临时页面重载方式，未将其记为正式产品零警告验收。真实入口重新加载后仍为正常登录页面。

Web 构建仍提示部分 chunk 大于 500 KB：主包约 597 KB，Mermaid core 约 505 KB（按需加载）。本轮没有通过提高 warning 阈值隐藏它；后续可评估依赖裁剪与拆包，性能验收还需真实设备加载/渲染测量。既有测试出现 ReactDOMTestUtils.act 弃用提醒，不影响当前测试通过。

### 交付物与限制

- [当前设计规范](SYNCPATH_DESIGN_SYSTEM.md)。
- 暗色工作台、时间线、编辑器、窄屏编辑器和导出弹窗截图保存在本地验收附件中，内容全部为虚构示例；截图没有纳入仓库。
- PNG 白底/透明、Mermaid 示例下载副本保存在本地验收附件中；本轮产生的 Downloads 临时副本已清理。
- 2026-10-11 审查时未提交或推送 Git；2026-10-13 按用户要求将代码与文档纳入 GitHub 同步，审查结论仍有效。未执行 Windows/Electron/App Store 打包、其他设备局域网连接或生产多租户验收。
- 上述 B-01～B-13、F-01～F-08 均仍待修复。视觉验收不能替代权限和协作正确性验收。

## 9. 2026-10-13 GitHub 同步复验

按用户要求更新 README 并同步当前产品代码。本轮在临时干净 Git 目录对候选版本执行 `npm ci`、全量类型检查、API 与 Web 测试和完整构建：API 14 文件 114/114、Web 16 文件 109/109 通过；集成目标安全检查 5/5、锁定单元测试 5/5、Prisma schema 校验、三个 macOS 脚本语法检查通过。重新生成 API Client 类型与候选提交文件一致。

API 回归通过随机一次性数据库和独立端口运行，应用全部 7 个迁移，退出后清理测试数据库及进程。没有对原业务数据库执行测试迁移或清理，原运行服务保持工作。临时清理 SQL、环境配置、数据库与截图附件未纳入发布。

本次没有实施上述业务整改；B-01～B-13、F-01～F-08 仍待修复。测试通过不等于新增安全场景通过。复验不增加浏览器、真实多人设备、Windows/Electron/App Store 或生产部署验收；构建包体积及测试/依赖弃用提醒仍保留。
