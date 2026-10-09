# SyncPath

面向 AI 产品经理和团队的时间线计划工具：把大目标拆成里程碑、阶段节点和执行事项，在同一张时间线上安排、调整与协作。

项目正在从可运行工具打磨为正式产品，当前交付形态为 **Web 应用 + 独立 API + PostgreSQL**。桌面安装包和 App Store 上架尚未完成验收。

[GitHub 仓库](https://github.com/yaopengcheng11/SyncPath) · [产品打磨路线图](docs/PRODUCT_POLISHING_ROADMAP.md) · [局域网使用说明](docs/LAN_MODE.md)

## 当前可以做什么

- 创建工作区，集中管理团队成员与项目；重命名、归档工作区。
- 为项目设置负责人、编辑者和查看者，按权限协作。
- 创建不限于三张卡片的计划：**里程碑 / 阶段节点 / 执行事项**是三个展示层级，每层可放多张卡片。
- 在时间线上拖动卡片，或选中后用左右方向键调整日期，修改会保存到服务端。
- 双击卡片打开居中的毛玻璃编辑弹窗；保存冲突时保留草稿，对照最新内容后明确确认覆盖。
- 输入 `@` 选择项目成员或 `@所有人`，保存后生成站内通知，通过铃铛查看。
- 在中文与英文界面之间切换，工作区、项目名称与卡片内容支持中文输入。
- 在公司局域网共用一个服务，同步项目变化、在线状态及编辑目标；同一账号的其他窗口也能收到变化。

时间线目前按**自然日**安排，适合人工倒排和调整计划。自动按工作日倒排、任务依赖和工期联动仍在规划中。国家节假日选择与标记已移除；新项目默认不启用国家日历，旧数据中的日历字段保留兼容。

## 工作区与权限

工作区是团队与项目的容器。创建者自动成为 Owner；项目创建者自动成为 Lead。成员设置入口位于工作区和项目的管理面板，邀请的用户需要先注册账号。

| 范围 | 角色 | 主要能力 |
| --- | --- | --- |
| 工作区 | Owner（所有者） | 管理工作区、成员及项目；可归档工作区 |
| 工作区 | Admin（管理员） | 管理工作区和成员；管理项目；不能归档工作区 |
| 工作区 | Member（成员） | 参与工作区，创建项目；具体项目操作受项目权限约束 |
| 项目 | Lead（负责人） | 管理项目和成员，编辑及删除项目、卡片 |
| 项目 | Editor（编辑者） | 编辑项目和卡片，不能管理项目成员或删除项目 |
| 项目 | Viewer（查看者） | 查看项目与卡片，不能修改 |

工作区 Owner/Admin 拥有相应项目管理权限。后端每次请求校验身份、工作区及项目权限；界面隐藏按钮不能替代后端鉴权。工作区和项目的删除入口采用归档或软删除，归档恢复界面尚未提供。

## 技术栈

| 部分 | 实现 |
| --- | --- |
| 仓库 | npm workspaces + TypeScript |
| 前端 | React 18、Vite 5、Tailwind CSS 3 |
| 后端 | NestJS 10、Fastify、Prisma 5、PostgreSQL 16 |
| 协作 | SSE 事件流、对象级写入、版本号冲突检查 |
| 身份 | HttpOnly 会话 Cookie、bcrypt 密码哈希 |
| 图标 | 本地打包的 Font Awesome 6.7.2，主界面不依赖图标 CDN |

## 首次运行

准备 Node.js 18.18 或更新版本、支持 workspaces 的 npm，以及可连接的本地 PostgreSQL 16。本次验证环境为 Node.js 22.22.3、npm 10.9.8。以下命令均从仓库根目录执行。

```bash
git clone https://github.com/yaopengcheng11/SyncPath.git
cd SyncPath
cp apps/api/.env.example apps/api/.env
```

**先创建并填写 `.env`，再安装依赖**：安装后的自动步骤会构建领域包并生成 Prisma Client。

使用你熟悉的数据库管理方式创建本地开发角色和数据库。下面是可在 PostgreSQL 管理连接中执行的示例；把 `CHANGE_ME` 换成自己的本地密码，已有数据库可直接使用。

```sql
CREATE ROLE syncpath WITH LOGIN CREATEDB PASSWORD 'CHANGE_ME';
CREATE DATABASE syncpath_dev OWNER syncpath;
```

将 `apps/api/.env` 中的连接改为对应值，例如：

```dotenv
DATABASE_URL="postgresql://syncpath:CHANGE_ME@127.0.0.1:5432/syncpath_dev?schema=public"
```

`.env.example` 的密码和 `SESSION_SECRET` 只用于说明配置格式；应替换为自己的值。可生成随机会话密钥，再填入 `.env`：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npm ci
npm run db:migrate:deploy -w @syncpath/api
npm run dev
```

打开 <http://localhost:5183/> 注册并登录。新安装无需预建固定名称的测试数据库，也无需先运行演示数据脚本。

如需本地演示账号，可额外执行 `npm run db:seed -w @syncpath/api`。首次创建的账号为 `demo`，密码为 `demo-pass-1234`。该脚本会删除并重建 `demo-workspace`，仅用于可重置的本地演示数据库；已有同邮箱用户不会被重设密码。

## 本地开发与局域网

`npm run dev` 同时启动前后端，也可以在两个终端分别启动：

```bash
npm run dev:api
npm run dev:web
```

默认 Web 端口为 `5183`、API 为 `3160`。浏览器通过 Web 服务的 `/api` 代理访问后端，登录 Cookie 由浏览器自动携带。

公司局域网中，由一台主机运行：

```bash
npm run dev:lan
```

同事访问终端显示的 `http://<主机内网 IP>:5183/`，分别注册或登录账号，再加入工作区及项目。局域网脚本绑定网络接口，并使用固定端口；如果端口被占用，可一起改 Web 和 API：

```bash
VITE_PORT=5200 API_PORT=3200 npm run dev:lan
```

本机开发若更换 API 端口，也要让 Web 代理指向新地址：

```bash
API_PORT=3200 VITE_PORT=5200 VITE_API_TARGET=http://127.0.0.1:3200 npm run dev
```

当前 SSE 协作服务运行在单个 API 实例中，断线重连后重新获取项目数据。多实例部署需要共享事件通道。更多网络、防火墙和 HTTPS 配置见 [LAN_MODE.md](docs/LAN_MODE.md)。

## 检查与测试

```bash
npm run typecheck
npm test
```

也可以分别运行：

```bash
npm run test -w @syncpath/web
npm run test -w @syncpath/api
npm run test:safety -w @syncpath/api
```

API 测试入口会创建唯一命名的临时 PostgreSQL 数据库、执行迁移、启动独立随机端口 API，核对运行 token 后才加载测试文件。正常退出或处理中断时，停止本轮进程并删除本轮自建数据库。直接运行 Vitest 指向开发库或日常 API 会被拒绝。

测试需要本地数据库角色拥有 `CREATEDB`。如开发角色没有此权限，可为本轮指定独立的本地管理连接：

```bash
INTEGRATION_ADMIN_DATABASE_URL='postgresql://test_admin:CHANGE_ME@127.0.0.1:5432/postgres' npm run test -w @syncpath/api
```

前端回归覆盖卡片移动、冻结编辑版本和清空已保存字段；后端覆盖身份、租户隔离、成员撤权、导入、并发版本冲突、提及通知、协作事件以及旧日历字段兼容。测试通过不代表桌面安装、生产部署或 App Store 审核已通过。

最近一次本地验证：**2026-10-09**。

| 检查 | 结果 |
| --- | --- |
| 全部 workspace 类型检查 | 通过 |
| API 隔离测试 | 50/50，通过 9 个测试文件；临时环境完成清理 |
| 前端回归测试 | 12/12，通过 3 个测试文件 |
| 测试目标安全检查 | 5/5，通过 |
| 干净副本安装 | 按锁文件安装通过，自动构建领域包并生成 Prisma Client |
| 干净副本生产构建 | Web、API 和领域包全部通过 |
| 接口类型一致性 | 重新生成的客户端类型与提交文件一致 |

## 构建与部署边界

```bash
npm run build
```

该命令依次构建领域包、Web 和 API。Web 产物位于 `apps/web/dist`，API 产物位于 `apps/api/dist`。

`npm run preview -w @syncpath/web` 和 `npm run preview:lan` 只提供 Web 静态预览，不会自动启动 API，也不能替代完整生产部署。

旧 `deploy.sh` 已停用，会提示静态部署流程过时并退出；它不能部署当前产品。当前部署必须同时考虑 Web、API 和数据库。

正式部署还需配置 PostgreSQL、运行 API、为 Web 配置同源 `/api` 反向代理、HTTPS、独立会话密钥及安全 Cookie。开发库与生产库应分开，演示账号和开发密钥不应带入正式环境。数据库备份、恢复演练、运行监控和上线流程尚需完成。

## API 与客户端类型

开发 API 提供以下入口：

- `http://localhost:3160/health`：服务与数据库健康状态。
- `http://localhost:3160/api/docs`：Swagger 接口文档。
- `http://localhost:3160/api/docs-json`：OpenAPI JSON，当前快照版本为 3.0.0。

接口以 `/api/v1` 为前缀，包含账号、工作区、项目、卡片、成员、协作、提及通知及旧数据导入。鉴权使用会话 Cookie；错误返回统一的 `statusCode / code / message` 等字段。

修改接口契约后，显式更新快照及客户端类型：

```bash
npm run openapi:dump -w @syncpath/api
npm run generate -w @syncpath/api-client
```

`openapi:dump` 会先构建 API，再独立生成快照，无需占用 API 监听端口。日常 API 启动也会更新快照；隔离测试 API 不会写回契约文件。

## 目录结构

```text
apps/
  web/
    src/AppV2.tsx              当前应用入口
    src/components/            时间线、卡片弹窗、成员管理与通知
    src/hooks/                 API 数据及协作状态
    src/i18n.tsx               中文与英文界面
    electron/                  尚未验收的桌面原型
  api/
    src/main.ts                API 启动入口
    src/common/                数据库、会话、鉴权与错误处理
    src/modules/               identity / workspaces / projects / entries
                               workspace-members / project-members
                               collaboration / mentions / imports / health
    prisma/                    数据模型、迁移与演示数据
    scripts/                   OpenAPI 导出及隔离测试入口
    test/                      后端回归测试
packages/
  domain/                      领域角色、权限与 ID
  api-client/                  请求客户端及生成的接口类型
  contracts/                   OpenAPI 快照
  config/                      共享 TypeScript 配置
docs/                          产品、品牌、架构和验收文档
```

`apps/web/src/App.tsx` 及旧 Yjs 协作实现保留用于历史参考，当前 `index.tsx` 加载的是 `AppV2`。Electron 相关脚本仍属原型，尚不能作为可交付桌面产品使用。

## 后续打磨方向

1. **计划能力**：阶段层级、折叠与筛选、依赖关系、工期和自动倒排。
2. **团队流程**：评论讨论、修改历史、归档恢复、权限体验和通知完善。
3. **可靠性**：数据库第二层隔离（RLS）、备份恢复、生产监控与多实例协作。
4. **AI 辅助**：计划草拟、风险提醒和总结；当前 AI 服务仍为占位实现，不能当作已上线功能。
5. **桌面与上架**：修复桌面打包，完善安装、更新、隐私说明及目标平台验收，再推进 App Store。

## 项目文档

- [当前产品打磨路线图](docs/PRODUCT_POLISHING_ROADMAP.md)
- [AI 产品团队平台规划](docs/AI_PRODUCT_TEAM_PLATFORM_PLAN.md)
- [开发框架与验收标准](docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md)
- [品牌与界面样式](docs/SYNCPATH_BRAND_STYLE.md)
- [目标架构图](docs/SYNCPATH_TARGET_ARCHITECTURE.html)
- [局域网与协作](docs/LAN_MODE.md)
- [R0 历史记录](docs/R0_NOTES.md) · [G1 独立审查](docs/G1_INDEPENDENT_REVIEW.md)

规划和历史审查文档记录的是阶段目标或当时状态；当前运行方式以本 README 和仓库脚本为准。
