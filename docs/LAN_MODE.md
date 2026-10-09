# SyncPath 局域网模式

局域网模式适合公司内网的一台机器作为 SyncPath 服务端，团队成员通过浏览器访问这台机器的地址。所有用户仍然使用自己的账号，权限由 API 统一校验；项目事件通过 SSE 推送，卡片更新和在线状态会同步到其他浏览器。

## 启动

在服务端机器上确认 PostgreSQL 已启动，并准备好 `apps/api/.env`。然后运行：

```bash
npm ci
npm run db:migrate -w @syncpath/api
npm run dev:lan
```

默认 Web 端口是 `5183`，API 端口是 `3160`。如果这台机器已有其他服务占用
其中一个端口，可以显式换一个端口启动，避免浏览器打开到其他项目：

```bash
VITE_PORT=5200 API_PORT=3200 npm run dev:lan
```

终端会同时启动：

- API：`0.0.0.0:<API_PORT>`（默认 `3160`）
- Web：`0.0.0.0:<VITE_PORT>`（默认 `5183`）

在同一个局域网的其他电脑上打开服务端机器的局域网 IP，例如：

```text
http://192.168.1.20:5183
```

如果 macOS 防火墙弹出访问提示，需要允许 Node 接受局域网连接。不要把 `SESSION_SECRET`、数据库密码提交到仓库。

## 协作能力

打开同一个项目的用户会订阅：

- 卡片创建、编辑、移动和删除事件；
- 项目成员权限变化事件；
- 在线成员、查看/编辑状态和目标卡片；
- revision 冲突保护，避免后写入覆盖先写入。

成员和权限入口：在首页选中工作区后点击卡片旁的齿轮进入 **Workspace settings**；
成员管理、改名和归档都从这个面板进入。Owner/Admin 可以修改名称，只有 Owner
可以归档工作区（归档会隐藏数据，不会立即物理删除）；
进入项目后点击 **Members** 管理项目成员。工作区角色是 Owner / Admin / Member，
项目角色是 Lead / Editor / Viewer。Owner/Admin 负责团队管理，Editor 可以编辑
卡片，Viewer 只读。

事件通道是单 API 实例内存广播，适合一台内网服务端的团队使用。部署多台 API 实例前，需要把事件总线替换为 Redis/NATS 等共享消息系统。

当前同步粒度是项目卡片、权限和在线状态；卡片支持 @成员、@所有人及持久化站内通知，
可通过页面右上角的铃铛查看。字符级协同编辑（CRDT）和评论仍属于后续迭代。

## 生产部署建议

内网正式使用时建议由 Nginx/Caddy 将 Web 和 API 放在同一个 HTTPS 域名下，并将 `COOKIE_SECURE=true`。局域网开发模式使用 HTTP，仅用于受控内网环境。

`preview:lan` 只启动构建后的 Web 静态服务；正式部署时仍需让同一域名下的
反向代理把 `/api` 转发到 API 服务。
