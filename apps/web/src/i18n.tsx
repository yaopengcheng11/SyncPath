import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'en' | 'zh';

type MessageParams = Record<string, string | number>;

const STORAGE_KEY = 'syncpath_locale';

const ZH_MESSAGES: Record<string, string> = {
  'Loading…': '加载中…',
  'API mode': 'API 模式',
  'Team planning': '团队计划',
  'Back to projects': '返回项目列表',
  'Open project': '打开项目',
  'e.g. AI assistant launch': '例如：AI 助手上线计划',
  'United States': '美国',
  'The end date must be on or after the start date.': '结束日期不能早于开始日期。',
  'Could not create this project. Your details are kept here. Please try again.': '项目暂时无法创建，填写的内容已保留，请重试。',
  'Discard project details?': '放弃创建项目？',
  'This project has not been created. Your unsaved details will be discarded.': '项目尚未创建，关闭后会丢弃已填写的内容。',
  'Could not save this card': '卡片暂时无法保存',
  'Your draft is safe. Check your connection and try again.': '你的草稿已保留，请检查连接后重试。',
  'Your session has expired. Sign in again to save this draft.': '登录已过期，草稿已保留。请重新登录后保存。',
  'You no longer have permission to edit this card. Your draft is still here.': '你已没有这张卡片的编辑权限，草稿仍然保留在这里。',
  'This card is no longer available. Your draft is still here.': '这张卡片已无法访问，草稿仍然保留在这里。',
  'This card changed while you were editing. Your draft is safe.': '有人在你编辑期间修改了这张卡片，你的草稿已保留。',
  'Review the latest version before replacing it with your draft.': '请先对照最新内容，再决定是否用你的草稿替换。',
  'Latest saved version': '最新保存的内容',
  'Replace with my draft': '用我的草稿替换',
  'Replace latest card?': '替换最新内容？',
  'The latest saved content will be replaced with your draft. This may overwrite a teammate’s changes.': '保存后将用你的草稿替换最新内容，可能覆盖其他成员的修改。',
  'Replace and save': '替换并保存',
  'The latest version is unavailable. Refresh the project before trying again.': '暂时无法获取最新内容，请刷新项目后再试。',
  'Delete cards?': '删除卡片？',
  'Delete {{count}} selected cards? This cannot be undone.': '确定删除选中的 {{count}} 张卡片？此操作无法撤销。',
  'Unlock level': '解除层级锁定',
  'Lock level': '锁定此层级',
  'Drag to move · Double-click to edit · Space to pan': '拖动调整日期 · 双击编辑 · 按住空格移动视图',
  'Double-click to view · Space to pan': '双击查看 · 按住空格移动视图',
  'Double-click the timeline to add your first card': '双击时间轴，添加第一张卡片',
  'Team Roadmap Platform': '团队路线图平台',
  'Sign In': '登录',
  'Need an account?': '还没有账号？',
  'Already have an account?': '已有账号？',
  'Continue as Guest': '以访客继续',
  'Create Account': '创建账户',
  'Working…': '处理中…',
  'Username': '用户名',
  'Email': '邮箱',
  'Password': '密码',
  'Confirm Password': '确认密码',
  'Enter username': '请输入用户名',
  'Enter password': '请输入密码',
  'Confirm password': '再次输入密码',
  'At least 8 characters': '至少 8 个字符',
  'Please enter a valid email address.': '请输入有效的邮箱地址。',
  'Passwords do not match.': '两次密码不一致。',
  'Authentication failed.': '登录失败。',
  'Guest mode is disabled in the API build of SyncPath. Use a real account, or load the legacy local-only build.': 'API 模式已禁用访客登录，请使用真实账户。',
  'Workspaces': '工作区',
  '刷新工作区': '刷新工作区',
  'No workspaces yet': '还没有工作区',
  'Workspaces group your projects and members. Create your first one to begin.': '工作区用于组织项目和成员。创建第一个工作区后即可开始。',
  'Workspace name': '工作区名称',
  'Workspace Name': '工作区名称',
  'Create': '创建',
  'Projects': '项目',
  'New Project': '新建项目',
  'Compare': '对比',
  'No projects in this workspace yet.': '此工作区还没有项目。',
  'No projects selected': '未选择项目',
  'Delete': '删除',
  'Delete project': '删除项目',
  'Keep project': '保留项目',
  'Sign out': '退出登录',
  'Close': '关闭',
  'Close dialog': '关闭弹窗',
  'Cancel': '取消',
  'Confirm': '确认',
  'Owner': '所有者',
  'Admin': '管理员',
  'Member': '成员',
  'Lead': '负责人',
  'Editor': '编辑者',
  'Viewer': '查看者',
  'Workspace settings': '工作区设置',
  'Your role:': '你的角色：',
  'What does Owner mean?': 'Owner 是什么？',
  'Owner is the highest workspace role. The Owner manages members, can rename the workspace, and can archive it.': 'Owner 是工作区的最高权限角色，可以管理成员、修改名称和归档工作区。',
  'Team members': '团队成员',
  'Manage people and workspace roles': '管理成员和工作区权限',
  'Save name': '保存名称',
  'Danger zone': '危险操作',
  'Archiving hides this workspace and all of its projects from the team. The data remains preserved for a future recovery workflow.': '归档后，团队将看不到这个工作区及其项目，但数据会保留，后续可恢复。',
  'Archive workspace': '归档工作区',
  'Keep workspace': '保留工作区',
  'Only the workspace Owner or Admin can change workspace settings.': '只有工作区 Owner 或 Admin 可以修改设置。',
  'Only the workspace Owner can archive a workspace.': '只有 Owner 可以归档工作区。',
  'Workspace access': '工作区成员',
  'Invite by username or email': '通过用户名或邮箱邀请',
  'Invite': '邀请',
  'Inviting…': '邀请中…',
  'Loading members…': '正在加载成员…',
  'No project members yet.': '还没有项目成员。',
  'Members & permissions': '成员与权限',
  'Team access': '项目成员',
  'Project settings, members and all content': '项目设置、成员和全部内容',
  'Create and edit project content': '创建和编辑项目内容',
  'Read-only access to project content': '只读查看项目内容',
  '完整管理和工作区归属': '完整管理和工作区归属',
  '管理成员和项目': '管理成员和项目',
  '参与工作区项目': '参与工作区项目',
  'You': '你',
  'Remove team member?': '移除团队成员？',
  'Remove project member?': '移除项目成员？',
  'Remove member': '移除成员',
  'Keep member': '保留成员',
  'Timeline update failed': '时间轴更新失败',
  'Unable to save entry': '记录保存失败',
  'Export failed': '导出失败',
  'This will hide the project and its timeline history from the workspace. The action can be audited, but the project will no longer be available to the team.': '项目及其时间轴历史将从工作区隐藏，团队将无法继续访问。',
  'Its projects will be hidden from the team. The data will be preserved and can be recovered through a future workspace recovery flow.': '工作区中的项目会对团队隐藏，数据会保留，后续可通过恢复流程找回。',
  'Project details incomplete': '项目信息不完整',
  'Choose a workspace and fill in the project name, start date, and end date.': '请选择工作区，并填写项目名称、开始日期和结束日期。',
  'Unable to create project': '项目创建失败',
  'Unable to delete project': '项目删除失败',
  'Please try again.': '请重试。',
  'Live': '实时',
  'Reconnecting': '重新连接',
  'online': '在线',
  'Members': '成员',
  'Snapshot': '快照',
  'Settings': '设置',
  'Reset View (H)': '重置视图 (H)',
  'Shrink Timeline': '缩小时间轴',
  'Stretch Timeline': '拉伸时间轴',
  'Toggle Holidays': '显示/隐藏节假日',
  'Primary': '主要',
  'Secondary': '次要',
  'Minor': '普通',
  'Action Completed': '操作完成',
  'Export Snapshot': '导出快照',
  'Customize your export.': '自定义导出内容。',
  'Background': '背景',
  'Standard': '标准',
  'Alpha': '透明',
  'Download PNG': '下载 PNG',
  'Multi-View': '多项目视图',
  'Interactive Mode: Space + Wheel to Zoom • Space + Drag to Pan': '交互模式：空格 + 滚轮缩放 · 空格 + 拖动平移',
  'Publish Entry': '发布记录',
  'Entry Type': '记录类型',
  'Key Objectives': '关键目标',
  'Objective (e.g. Launch MVP)': '目标（例如：发布 MVP）',
  'Overview': '概览',
  'Details': '详情',
  'Key updates for stakeholders (displayed on timeline card)…': '面向相关成员的关键进展（会显示在时间轴卡片上）…',
  'Specific technical details, blockers, or execution notes…': '技术细节、阻塞事项或执行备注…',
  'Draft Summary · R0 暂缓': '生成摘要 · R0 暂缓',
  'Key objective required': '请填写关键目标',
  'Add a short objective before publishing this entry.': '发布记录前，请先填写一个简短的关键目标。',
  'AI summary is coming later': 'AI 摘要功能即将推出',
  'AI summarization is deferred to the R1 capability rollout.': 'AI 摘要将在 R1 能力阶段提供。',
  'Edit card': '编辑卡片',
  'New card': '新建卡片',
  'Card title': '卡片标题',
  'e.g. Launch MVP': '例如：发布 MVP',
  'Timeline level': '时间轴层级',
  'Milestone': '里程碑',
  'Major deadline': '关键交付节点',
  'Phase checkpoint': '阶段节点',
  'Stage goal': '阶段目标',
  'Task detail': '执行事项',
  'Execution detail': '执行细节',
  'What needs to happen at this point?': '这个节点需要完成什么？',
  'Add context, blockers, or owners…': '补充背景、阻塞问题或负责人…',
  'Mention a teammate or everyone': '输入 @ 提及成员或所有人',
  'Mention a teammate': '提及项目成员',
  'Notify everyone on this project': '通知本项目所有成员',
  'Everyone': '所有人',
  'Save card': '保存卡片',
  'Saving…': '保存中…',
  'Discard changes?': '放弃修改？',
  'Your edits to this card have not been saved.': '这张卡片的修改尚未保存。',
  'Discard': '放弃修改',
  'Keep editing': '继续编辑',
  'Team list unavailable': '成员列表暂不可用',
  'Wait for the project members to load before saving a mention.': '请等待项目成员加载后再保存提及。',
  'Mentions': '提及我的',
  'Close mentions': '关闭提及列表',
  'No mentions yet': '还没有人提及你',
  'Unable to load mentions.': '提及列表加载失败。',
  'mentioned you': '提及了你',
  '{{count}} unread': '{{count}} 条未读',
  'Unable to open mention': '无法打开提及',
  'This project is no longer available.': '这个项目已不可访问。',
  'Title': '名称',
  'Holiday Region': '节假日地区',
  'Start Date': '开始日期',
  'End Date': '结束日期',
  'Description': '描述',
  'Optional context for the team': '给团队的补充说明',
  'Project name': '项目名称',
  'No active roadmaps.': '还没有进行中的路线图。',
  'Start Project': '开始创建项目',
  'Create Project': '创建项目',
  'Workspace:': '工作区：',
  'Select a workspace first': '请先选择工作区',
  'workspace': '工作区',
  'private': '私有',
  'active': '进行中',
  'archived': '已归档',
  'Understood': '知道了',
  'project': '项目',
  'Refresh workspaces': '刷新工作区',
  'No workspaces yet. Create one to start tracking milestones.': '还没有工作区。创建一个工作区来开始跟踪里程碑。',
  'Your workspace role': '你的工作区角色',
  'You are the owner of this workspace': '你是这个工作区的所有者',
  'Manage workspace': '管理工作区',
  'Creating…': '创建中…',
  'Create failed': '创建失败',
  'Failed to create project': '项目创建失败',
  'Configuration': '配置',
  'Roadmap settings': '路线图设置',
  'Project Name': '项目名称',
  'Lead / Team': '负责人 / 团队',
  'Holiday Calendar': '节假日设置',
  'China': '中国',
  'USA': '美国',
  'None': '无',
  'Done': '完成',
  'Archive': '归档',
  'Archiving…': '归档中…',
  'Unable to update workspace.': '工作区更新失败。',
  'Unable to archive workspace.': '工作区归档失败。',
  'Close workspace settings': '关闭工作区设置',
  'Close workspace members panel': '关闭工作区成员面板',
  'Close members panel': '关闭成员面板',
  'Full workspace control and ownership': '完整管理和工作区归属',
  'Manage members and projects': '管理成员和项目',
  'Participate in workspace projects': '参与工作区项目',
  'Unable to load workspace members.': '加载工作区成员失败。',
  'Unable to change workspace role.': '修改工作区角色失败。',
  'Unable to remove workspace member.': '移除工作区成员失败。',
  'Unable to load members.': '加载成员失败。',
  'Unable to invite member.': '邀请成员失败。',
  'Unable to change role.': '修改角色失败。',
  'Unable to remove member.': '移除成员失败。',
  'Project members and permissions': '项目成员和权限',
  'Copied {{count}} items': '已复制 {{count}} 项',
  'Deleted {{count}} items': '已删除 {{count}} 项',
  '{{count}} items': '{{count}} 项',
  'Copy': '复制',
  'Copy failed': '复制失败',
  'Primary Log': '主要记录',
  'Secondary Log': '次要记录',
  'Minor Log': '普通记录',
  'Significant milestone or delivery': '重要里程碑或交付',
  'Important update or sync': '重要进展或同步',
  'Regular routine check-in': '日常例行更新',
  'Editing': '编辑中',
  'Viewing': '查看中',
  'Pending update...': '等待更新…',
  'AI capability is deferred in R0; scheduled for R1 (DEV-018)': 'AI 能力在 R0 暂缓，计划在 R1（DEV-018）提供',
  'Key updates for stakeholders (displayed on timeline card)...': '面向相关成员的关键进展（会显示在时间轴卡片上）…',
  'Specific technical details, blockers, or execution notes...': '技术细节、阻塞事项或执行备注…',
  'Save failed': '保存失败',
  'Unable to move entry': '移动记录失败',
  'Unable to delete entry': '删除记录失败',
  'Lock Log': '锁定记录',
  'Unlock Log': '解锁记录',
  'TODAY': '今天',
  'Processing...': '处理中…',
  'Select for multi-view': '选择用于多项目视图'
};

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (message: string, params?: MessageParams) => string;
}

const I18nContext = createContext<I18nValue>({
  locale: 'en',
  setLocale: () => undefined,
  t: (message) => message
});

function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'zh' || stored === 'en') return stored;
  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function interpolate(message: string, params?: MessageParams): string {
  if (!params) return message;
  return message.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? ''));
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = (next: Locale): void => {
    setLocaleState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
  };

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    }
  }, [locale]);

  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (message, params) => interpolate(locale === 'zh' ? (ZH_MESSAGES[message] ?? message) : message, params)
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export const LanguageSwitcher: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { locale, setLocale } = useI18n();
  const nextLocale: Locale = locale === 'en' ? 'zh' : 'en';
  return (
    <button
      type="button"
      onClick={() => setLocale(nextLocale)}
      className={`inline-flex items-center gap-2 rounded-full border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 ${compact ? 'px-3 py-2' : 'px-4 py-2.5'}`}
      title={locale === 'en' ? '切换为中文' : 'Switch to English'}
      aria-label={locale === 'en' ? '切换为中文' : 'Switch to English'}
    >
      <i className="fas fa-language text-xs"></i>
      {locale === 'en' ? '中文' : 'English'}
    </button>
  );
};
