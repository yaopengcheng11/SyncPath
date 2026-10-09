# SyncPath 品牌与界面规范 v0.1

日期：2026-09-16。范围：本项目的开发规划、架构图和未来 Web UI。当前应用样式未被修改。

## 1. 提取依据与边界

本规范根据现有源码中的 Tailwind 类和少量色值提取：

- `index.html:43`：`bg-slate-50 text-slate-900 font-sans`。
- `components/AuthScreen.tsx:57`：白色卡片、Slate 边界和大圆角。
- `components/AuthScreen.tsx:59`：深色品牌块；第 62 行为粗体产品名。
- `components/AuthScreen.tsx:74`：Indigo 焦点与浅色底；第 122 行为靛蓝文字。
- `App.tsx`：Indigo 操作按钮，项目颜色数组中的 Indigo 500。

颜色按项目声明的 Tailwind 3 语义映射，并以其[官方色板](https://v3.tailwindcss.com/docs/customizing-colors)核对。本次属于源码提取；当前应用依赖与构建尚未恢复，没有宣称完成运行中界面的像素取样。深色元素已经存在，完整暗色主题属于新增设计建议。

## 2. 颜色与语义

| 角色 | 色值 | 用法 / 来源 |
|---|---|---|
| `paper` / canvas | `#f8fafc` | Slate 50；页面背景 |
| `paper-2` / subtle | `#f1f5f9` | Slate 100；分组、只读区域 |
| surface | `#ffffff` | 白色；卡片、表格、编辑器 |
| `ink` / text | `#0f172a` | Slate 900；主要文字、深色品牌块 |
| heading | `#1e293b` | Slate 800；标题 |
| `muted` / secondary | `#475569` | Slate 600；正文辅助信息 |
| `soft` / metadata | `#64748b` | Slate 500；时间、标注 |
| disabled | `#94a3b8` | Slate 400；仅非关键禁用信息 |
| `rule` / divider | `#e2e8f0` | Slate 200；装饰性分隔线 |
| `rule-solid` / control | `#64748b` | Slate 500；需要明显边界的输入控件 |
| `accent` / action | `#4f46e5` | Indigo 600；主要动作、当前选中 |
| accent-hover | `#4338ca` | Indigo 700；悬停 |
| `accent-tint` / selected-bg | `#eef2ff` | Indigo 50；选中背景 |
| `link` | `#4338ca` | Indigo 700；可操作链接、外部连线 |
| focus | `#6366f1` | Indigo 500；2px 焦点环 |

变化说明：将旧界面中部分 `text-slate-400` 正文提升到 Slate 600，以改善可读性；控件边界与纯装饰分隔线分开。结构色继续灰白、深色和靛蓝。

状态颜色是补充语义：成功用深绿色，警告用深琥珀色，错误用深红色；始终同时显示图标与文字。路线图项目可保留自定义颜色，但文字内容、选中状态和权限信息不得仅靠颜色区分。

## 3. 字体与密度

保留 Tailwind `font-sans` 的系统字体栈顺序：`ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`。不引入新的远程品牌字体。中文使用系统字体回退，具体字体因平台而异。

| 角色 | 字体 / 字号 / 字重 | 说明 |
|---|---|---|
| title | 系统 sans，28–32px，800 | 保留深色、紧凑的产品标题；正文页面无需处处 900 |
| node-name | 系统 sans，14–16px，600 | 架构图节点；中文不低于 12px |
| body | 系统 sans，14px，400/500 | 表格、表单与正文 |
| sublabel | 系统 sans，12px，400 | 中文说明保持可读；技术值可用系统 monospace |
| eyebrow / tag | 系统 sans，12px，600 | 中文不使用夸大的字符间距 |
| arrow-label | 系统 monospace，9–11px，400 | API、JSON、Queue 等技术标记 |
| callout | 系统 sans，14px，500 | 产品说明保持同一品牌字体 |

字体复现说明：系统字体栈为源码可核对；技术 monospace 是新增角色，采用 `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`。图中优先保持 SyncPath 原有 sans 标题，未采用技能默认的衬线标题。生成 HTML 的 computed style 将在浏览器检查；声明的系统栈不等于跨平台完全相同的像素。

- 4px 间距基础；常用 8 / 12 / 16 / 24 / 32。
- 常规表格行高 40px，舒适模式 48px；长文本单元格允许展开。
- 控件高 36–40px；桌面图标按钮点击区域至少 32×32px，触屏主要按钮至少 44×44px。
- UI 卡片圆角 12px，输入框 8px，状态标签 4px；登录页的大圆角可保留。
- 架构图使用 8px 圆角和边框，无投影；专业列表视图减少大面积阴影与多余留白。

## 4. 品牌提取回执

| 项目 | 结论 | 置信度 |
|---|---|---|
| 配色 | Slate 50 / 900 + Indigo 600 主色；白色表面 | 高：多处源码一致 |
| 标题与正文 | 系统 sans；原页面偏粗标题 | 高：源码字体类可见 |
| 技术字体 | 系统 monospace | 新增建议，非旧品牌事实 |
| 密度 / 控件尺寸 | 面向专业桌面工具调整 | 新增建议 |
| 完整暗色主题 | 后续版本再实现，需单独对比度检查 | 未实施 |
| 运行中旧 UI 取样 | 当前未完成 | 不作为提取证据 |

## 5. 组件和状态验收

未来实现的 UI 应满足：

1. Button、Input、Select、Dialog、Table、EmptyState、Toast、StatusBadge、Tabs、SidePanel 使用同一 token 集。
2. 普通正文对比度至少 4.5:1；关键控件轮廓和焦点至少 3:1；不可把仅作装饰的浅边框作为唯一边界。
3. 每个异步页面都有加载、空、失败、无权限、保存中、保存成功和冲突状态。
4. 键盘可完成登录、建项、筛选、评审；对话框关闭后焦点回到触发控件。
5. 1440×900、1280×800 和 390×844 检查。手机优先可读和评论，复杂路线图提供列表替代。
6. 深色按钮与靛蓝按钮分工：深色承载产品主入口，靛蓝承载当前对象主要动作；同一区域避免多个同等强调按钮。

本文件是项目内样式来源；本轮不修改用户全局技能或其他项目的品牌配置。架构图见 [SYNCPATH_TARGET_ARCHITECTURE.html](SYNCPATH_TARGET_ARCHITECTURE.html)。

## 6. 本轮验证回执

2026-09-16：架构 HTML 通过 diagram-design 自检；Chrome 检查确认系统字体栈、800 字重标题、Slate 50 背景；7 个节点文字均在边界内。1440px、1280px 桌面与 390px 手机宽度下没有整页横向溢出，手机上的架构画布可独立横向滚动。

按 WCAG 相对亮度公式计算：ink/canvas 17.06:1，secondary/canvas 7.24:1，metadata/canvas 4.55:1，白字/Indigo 600 6.29:1，焦点/canvas 4.27:1。这里验证的是文档配色与图示，不代表尚未实施的全部 UI 控件通过了可访问性验收。
