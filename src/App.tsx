import { CredentialsPanel } from "./credentials";
import { AccountControls, MaterialIcon } from "./personalization";
import {
  groupMaterials,
  matchingQuestions,
  needsAttention,
  isProcessing,
} from "./inbox";
import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  Routes,
  Route,
  NavLink,
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Inbox,
  Library,
  Puzzle,
  Plus,
  Search,
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  FileText,
  Link2,
  Image,
  X,
  Check,
  Clock3,
  Cloud,
  PanelRight,
  History,
  Send,
  RefreshCw,
  Volume2,
  Folder,
  Keyboard,
  Sparkles,
  BookOpen,
  MoreHorizontal,
  Download,
  ShieldCheck,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { diffLines } from "diff";
import {
  api,
  useResource,
  useAction,
  ErrorBox,
  Loading,
  Spinner,
  Empty,
  Status,
  Modal,
  RichText,
  stages,
  date,
  type Data,
} from "./lib";

function Brand() {
  return (
    <span className="brand">
      <img
        className="brand-icon"
        src="/fenext-fox-transparent.png"
        alt=""
        width="40"
        height="40"
      />
      Fenext<span className="brand-dot">.</span>
    </span>
  );
}
export default function App() {
  const [user, setUser] = useState<Data | null>(null),
    [loaded, setLoaded] = useState(false);
  const location = useLocation();
  const previousPath = useRef("");
  useEffect(() => {
    api("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoaded(true));
    const clear = () => setUser(null);
    window.addEventListener("fenext-unauthorized", clear);
    return () => window.removeEventListener("fenext-unauthorized", clear);
  }, []);
  useEffect(() => {
    let last = Number(sessionStorage.getItem("scroll:" + location.key) || 0);
    if (!(
      previousPath.current === "/knowledge" &&
      location.pathname === "/knowledge"
    ))
      window.scrollTo(0, last);
    else last = window.scrollY;
    previousPath.current = location.pathname;
    const save = () => {
      last = window.scrollY;
      sessionStorage.setItem("scroll:" + location.key, String(last));
    };
    window.addEventListener("scroll", save);
    return () => window.removeEventListener("scroll", save);
  }, [location.key, location.pathname]);
  if (!loaded) return <Loading />;
  if (!user) return <Login onLogin={setUser} />;
  const quick = location.pathname === "/quick";
  return (
    <div className={quick ? "quick-app" : "app"}>
      {!quick && (
        <aside className="sidebar">
          <Link to="/" className="brand-link">
            <Brand />
          </Link>
          <div className="workspace-label">
            个人知识空间 <span>V1</span>
          </div>
          <nav>
            <NavLink to="/" end>
              <Inbox size={19} />
              收集箱
            </NavLink>
            <NavLink to="/knowledge">
              <Library size={19} />
              知识库
            </NavLink>
            <NavLink to="/sources">
              <Puzzle size={19} />
              来源与插件
            </NavLink>
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <span className="tiny-label">让知识产生连接</span>
              <p>
                从一次阅读，
                <br />
                到下一次产品判断。
              </p>
              <span className="line-art">
                ↗ <i>＋</i> ⌘
              </span>
            </div>
            <AccountControls user={user} onUser={setUser} />
          </div>
        </aside>
      )}
      <main className="main">
        <Routes>
          <Route path="/" element={<InboxPage />} />
          <Route path="/collect" element={<Collection userId={user.id} />} />
          <Route
            path="/quick"
            element={<Collection quick userId={user.id} />}
          />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/notes/:id" element={<NotePage />} />
          <Route path="/updates/:id" element={<ReviewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/onboarding" element={<SettingsPage onboarding />} />
          <Route
            path="*"
            element={
              <Empty
                icon={<Search />}
                headline="这里还没有内容"
                action={
                  <Link className="button primary" to="/">
                    返回收集箱
                  </Link>
                }
              >
                链接可能已失效。
              </Empty>
            }
          />
        </Routes>
      </main>
      {!quick && (
        <nav className="mobile-nav">
          <NavLink to="/" end>
            <Inbox size={21} />
            收集箱
          </NavLink>
          <NavLink to="/knowledge">
            <Library size={21} />
            知识库
          </NavLink>
          <AccountControls user={user} onUser={setUser} mobile />
        </nav>
      )}
    </div>
  );
}
function Login({ onLogin }: { onLogin: (v: Data) => void }) {
  const { data, error, reload } = useResource("/bootstrap"),
    action = useAction();
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [setupToken, setSetupToken] = useState(""),
    [policy, setPolicy] = useState(false);
  const nav = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const r = await api("/auth", { username, password, setupToken });
      onLogin(r.user);
      if (r.created && location.pathname === "/") nav("/onboarding");
    });
  };
  return (
    <div className="login-screen">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">READ. CONNECT. APPLY.</span>
          <h1>
            把读到的资料，
            <br />
            变成用得上的<span>知识。</span>
          </h1>
          <p>
            理解一个概念，建立一组联系。
            <br />
            为你的下一次产品判断，留下一份可靠的依据。
          </p>
          <div className="story-path">
            <span>
              <FileText />
              收集资料
            </span>
            <i>→</i>
            <span>
              <Sparkles />
              整理知识
            </span>
            <i>→</i>
            <span>
              <BookOpen />
              用于判断
            </span>
          </div>
        </div>
        <small>为应用层 AI PM 构建的个人知识空间</small>
      </section>
      <section className="login-form">
        <span className="eyebrow">YOUR KNOWLEDGE, CONNECTED</span>
        <h2>开启你的知识空间</h2>
        <p className="muted">让每一次阅读，都成为下一次思考的起点。</p>
        <ErrorBox
          message={error || action.error}
          retry={error ? reload : undefined}
        />
        <form onSubmit={submit}>
          <label>
            账号
            <input
              autoComplete="username"
              required
              minLength={2}
              maxLength={60}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入账号名称"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={10}
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 10 个字符"
            />
          </label>
          {data?.needsSetupToken && (
            <details>
              <summary>远程部署初始化</summary>
              <label>
                管理员初始化令牌
                <input
                  type="password"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                />
              </label>
            </details>
          )}
          <button className="primary full" disabled={action.busy || !data}>
            {action.busy ? <Spinner /> : null}
            {action.busy ? "正在进入…" : "进入知识空间"}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="auth-help">
          已有账号直接登录，新账号自动注册。
          <br />
          首次使用时，请设置至少 10 个字符的密码。
        </p>
        <button className="text-button muted" onClick={() => setPolicy(true)}>
          数据处理与隐私说明
        </button>
        {policy && (
          <Modal title="数据处理与隐私" onClose={() => setPolicy(false)}>
            <p>
              资料、聊天与笔记保存于你运行或部署的 Fenext 服务。AI
              处理会将提交资料和相关已有笔记发送给设置中选择的提供方。
            </p>
            <p>
              密钥加密保存，不写入笔记或日志。首次收集前可以暂后配置
              AI。当前个人测试版不自动删除历史；数据库与加密密钥需一起备份。
            </p>
          </Modal>
        )}
      </section>
    </div>
  );
}
function PageHead({
  overline,
  title,
  description,
  action,
}: {
  overline: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{overline}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
function InboxTask({
  task: t,
  reload,
  child = false,
  versionLabel,
}: {
  task: Data;
  reload: () => void;
  child?: boolean;
  versionLabel?: string;
}) {
  return (
    <div className={"task-row" + (child ? " question-row" : "")}>
      <div className="task-leading">
        {!child && <MaterialIcon task={t} onSaved={reload} />}
        <Link
          to={"/tasks/" + t.id}
          className="task-title"
          aria-label={
            "查看任务：" + (child ? t.question || "默认整理" : t.title)
          }
        >
          {child && (
            <div className="file-icon">
              {t.input.url ? (
                <Link2 size={20} />
              ) : t.input.images.length ? (
                <Image size={20} />
              ) : (
                <FileText size={20} />
              )}
            </div>
          )}
          <div>
            <h3>{child ? t.question || "默认整理" : t.title}</h3>
            {!child && (
              <p className="question-preview">
                {t.question || "默认整理"}
                {versionLabel && ` · ${versionLabel}`}
              </p>
            )}
            <p>
              {t.result
                ? `新增 ${t.result.new.length} 项 · 已有 ${t.result.existing.length} 项 · 更新待查看 ${t.result.pendingUpdates ?? t.result.updates.length} 项`
                : t.error || "资料已接收"}
            </p>
          </div>
        </Link>
      </div>
      <Status
        value={t.stage}
        label={
          t.stage === "failed" && t.checkpoint.sourceIssue
            ? "未读到正文"
            : undefined
        }
      />
      <time>{date(t.created_at)}</time>
      <div className="task-row-actions">
        <DeleteTaskButton
          task={child ? { ...t, title: t.question || "默认整理" } : t}
          onDeleted={reload}
          compact
        />
      </div>
    </div>
  );
}
function InboxPage() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data, error, loading, reload } = useResource<Data[]>("/tasks", 4000);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const requestedStatus = params.get("status") || "all";
  const attentionCount = (data || []).filter(needsAttention).length;
  const selectedStatus =
    requestedStatus === "failed" ? "attention" : requestedStatus;
  const status =
    selectedStatus === "attention" && data && !error && attentionCount === 0
      ? "all"
      : selectedStatus;
  useEffect(() => {
    if (requestedStatus !== status) {
      const next = new URLSearchParams(params);
      next.set("status", status);
      setParams(next, { replace: true });
    }
  }, [params, requestedStatus, status, setParams]);
  const groups = groupMaterials(data || []);
  const items = groups
    .map((group) => ({
      ...group,
      matches: matchingQuestions(group, q, status),
    }))
    .filter((group) => group.matches.length);
  return (
    <div className="page">
      <PageHead
        overline="YOUR LEARNING STARTS HERE"
        title="收集箱"
        description="把值得停留的内容留下，交给 Fenext 整理。"
        action={
          <Link className="button primary" to="/collect">
            <Plus size={18} />
            收集资料
          </Link>
        }
      />
      <div className="toolbar">
        <div className="tabs">
          {[
            ["all", "全部资料"],
            ["active", "处理中"],
            ["completed", "已完成"],
            ...(attentionCount > 0 ? [["attention", "待你处理"]] : []),
          ].map(([key, label]) => (
            <button
              key={key}
              className={status === key ? "selected" : ""}
              aria-label={label}
              aria-pressed={status === key}
              onClick={() => setParams({ q, status: key })}
            >
              {label}
              {key === "all" && <span>{groups.length}</span>}
              {key === "attention" && <span>{attentionCount}</span>}
            </button>
          ))}
        </div>
        <div className="search">
          <Search size={17} />
          <input
            aria-label="搜索收集资料"
            placeholder="搜索资料或问题…"
            value={q}
            onChange={(e) =>
              setParams({ q: e.target.value, status }, { replace: true })
            }
          />
        </div>
      </div>
      <ErrorBox message={error} retry={reload} />
      {loading && !data ? (
        <Loading />
      ) : items.length ? (
        <div className="task-list">
          <div className="list-heading">
            <span>资料与整理结果</span>
            <span>状态</span>
            <span>收集时间</span>
          </div>
          {items.map((group) => {
            const t = group.latest;
            const versionLabel =
              group.versionCount > 1
                ? `内容版本 ${group.version} · 共 ${group.versionCount} 版`
                : undefined;
            if (group.tasks.length === 1)
              return (
                <InboxTask
                  key={group.key}
                  task={t}
                  reload={reload}
                  versionLabel={versionLabel}
                />
              );
            const expansionKey = `${status}:${q}:${group.key}`;
            const open =
              expanded[expansionKey] ?? (status !== "all" || !!q.trim());
            const processing = group.tasks.filter(isProcessing).length;
            const attention = group.tasks.filter(needsAttention).length;
            const complete = group.tasks.filter(
              (task: Data) => task.stage === "completed",
            ).length;
            return (
              <section
                className="material-group"
                key={group.key}
                aria-label={t.title}
              >
                <div className="material-heading-shell">
                  <MaterialIcon task={t} onSaved={reload} />
                  <button
                    className="material-heading"
                    aria-expanded={open}
                    aria-controls={`questions-${group.key}`}
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [expansionKey]: !open,
                      }))
                    }
                  >
                    <span className="material-title">
                      <span>
                        <strong>{t.title}</strong>
                        <span className="material-question">
                          最新问题：{t.question || "默认整理"}
                        </span>
                        <span className="material-meta">
                          {group.tasks.length} 条问题记录
                          {versionLabel && ` · ${versionLabel}`}
                        </span>
                      </span>
                    </span>
                    <span className="material-status">
                      {processing > 0 && (
                        <span className="processing">
                          {processing} 项处理中
                        </span>
                      )}
                      {attention > 0 && (
                        <span className="attention">
                          {attention} 项待你处理
                        </span>
                      )}
                      {complete > 0 && <span>{complete} 项已完成</span>}
                      {group.tasks.every(
                        (task: Data) => task.stage === "cancelled",
                      ) && <span>已取消</span>}
                    </span>
                    <time>{date(t.created_at)}</time>
                  </button>
                </div>
                <div
                  id={`questions-${group.key}`}
                  hidden={!open}
                  className="material-questions"
                >
                  {group.matches.length < group.tasks.length && (
                    <p className="matching-count">
                      显示匹配的 {group.matches.length} 条问题，共{" "}
                      {group.tasks.length} 条
                    </p>
                  )}
                  {group.matches.map((task: Data) => (
                    <InboxTask
                      key={task.id}
                      task={task}
                      reload={reload}
                      child
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={<Inbox size={32} />}
          headline={
            q || status !== "all"
              ? "没有匹配的资料"
              : "你的第一份知识，从这里开始"
          }
          action={
            <Link className="button secondary" to="/collect">
              <Plus size={16} />
              添加资料
            </Link>
          }
        >
          {q || status !== "all"
            ? "试着修改关键词或切换筛选条件。"
            : "粘贴一段让你好奇的文字，或保存一篇准备认真读的文章。"}
        </Empty>
      )}
      <div className="page-foot">
        <Cloud size={15} />
        接收后由服务端继续整理，离开页面也不会中断。
        <span>删除任务不影响已保存的知识笔记</span>
      </div>
    </div>
  );
}
function Collection({
  quick = false,
  userId,
}: {
  quick?: boolean;
  userId: string;
}) {
  const nav = useNavigate(),
    a = useAction();
  const location = useLocation();
  const source = location.state?.referenceSource;
  const draftKey =
    "fenext-draft:" + userId + (source?.id ? ":source:" + source.id : "");
  const submitScope = userId + (source?.id ? ":source:" + source.id : "");
  const blankDraft = {
    text: "",
    url: source?.url || "",
    urlMode: source?.url ? "reference" : "read",
    question: source?.question || "",
    images: [],
  };
  const [draft, setDraft] = useState<Data>(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || "null") || blankDraft;
    } catch {
      return blankDraft;
    }
  });
  const [saved, setSaved] = useState(""),
    [preview, setPreview] = useState("");
  const key = useRef(
    sessionStorage.getItem("fenext-submit-key:" + submitScope) ||
      crypto.randomUUID(),
  );
  const lastFingerprint = useRef(
    sessionStorage.getItem("fenext-submit-body:" + submitScope) || "",
  );
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
      setSaved("本地草稿已保存");
    } catch {
      setSaved("本地存储不足：图片草稿尚未保存，请保持此页打开");
    }
  }, [draft, draftKey]);
  const canSubmit = Boolean(
    draft.text.trim() ||
    draft.images.length ||
    (draft.url.trim() && draft.urlMode !== "reference"),
  );
  const images = async (files: FileList | File[]) => {
    const all = Array.from(files);
    if (draft.images.length + all.length > 4)
      throw new Error("单次最多 4 张图片");
    const result = await Promise.all(
      all.map(
        (f) =>
          new Promise<Data>((resolve, reject) => {
            if (
              !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
              f.size > 2 * 1024 * 1024
            )
              return reject(
                new Error("请使用不超过 2 MB 的 PNG、JPEG 或 WebP"),
              );
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ name: f.name, data: reader.result });
            reader.onerror = () => reject(new Error("图片读取失败"));
            reader.readAsDataURL(f);
          }),
      ),
    );
    setDraft((d) => ({ ...d, images: [...d.images, ...result] }));
  };
  const submit = () =>
    a.run(async () => {
      const fingerprint = JSON.stringify(draft);
      if (lastFingerprint.current && lastFingerprint.current !== fingerprint)
        key.current = crypto.randomUUID();
      lastFingerprint.current = fingerprint;
      sessionStorage.setItem("fenext-submit-body:" + submitScope, fingerprint);
      sessionStorage.setItem("fenext-submit-key:" + submitScope, key.current);
      const task = await api(
        "/tasks",
        { ...draft, app: quick ? "桌面快捷收集" : "Fenext" },
        "POST",
        { "Idempotency-Key": key.current },
      );
      localStorage.removeItem(draftKey);
      sessionStorage.removeItem("fenext-submit-key:" + submitScope);
      setDraft({ text: "", url: "", question: "", images: [] });
      nav("/tasks/" + task.id);
    });
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape" && quick) void window.fenext?.hide();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (canSubmit && !a.busy) void submit();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  return (
    <div className="page narrow">
      <Link className="back" to="/">
        <ArrowLeft size={16} />
        收集箱
      </Link>
      <PageHead
        overline="CAPTURE A LITTLE CURIOSITY"
        title={quick ? "快捷收集" : "收集资料"}
        description="不用先整理好。留下内容，以及你想弄明白的问题。"
        action={
          quick && window.fenext ? (
            <button
              className="secondary"
              onClick={() => window.fenext!.openMain()}
            >
              打开主窗口
            </button>
          ) : null
        }
      />
      <div
        className="panel collection-form"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void a.run(() => images(e.dataTransfer.files));
        }}
      >
        {source?.url && (
          <div className="notice">
            已保留原文链接和问题。请粘贴正文或添加截图，将新建一条补充资料任务；原任务与普通收集草稿仍保留。
          </div>
        )}
        <label>
          文章或论文链接
          <input
            type="url"
            placeholder="https://…"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
        </label>
        {draft.url && (
          <>
            <label className="source-mode">
              <input
                type="checkbox"
                checked={draft.urlMode === "reference"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    urlMode: e.target.checked ? "reference" : "read",
                  })
                }
              />
              链接仅作为来源记录，不读取链接
            </label>
            <p className="fineprint">
              微信公众号出现验证页时，请在微信中打开文章并完成验证，复制正文或上传截图，再勾选此项。只会整理你提交的内容，不代表读取了原文全文。
            </p>
          </>
        )}
        <label>
          文字内容
          <textarea
            aria-label="文字内容"
            rows={9}
            maxLength={60000}
            placeholder="粘贴文章片段、一个陌生概念，或你想进一步理解的内容…"
            value={draft.text}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void a.run(() => images(e.clipboardData.files));
              }
            }}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
        </label>
        <div className="attachments">
          {draft.images.map((im: Data, i: number) => (
            <div key={i}>
              <button
                className="image-preview"
                onClick={() => setPreview(im.data)}
              >
                <img src={im.data} alt={im.name} />
              </button>
              <button
                className="remove-image"
                aria-label={"移除 " + im.name}
                onClick={() =>
                  setDraft({
                    ...draft,
                    images: draft.images.filter(
                      (_: unknown, j: number) => i !== j,
                    ),
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <label className="upload">
            <Image size={18} />
            添加图片
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                if (e.target.files) void a.run(() => images(e.target.files!));
                e.target.value = "";
              }}
            />
          </label>
          <small>支持粘贴或拖入 · 最多 4 张 · 每张 2 MB</small>
        </div>
        <hr />
        <label>
          你想了解什么？<span className="optional">选填</span>
          <textarea
            rows={2}
            maxLength={2000}
            placeholder="例如：这个方法在 Agent 产品中解决什么问题？"
            value={draft.question}
            onChange={(e) => setDraft({ ...draft, question: e.target.value })}
          />
        </label>
        <ErrorBox message={a.error} />
        <div className="form-footer">
          <span>
            <Check size={14} />
            {saved}
          </span>
          <button
            className="primary"
            disabled={a.busy || !canSubmit}
            onClick={submit}
          >
            {a.busy ? <Spinner /> : <ArrowUpRight size={17} />}提交并整理
          </button>
        </div>
      </div>
      <p className="fineprint">
        收到服务端接收确认后，任务会自动继续。新知识自动保存，旧笔记的补充由你决定是否采用。
      </p>
      {preview && (
        <Modal title="图片预览" onClose={() => setPreview("")} wide>
          <img className="preview-full" src={preview} alt="资料图片" />
        </Modal>
      )}
    </div>
  );
}
function DeleteTaskButton({
  task,
  onDeleted,
  compact = false,
}: {
  task: Data;
  onDeleted: () => void;
  compact?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const a = useAction();
  return (
    <>
      <button
        className={compact ? "text-button" : "secondary"}
        aria-label={"删除任务：" + task.title}
        onClick={() => setConfirm(true)}
      >
        <Trash2 size={16} />
        {!compact && "删除任务"}
      </button>
      {confirm && (
        <Modal
          title="删除任务"
          onClose={() => {
            if (!a.busy) setConfirm(false);
          }}
        >
          <p>
            将“{task.title}
            ”从收集箱移除，并停止尚未完成的处理。已生成的知识笔记和来源依据会保留。
          </p>
          <ErrorBox message={a.error} />
          <div className="actions">
            <button
              className="secondary"
              disabled={a.busy}
              onClick={() => setConfirm(false)}
            >
              保留任务
            </button>
            <button
              className="primary"
              disabled={a.busy}
              onClick={() =>
                a.run(async () => {
                  await api(`/tasks/${task.id}`, {}, "DELETE");
                  setConfirm(false);
                  onDeleted();
                })
              }
            >
              {a.busy ? "正在删除…" : "确认删除"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function TaskPage() {
  const { id } = useParams(),
    r = useResource<Data>("/tasks/" + id, 3000),
    a = useAction(),
    nav = useNavigate();
  const t = r.data;
  const noKnowledge =
    t?.result &&
    ["new", "existing", "updates", "uncertain"].every(
      (key) => !t.result[key]?.length,
    );
  const sourceHelp =
    t?.input.url &&
    (t.checkpoint.sourceIssue || t.stage === "failed" || noKnowledge);
  const active =
    t &&
    !["completed", "cancelled", "failed", "waiting_config"].includes(t.stage);
  return (
    <div className="page">
      <Link className="back" to="/">
        <ArrowLeft size={16} />
        收集箱
      </Link>
      <ErrorBox message={r.error || a.error} retry={r.reload} />
      {!t ? (
        <Loading />
      ) : (
        <>
          <PageHead
            overline="FROM SOURCE TO KNOWLEDGE"
            title={t.title}
            description={`${t.app} · ${date(t.created_at)}`}
            action={
              <Status
                value={t.stage}
                label={
                  t.stage === "failed" && t.checkpoint.sourceIssue
                    ? "未读到正文"
                    : undefined
                }
              />
            }
          />
          <div
            className={
              t.stage === "failed" && t.checkpoint.sourceIssue
                ? "notice"
                : "notice success"
            }
          >
            <Cloud size={18} />
            <span>
              {t.stage === "failed" && t.checkpoint.sourceIssue
                ? "原链接已保存，文章正文尚未获取。"
                : "资料已由服务端持久保存。"}
              {active
                ? "正在后台整理，可离开此页面。"
                : "原始资料与处理成果均已保留。"}
            </span>
          </div>
          {sourceHelp && (
            <div className="notice source-recovery">
              <div>
                <strong>
                  {t.checkpoint.sourceIssue
                    ? "来源访问受限，未读取到正文"
                    : "补充正文或截图后继续整理"}
                </strong>
                <p>
                  如果原链接显示验证页，请在微信或浏览器中打开原文并完成验证，然后复制正文或上传文章截图。补充资料会保留原链接作为来源，不再读取该链接。
                </p>
              </div>
              <button
                className="secondary"
                onClick={() =>
                  nav("/collect", {
                    state: {
                      referenceSource: {
                        id: t.id,
                        url: t.input.url,
                        question: t.question,
                      },
                    },
                  })
                }
              >
                粘贴正文或上传截图
              </button>
            </div>
          )}
          <div className="task-columns">
            <section className="panel">
              <div className="section-title">
                <FileText size={18} />
                <h2>原始资料</h2>
              </div>
              {t.input.url && (
                <a
                  className="source-url"
                  href={t.input.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Link2 size={16} />
                  {t.input.url}
                  <ArrowUpRight size={14} />
                </a>
              )}
              {t.question && (
                <div className="question-note">
                  <small>这次想了解</small>
                  <p>{t.question}</p>
                </div>
              )}
              {t.input.text && <p className="source-text">{t.input.text}</p>}
              {t.input.images.map((im: Data) => (
                <img
                  className="preview-full"
                  key={im.index}
                  src={`/api/tasks/${id}/images?index=${im.index}`}
                  alt={im.name}
                />
              ))}
              {t.checkpoint.read?.map((s: Data, i: number) => (
                <div className="source-range" key={i}>
                  <strong>{s.title || "已读取内容"}</strong>
                  <small>{s.range}</small>
                  <details>
                    <summary>查看提取文字</summary>
                    <p className="source-text">{s.content}</p>
                  </details>
                </div>
              ))}
            </section>
            <section className="panel">
              <div className="section-title">
                <Sparkles size={18} />
                <h2>
                  {t.checkpoint.sourceIssue && t.stage === "failed"
                    ? "读取未完成"
                    : t.result
                      ? "整理结果"
                      : "整理进展"}
                </h2>
              </div>
              {t.result ? (
                <>
                  <p className="result-summary">{t.result.summary}</p>
                  {[
                    ["new", "已新增知识", "已自动保存"],
                    ["existing", "已存在知识", "链接至原笔记"],
                    [
                      "updates",
                      "笔记更新",
                      `${t.result.pendingUpdates ?? t.result.updates.length} 项待查看；未接受部分不改正文`,
                    ],
                  ].map(([key, label, hint]) => (
                    <section className="result-group" key={key}>
                      <div>
                        <h3>
                          {label} <span>{t.result[key].length}</span>
                        </h3>
                        <small>{hint}</small>
                      </div>
                      {t.result[key].map((n: Data) => (
                        <Link
                          key={n.id}
                          className="result-link"
                          to={
                            key === "updates"
                              ? "/updates/" + n.id
                              : "/notes/" + n.id
                          }
                        >
                          <BookOpen size={17} />
                          {n.title}
                          {n.status && (
                            <small>
                              {
                                (
                                  {
                                    pending: "待查看",
                                    accepted: "已接受",
                                    rejected: "未采用",
                                    superseded: "已重新比较",
                                  } as Record<string, string>
                                )[n.status]
                              }
                            </small>
                          )}
                          <ArrowUpRight size={16} />
                        </Link>
                      ))}
                      {!t.result[key].length && (
                        <p className="muted small">本次暂无</p>
                      )}
                    </section>
                  ))}
                  {t.result.uncertain.length > 0 && (
                    <div className="notice">
                      <AlertText />
                      需核对的知识：
                      {t.result.uncertain.map((n: Data) => (
                        <details key={n.title}>
                          <summary>{n.title}</summary>
                          <p>{n.reason}</p>
                          <RichText body={n.body} />
                        </details>
                      ))}
                    </div>
                  )}
                  {!t.result.new.length &&
                    !t.result.existing.length &&
                    !t.result.updates.length && (
                      <p>本次没有自动收录的知识，原资料已保存。</p>
                    )}
                </>
              ) : (
                <>
                  <div className="stages">
                    {["queued", "reading", "extracting", "comparing"].map(
                      (s, i) => (
                        <div key={s} className={t.stage === s ? "current" : ""}>
                          <span>{i + 1}</span>
                          <div>
                            <strong>{stages[s]}</strong>
                            <small>
                              {
                                [
                                  "等待可用工作进程",
                                  "记录实际读取范围",
                                  "筛选用途、条件和边界",
                                  "去重、建立关系与保存建议",
                                ][i]
                              }
                            </small>
                          </div>
                          {t.stage === s && <Spinner />}
                        </div>
                      ),
                    )}
                  </div>
                  {t.stage === "waiting_config" && (
                    <div className="notice">
                      <p>
                        尚未配置可用的 AI
                        服务，资料不会丢失。配置并校验后，原任务自动继续。
                      </p>
                      <Link className="button primary" to="/settings?tab=ai">
                        配置 AI 服务
                        <ArrowRight size={16} />
                      </Link>
                    </div>
                  )}
                  <ErrorBox message={t.error || ""} />
                </>
              )}
              <div className="actions">
                <DeleteTaskButton task={t} onDeleted={() => nav("/")} />
                {["failed", "cancelled", "waiting_config"].includes(
                  t.stage,
                ) && (
                  <button
                    className="secondary"
                    disabled={a.busy}
                    onClick={() =>
                      a.run(async () => {
                        await api(`/tasks/${id}/retry`, {});
                        r.reload();
                      })
                    }
                  >
                    <RefreshCw size={16} />
                    重试原任务
                  </button>
                )}
                {active && (
                  <button
                    className="text-button"
                    disabled={a.busy}
                    onClick={() =>
                      a.run(async () => {
                        await api(`/tasks/${id}/cancel`, {});
                        r.reload();
                      })
                    }
                  >
                    取消后续处理
                  </button>
                )}
                <button className="secondary" onClick={() => nav("/collect")}>
                  <Plus size={16} />
                  补充原始材料
                </button>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
function AlertText() {
  return <strong>需要进一步判断</strong>;
}
function ObsidianSyncButton({ note }: { note?: Data }) {
  const [busy, setBusy] = useState(false),
    [prompt, setPrompt] = useState<"connect" | "open" | "error" | null>(null),
    [message, setMessage] = useState("");
  if (!window.fenext) return null;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const current = await window.fenext!.status();
      if (!current.vaultPath) {
        setPrompt("connect");
        return;
      }
      const result = await window.fenext!.sync();
      if (result.error || result.errors?.length)
        throw new Error(result.error || result.errors.join("；"));
      if (result.conflicts?.length)
        throw new Error("有知识笔记发生同步冲突，请先到设置与同步中处理。");
      if (!result.lastSync || (note && !result.paths?.[note.id]))
        throw new Error("这篇笔记尚未同步到 Obsidian，请检查同步状态。");
      setMessage(
        note
          ? `「${note.title}」已同步到 Obsidian。是否现在打开这篇笔记？`
          : `已同步 ${result.count} 篇知识笔记。是否现在打开 Obsidian？`,
      );
      setPrompt("open");
    } catch (error) {
      setMessage((error as Error).message);
      setPrompt("error");
    } finally {
      setBusy(false);
    }
  };
  const open = async () => {
    setBusy(true);
    try {
      if (note) await window.fenext!.openNote(note.id);
      else await window.fenext!.openObsidian();
      setPrompt(null);
    } catch (error) {
      setMessage((error as Error).message);
      setPrompt("error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="secondary" disabled={busy} onClick={run}>
        {busy ? <Spinner /> : <RefreshCw size={16} />}
        立即同步到 Obsidian
      </button>
      {prompt && (
        <Modal
          title={
            prompt === "connect"
              ? "连接 Obsidian"
              : prompt === "open"
                ? "同步完成"
                : "同步未完成"
          }
          onClose={() => setPrompt(null)}
        >
          <p>
            {prompt === "connect"
              ? "先在设置与同步中选择 Obsidian 知识库，Fenext 会在库内建立专用文件夹。"
              : message}
          </p>
          <div className="actions">
            {prompt === "connect" ? (
              <Link
                className="button primary"
                to="/settings?tab=sync"
                onClick={() => setPrompt(null)}
              >
                前往连接
              </Link>
            ) : prompt === "open" ? (
              <button className="primary" disabled={busy} onClick={open}>
                现在打开 Obsidian
              </button>
            ) : (
              <Link
                className="button secondary"
                to="/settings?tab=sync"
                onClick={() => setPrompt(null)}
              >
                查看同步状态
              </Link>
            )}
            <button className="secondary" onClick={() => setPrompt(null)}>
              {prompt === "open" ? "稍后" : "关闭"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function KnowledgePage() {
  const resultsRef = useRef<HTMLDivElement>(null);
  const [resultsHeight, setResultsHeight] = useState(0);
  const [p, setP] = useSearchParams(),
    q = p.get("q") || "",
    mode = p.get("mode") || "concepts";
  const r = useResource<Data[]>(
    "/notes?q=" + encodeURIComponent(q) + "&mode=" + mode,
    0,
    true,
  );
  const changeView = (next: Record<string, string>, replace = false) => {
    // Keep just enough document height to preserve the current viewport when
    // the next result set is shorter, without retaining the entire old list.
    const top = resultsRef.current?.getBoundingClientRect().top ?? 0;
    setResultsHeight(Math.max(0, window.innerHeight - top));
    setP(next, { replace });
  };
  return (
    <div className="page knowledge-page">
      <PageHead
        overline="BUILD YOUR UNDERSTANDING"
        title="知识库"
        description="不只记住概念，也记住它何时有用。"
        action={
          <div className="knowledge-head-actions">
            <ObsidianSyncButton />
            <Link className="button secondary" to="/collect">
              <Plus size={17} />
              收集新资料
            </Link>
          </div>
        }
      />
      <div className="knowledge-controls">
        <div className="knowledge-search">
          <Search size={22} />
          <input
            aria-label="搜索知识"
            value={q}
            placeholder={
              mode === "questions"
                ? "描述一个产品问题，例如：如何让任务跨天继续？"
                : "搜索概念、别名或一个产品问题…"
            }
            onChange={(e) => changeView({ q: e.target.value, mode }, true)}
          />
          {q && (
            <button
              className="icon-button"
              aria-label="清除搜索"
              onClick={() => changeView({ mode })}
            >
              <X size={16} />
            </button>
          )}
          <kbd>搜索</kbd>
        </div>
        <div className="toolbar">
          <div className="tabs">
            <button
              aria-pressed={mode === "concepts"}
              className={mode === "concepts" ? "selected" : ""}
              onClick={() => changeView({ q, mode: "concepts" })}
            >
              按概念
            </button>
            <button
              aria-pressed={mode === "questions"}
              className={mode === "questions" ? "selected" : ""}
              onClick={() => changeView({ q, mode: "questions" })}
            >
              按产品问题
            </button>
          </div>
          <small className="muted">{r.data?.length || 0} 篇知识笔记</small>
        </div>
      </div>
      <div
        ref={resultsRef}
        className="knowledge-results"
        style={{ minHeight: resultsHeight }}
        aria-busy={r.loading}
      >
        <ErrorBox message={r.error} retry={r.reload} />
        {r.loading && !r.data ? (
          <Loading />
        ) : !r.data?.length ? (
          <Empty
            icon={<Library size={32} />}
            headline={q ? "没有找到相关知识" : "为你的知识，建立第一条联系"}
            action={
              q ? (
                <button
                  className="secondary"
                  onClick={() => changeView({ mode })}
                >
                  清除搜索
                </button>
              ) : (
                <Link to="/collect" className="button primary">
                  去收集资料
                  <ArrowRight size={16} />
                </Link>
              )
            }
          >
            {q
              ? "试试概念别名、较短的关键词，或清除筛选。"
              : "整理完成的知识会出现在这里，支持按概念和产品问题查阅。"}
          </Empty>
        ) : (
          <div className="knowledge-grid">
            {r.data.map((n) => (
              <Link className="knowledge-card" key={n.id} to={"/notes/" + n.id}>
                <div className="card-top">
                  <BookOpen size={21} />
                  <span className="learning-level">{n.level}</span>
                </div>
                <h2>{n.title}</h2>
                {n.aliases.length > 0 && (
                  <small className="muted">{n.aliases.join(" · ")}</small>
                )}
                <p>
                  {n.matchReason ||
                    n.reason ||
                    "查看知识的用途、适用条件和来源。"}
                </p>
                <div className="card-bottom">
                  <span>{date(n.updated_at)} 更新</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function NotePage() {
  const { id } = useParams(),
    r = useResource<Data>("/notes/" + id),
    [panel, setPanel] = useState<"chat" | "history" | null>(null),
    [term, setTerm] = useState(""),
    [supplement, setSupplement] = useState(false);
  const n = r.data;
  return (
    <div className={"page note-page " + (panel ? "with-panel" : "")}>
      <Link className="back" to="/knowledge">
        <ArrowLeft size={16} />
        知识库
      </Link>
      <ErrorBox message={r.error} retry={r.reload} />
      {!n ? (
        <Loading />
      ) : (
        <>
          <div className="note-toolbar">
            <span className="learning-level">{n.level}</span>
            <div>
              <button
                className={panel === "history" ? "selected" : ""}
                onClick={() => setPanel(panel === "history" ? null : "history")}
              >
                <History size={17} />
                历史
              </button>
              <button onClick={() => setSupplement(true)}>
                <Plus size={17} />
                补充资料
              </button>
              <ObsidianSyncButton note={n} />
              <button
                className={panel === "chat" ? "selected" : ""}
                onClick={() => setPanel(panel === "chat" ? null : "chat")}
              >
                <PanelRight size={17} />
                讨论 / 修改
              </button>
            </div>
          </div>
          <div className="note-layout">
            <article className="note-document">
              <div className="eyebrow">KNOWLEDGE NOTE</div>
              <h1>{n.title}</h1>
              <div className="note-aliases">
                {n.aliases.join(" · ")}
                <button
                  className="icon-button"
                  aria-label="查看发音"
                  onClick={() => setTerm(n.title)}
                >
                  <Volume2 size={17} />
                </button>
              </div>
              <div className="save-line">
                <Cloud size={15} />
                服务端已保存<span>版本 {n.version}</span>
                <span>{date(n.updated_at)}</span>
              </div>
              {n.suggestions
                .filter((s: Data) => s.status === "pending")
                .map((s: Data) => (
                  <Link
                    className="pending-banner"
                    key={s.id}
                    to={"/updates/" + s.id}
                  >
                    <Sparkles size={17} />
                    <span>
                      有一份更新待查看<small>{s.reason}</small>
                    </span>
                    <ArrowRight size={17} />
                  </Link>
                ))}
              {n.reason && (
                <div className="learning-summary">
                  <span className="tiny-label">为什么值得学</span>
                  <p>{n.reason}</p>
                </div>
              )}
              <RichText body={n.body} onTerm={setTerm} />
              <section className="note-sources">
                <h2>来源与依据</h2>
                {n.sources.length ? (
                  n.sources.map((s: Data) => (
                    <div key={s.id} className="source-card">
                      <Link to={"/tasks/" + s.task_id}>
                        <FileText size={17} />
                        {s.title}
                        <ArrowUpRight size={15} />
                      </Link>
                      <p>{s.evidence}</p>
                      {s.checkpoint?.map((c: Data, i: number) => (
                        <small key={i}>{c.range}</small>
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    暂无来源关联；这不代表正文已被外部依据验证。
                  </p>
                )}
              </section>
            </article>
            {panel && (
              <aside className="detail-panel">
                <div className="section-title">
                  <h2>{panel === "chat" ? "围绕这篇笔记" : "修改历史"}</h2>
                  <button
                    className="icon-button"
                    aria-label="关闭面板"
                    onClick={() => setPanel(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
                {panel === "chat" ? (
                  <Chat note={n} onChange={r.reload} />
                ) : (
                  <HistoryPanel note={n} onChange={r.reload} />
                )}
              </aside>
            )}
          </div>
          {term && <Term term={term} onClose={() => setTerm("")} />}{" "}
          {supplement && (
            <Supplement note={n} onClose={() => setSupplement(false)} />
          )}
        </>
      )}
    </div>
  );
}
function Chat({ note, onChange }: { note: Data; onChange: () => void }) {
  const r = useResource<Data[]>("/notes/" + note.id + "/chat"),
    a = useAction(),
    [text, setText] = useState(""),
    [mode, setMode] = useState("discuss");
  return (
    <>
      <div className="scope-label">
        <BookOpen size={14} />
        {note.title}
        <span>仅当前笔记</span>
      </div>
      <ErrorBox message={r.error || a.error} />
      <div className="chat-messages">
        {!r.data?.length && (
          <div className="chat-start">
            <Sparkles size={24} />
            <h3>从理解，到更好的表达。</h3>
            <p>
              提问不会修改正文。选择“修改笔记”并给出明确要求，修改将直接执行并保留历史。
            </p>
          </div>
        )}
        {r.data?.map((m) => (
          <div key={m.id} className={"chat-message " + m.role}>
            <small>
              {m.role === "user" ? "你" : "Fenext"}
              {m.kind === "edited"
                ? " · 已修改并保存"
                : m.kind === "error"
                  ? " · 未完成"
                  : ""}
            </small>
            <RichText body={m.text} />
          </div>
        ))}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api("/notes/" + note.id + "/chat", { text, mode });
            setText("");
            r.reload();
            onChange();
          });
        }}
      >
        <div className="tabs small-tabs">
          <button
            type="button"
            className={mode === "discuss" ? "selected" : ""}
            onClick={() => setMode("discuss")}
          >
            讨论
          </button>
          <button
            type="button"
            className={mode === "edit" ? "selected" : ""}
            onClick={() => setMode("edit")}
          >
            修改笔记
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (
              /^(把|请把|将|请将|修改|改写|重写|删除|补充|添加)/.test(
                e.target.value,
              )
            )
              setMode("edit");
          }}
          placeholder={
            mode === "edit"
              ? "例如：把“是什么”改成初学者能理解的解释"
              : "例如：这个方法适用于哪些产品场景？"
          }
          rows={4}
        />
        <button className="primary" disabled={a.busy || !text.trim()}>
          {a.busy ? <Spinner /> : <Send size={16} />}发送
          {mode === "edit" ? "修改指令" : ""}
        </button>
      </form>
    </>
  );
}
function HistoryPanel({
  note,
  onChange,
}: {
  note: Data;
  onChange: () => void;
}) {
  const r = useResource<Data[]>("/notes/" + note.id + "/history"),
    a = useAction(),
    [chosen, setChosen] = useState<Data | null>(null);
  return (
    <>
      <ErrorBox message={r.error || a.error} />
      <div className="history-list">
        {r.data?.map((v) => (
          <button
            key={v.id}
            className="history-item"
            onClick={() => setChosen(v)}
          >
            <span>
              版本 {v.version}
              {v.version === note.version ? " · 当前" : ""}
            </span>
            <small>
              {date(v.created_at)} · {v.actor}
            </small>
            <p>{v.reason}</p>
          </button>
        ))}
      </div>
      {chosen && (
        <Modal
          title={"历史版本 " + chosen.version}
          onClose={() => setChosen(null)}
          wide
        >
          <p className="muted">
            以下对比此历史版本与当前正文。恢复会创建新版本，中间历史继续保留。
          </p>
          <Diff before={chosen.body} after={note.body} />
          <ErrorBox message={a.error} />
          <button
            className="primary"
            disabled={a.busy || chosen.version === note.version}
            onClick={() =>
              a.run(async () => {
                await api("/notes/" + note.id + "/restore", {
                  version: chosen.version,
                  baseVersion: note.version,
                });
                setChosen(null);
                r.reload();
                onChange();
              })
            }
          >
            恢复为新版本
          </button>
        </Modal>
      )}
    </>
  );
}
function Diff({ before, after }: { before: string; after: string }) {
  return (
    <div className="diff">
      {diffLines(before, after).map((p, i) => (
        <div
          key={i}
          className={p.added ? "added" : p.removed ? "removed" : "unchanged"}
        >
          <span>{p.added ? "新增" : p.removed ? "删除" : "保留"}</span>
          <pre>{p.value}</pre>
        </div>
      ))}
    </div>
  );
}
function ReviewPage() {
  const { id } = useParams(),
    r = useResource<Data>("/suggestions/" + id),
    a = useAction(),
    nav = useNavigate(),
    [selected, setSelected] = useState<string[]>([]),
    [edited, setEdited] = useState<Record<string, string>>({}),
    [editing, setEditing] = useState("");
  const s = r.data;
  useEffect(() => {
    setSelected(
      r.data?.items
        .filter((i: Data) => i.status === "pending")
        .map((i: Data) => i.id) || [],
    );
  }, [r.data]);
  return (
    <div className="page narrow">
      <Link className="back" to={s ? "/notes/" + s.note_id : "/knowledge"}>
        <ArrowLeft size={16} />
        返回笔记
      </Link>
      <ErrorBox message={r.error || a.error} />
      {!s ? (
        <Loading />
      ) : (
        <>
          <PageHead
            overline="REVIEW WHAT CHANGES"
            title="查看这次更新"
            description={s.note.title + " · " + s.reason}
          />
          <div className="notice">
            <ShieldCheck size={18} />
            <span>
              建议已保存，原文尚未修改。接受后创建新版本，支持从历史恢复。
            </span>
          </div>
          {s.base_version !== s.note.version && s.status === "pending" && (
            <div className="notice danger">
              <p>
                笔记在生成建议后已变化：基准 v{s.base_version}，当前 v
                {s.note.version}。双方内容均已保留。
              </p>
              <button
                className="secondary"
                disabled={a.busy}
                onClick={() =>
                  a.run(async () => {
                    const next = await api(
                      "/suggestions/" + id + "/recompare",
                      {},
                    );
                    nav(
                      next.id ? "/updates/" + next.id : "/notes/" + s.note_id,
                    );
                  })
                }
              >
                <RefreshCw size={16} />
                根据最新内容重新比较
              </button>
            </div>
          )}
          {s.items.map((item: Data) => (
            <section className="panel change-section" key={item.id}>
              <div className="change-head">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    disabled={
                      item.status !== "pending" || s.status !== "pending"
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, item.id]
                          : selected.filter((x) => x !== item.id),
                      )
                    }
                  />
                  <strong>{item.heading}</strong>
                </label>
                <span>{item.status === "accepted" ? "已接受" : "待查看"}</span>
                {s.status === "pending" && item.status === "pending" && (
                  <button
                    className="text-button"
                    onClick={() =>
                      setEditing(editing === item.id ? "" : item.id)
                    }
                  >
                    编辑建议
                  </button>
                )}
              </div>
              {editing === item.id ? (
                <textarea
                  rows={10}
                  value={edited[item.id] ?? item.after}
                  onChange={(e) =>
                    setEdited({ ...edited, [item.id]: e.target.value })
                  }
                />
              ) : (
                <Diff
                  before={item.before}
                  after={edited[item.id] ?? item.after}
                />
              )}
            </section>
          ))}
          {s.status === "pending" ? (
            <div className="review-footer">
              <button
                className="text-button"
                disabled={a.busy}
                onClick={() =>
                  a.run(async () => {
                    await api("/suggestions/" + id + "/reject", {});
                    nav("/notes/" + s.note_id);
                  })
                }
              >
                暂不采用本次建议
              </button>
              <span>{selected.length} 项已选择</span>
              <button
                className="primary"
                disabled={
                  a.busy ||
                  !selected.length ||
                  s.base_version !== s.note.version
                }
                onClick={() =>
                  a.run(async () => {
                    await api("/suggestions/" + id + "/accept", {
                      items: selected,
                      edited,
                    });
                    nav("/notes/" + s.note_id);
                  })
                }
              >
                {a.busy ? <Spinner /> : <Check size={17} />}接受所选更新
              </button>
            </div>
          ) : (
            <div className="notice">
              此建议已处理（{s.status}），历史内容保留。
            </div>
          )}
        </>
      )}
    </div>
  );
}
function Term({ term, onClose }: { term: string; onClose: () => void }) {
  const r = useResource<Data[]>("/notes?q=" + encodeURIComponent(term)),
    a = useAction(),
    [pron, setPron] = useState<Data | null>(null);
  return (
    <Modal title={term} onClose={onClose}>
      <ErrorBox message={r.error || a.error} />
      <p className="muted">查阅已有知识，或了解词典读法。</p>
      {r.data?.length ? (
        r.data.slice(0, 5).map((n) => (
          <Link
            className="result-link"
            key={n.id}
            to={"/notes/" + n.id}
            onClick={onClose}
          >
            <BookOpen size={17} />
            <span>
              {n.title}
              <small>{n.reason}</small>
            </span>
            <ArrowRight size={16} />
          </Link>
        ))
      ) : (
        <p>知识库中尚未收录此术语。</p>
      )}
      <div className="actions">
        <Link
          className="button secondary"
          to={"/knowledge?q=" + encodeURIComponent(term)}
          onClick={onClose}
        >
          <Search size={16} />
          在知识库搜索
        </Link>
        <button
          className="secondary"
          disabled={a.busy}
          onClick={() =>
            a.run(async () =>
              setPron(
                await api("/pronunciation?term=" + encodeURIComponent(term)),
              ),
            )
          }
        >
          <Volume2 size={16} />
          查词典读法
        </button>
      </div>
      {pron && (
        <div className="pronunciation">
          <strong>{pron.text || "暂无音标"}</strong>
          <small>{pron.source}</small>
          {pron.audio ? (
            <audio
              controls
              src={pron.audio}
              onError={() => a.setError("音频播放失败，仍可阅读与搜索")}
            />
          ) : (
            <p>暂无可播放音频，官方术语读法未核实。</p>
          )}
        </div>
      )}
    </Modal>
  );
}
function Supplement({ note, onClose }: { note: Data; onClose: () => void }) {
  const [query, setQuery] = useState(
      "补充 " + note.title + " 的适用条件与案例",
    ),
    a = useAction(),
    nav = useNavigate();
  return (
    <Modal title="补充资料" onClose={onClose}>
      <p className="muted">
        明确这次想补充什么。只有点击开始后才会请求外部检索服务，新材料仍按原有规则去重与审核。
      </p>
      <label>
        本次搜索目标
        <textarea
          rows={4}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ErrorBox message={a.error} />
      <div className="actions">
        <Link className="button secondary" to="/collect">
          手动补充资料
        </Link>
        <button
          className="primary"
          disabled={a.busy || !query.trim()}
          onClick={() =>
            a.run(async () => {
              const t = await api(
                "/supplement",
                { noteId: note.id, query },
                "POST",
                { "Idempotency-Key": crypto.randomUUID() },
              );
              onClose();
              nav("/tasks/" + t.id);
            })
          }
        >
          {a.busy ? <Spinner /> : <Search size={16} />}开始补充
        </button>
      </div>
    </Modal>
  );
}
function SettingsPage({ onboarding = false }: { onboarding?: boolean }) {
  const r = useResource<Data>("/settings"),
    a = useAction(),
    [p, setP] = useSearchParams(),
    tab = p.get("tab") || "ai";
  const [endpoint, setEndpoint] = useState("https://api.openai.com/v1"),
    [model, setModel] = useState(""),
    [key, setKey] = useState(""),
    [notice, setNotice] = useState(""),
    [desktop, setDesktop] = useState<Data | null>(null),
    [shortcut, setShortcut] = useState(
      navigator.platform.includes("Mac") ? "Alt+Command+F" : "Control+Alt+F",
    );
  useEffect(() => {
    if (r.data?.ai) {
      setEndpoint(r.data.ai.endpoint);
      setModel(r.data.ai.model);
    }
  }, [r.data]);
  useEffect(() => {
    window.fenext
      ?.status()
      .then(setDesktop)
      .catch(() => {});
  }, []);
  return (
    <div className="page narrow">
      <PageHead
        overline={onboarding ? "MAKE IT YOURS" : "YOUR WORKSPACE"}
        title={onboarding ? "配置你的知识空间" : "设置与同步"}
        description={
          onboarding
            ? "先连接 AI 服务，再把 Fenext 笔记同步到 Obsidian。也可以先保存资料。"
            : "管理 AI 服务、设备同步和资料接收。"
        }
      />
      {onboarding && (
        <div className="setup-steps">
          <span className={tab === "ai" ? "active" : ""}>1 AI 服务</span>
          <span className={tab === "sync" ? "active" : ""}>2 Obsidian</span>
          <span className={tab === "desktop" ? "active" : ""}>3 快捷键</span>
        </div>
      )}
      <div className="tabs settings-tabs">
        {[
          ["ai", "AI 服务"],
          ["sync", "Obsidian 同步"],
          ["desktop", "桌面设置"],
          ["data", "接入与数据"],
        ].map(([v, t]) => (
          <button
            key={v}
            className={tab === v ? "selected" : ""}
            onClick={() => setP({ tab: v })}
          >
            {t}
          </button>
        ))}
      </div>
      <ErrorBox message={r.error || a.error} retry={r.reload} />
      {notice && (
        <div className="notice success">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {tab === "ai" && (
        <section className="panel">
          <div className="section-title">
            <Sparkles size={19} />
            <h2>你的 AI 服务</h2>
            {r.data?.ai?.validated && (
              <Status value="completed" label="已校验" />
            )}
          </div>
          <p className="muted">
            服务端会将提交资料及用于比较的已有笔记发送给所选提供方。API Key
            加密保存，界面不回显明文。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                await api("/settings/ai", {
                  endpoint,
                  model,
                  ...(key ? { key } : {}),
                });
                setKey("");
                setNotice("AI 服务校验通过，等待配置的任务已恢复。");
                r.reload();
              });
            }}
          >
            <label>
              接口地址
              <input
                type="url"
                required
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
              <small>
                支持允许列表内的 OpenAI 兼容接口；地址应以 /v1
                或提供方兼容路径结尾。
              </small>
            </label>
            <label>
              模型名称
              <input
                required
                placeholder="填写提供方的实际模型标识"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  r.data?.ai?.hasKey
                    ? "已加密保存；留空复用原密钥"
                    : "在此填写密钥"
                }
              />
            </label>
            <div className="actions">
              <button className="primary" disabled={a.busy}>
                {a.busy ? <Spinner /> : <ShieldCheck size={16} />}保存并校验
              </button>
              {r.data?.ai?.hasKey && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    a.run(async () => {
                      await api("/settings/ai", {}, "DELETE");
                      setNotice("密钥已移除，新任务将等待配置。");
                      r.reload();
                    })
                  }
                >
                  移除密钥
                </button>
              )}
            </div>
            <p className="fineprint">
              校验会向所选模型发送一次小型请求，可能产生提供方费用。图片理解取决于该模型是否支持图片输入。
            </p>
          </form>
        </section>
      )}
      {tab === "sync" && (
        <>
          <section className="panel">
            <div className="section-title">
              <Cloud size={19} />
              <h2>Obsidian 知识库</h2>
            </div>
            <p>
              连接后，Fenext 会在你选择的 Obsidian 知识库中新建 Fenext 文件夹。同步完成后，笔记会出现在 Obsidian 左侧的 Fenext → 知识中。
            </p>
            {window.fenext ? (
              <>
                <div className="directory">
                  <Folder />
                  <div>
                    <strong>
                      {desktop?.vaultPath
                        ? `已连接：${desktop.vaultName || "Obsidian 知识库"}`
                        : desktop?.directory || "尚未连接 Obsidian 知识库"}
                    </strong>
                    {desktop?.vaultPath && <small>{desktop.directory}</small>}
                    <small>
                      {desktop?.vaultPath
                        ? "只同步 Fenext 文件夹；其他 Obsidian 笔记不会自动导入。"
                        : desktop?.directory
                          ? "当前目录不在 Obsidian 知识库内，请连接 Obsidian 后查看笔记。"
                          : "选择 Obsidian 知识库后，Fenext 会自动建立专用文件夹。"}
                    </small>
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      a.run(async () => {
                        const result = await window.fenext!.connectObsidian();
                        setDesktop(result);
                        if (!result.cancelled && !result.error && !result.conflicts?.length)
                          setNotice(
                            result.count
                              ? "已同步到 Obsidian，在左侧打开 Fenext → 知识即可查看。"
                              : "已连接 Obsidian，今后新生成的笔记会出现在 Fenext → 知识。",
                          );
                      })
                    }
                  >
                    {desktop?.vaultPath ? "更换 Obsidian 知识库" : "连接 Obsidian"}
                  </button>
                  {desktop?.vaultPath && (
                    <button
                      className="secondary"
                      onClick={() => a.run(() => window.fenext!.openObsidian())}
                    >
                      打开 Obsidian
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={a.busy || !desktop?.directory}
                    onClick={() =>
                      a.run(async () => {
                        setDesktop(await window.fenext!.sync());
                        r.reload();
                      })
                    }
                  >
                    <RefreshCw size={16} />
                    立即同步
                  </button>
                </div>
                {desktop?.vaultPath && (
                  <details className="sync-import">
                    <summary>可选：把已有 Markdown 导入 Fenext</summary>
                    <p className="fineprint">
                      只处理 Obsidian 库内 Fenext 文件夹中的 Markdown，不读取库内其他笔记。导入前会再次显示数量。
                    </p>
                    <button
                      className="secondary"
                      disabled={a.busy}
                      onClick={() =>
                        a.run(async () => {
                          setDesktop(await window.fenext!.importNotes());
                          r.reload();
                        })
                      }
                    >
                      导入 Fenext 文件夹中的笔记
                    </button>
                  </details>
                )}
                {desktop?.summary && <p className="muted">{desktop.summary}</p>}
                {desktop?.conflicts?.map((c: Data) => (
                  <Link
                    key={c.noteId}
                    className="pending-banner"
                    to={"/updates/" + c.suggestionId}
                  >
                    解决同步冲突：{c.title}
                    <ArrowRight size={16} />
                  </Link>
                ))}
                {desktop?.error && <ErrorBox message={desktop.error} />}
                <p className="fineprint">
                  删除不会自动传播。冲突保留本地文件和服务端版本，到更新审核中处理。
                </p>
              </>
            ) : (
              <div className="notice">
                <Folder size={18} />
                <span>
                  请在 Fenext
                  桌面客户端中绑定本机目录。网页或小程序可先收集和查看知识。
                </span>
              </div>
            )}
            {r.data?.devices.map((d: Data) => (
              <div className="device" key={d.id}>
                <div>
                  <strong>{d.name}</strong>
                  <small>最近连接 {date(d.updated_at)}</small>
                </div>
                <Status
                  value={
                    Date.now() - new Date(d.updated_at).getTime() > 90000
                      ? "waiting_config"
                      : d.status.error
                        ? "failed"
                        : "completed"
                  }
                  label={
                    Date.now() - new Date(d.updated_at).getTime() > 90000
                      ? "设备离线"
                      : d.status.error
                        ? "同步异常"
                        : "设备在线"
                  }
                />
                <p>{d.status.error || d.status.summary}</p>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "desktop" && (
        <section className="panel">
          <div className="section-title">
            <Keyboard size={19} />
            <h2>快捷收集与后台</h2>
          </div>
          <label>
            全局快捷键
            <input
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              disabled={!window.fenext}
            />
          </label>
          <button
            className="primary"
            disabled={!window.fenext || a.busy}
            onClick={() =>
              a.run(async () => {
                await window.fenext!.shortcut(shortcut);
                setNotice("快捷键注册成功，现在可以测试唤醒。");
              })
            }
          >
            保存并测试注册
          </button>
          <p className="muted">
            关闭主窗口后保留托盘或菜单栏。退出应用停止本地同步，已接收的服务端任务继续运行。
          </p>
          <p className="fineprint">
            {window.fenext
              ? "Esc 收起浮窗；Cmd/Ctrl + Enter 提交。"
              : "当前为浏览器。安装并打开桌面客户端后可配置快捷键。"}
          </p>
        </section>
      )}
      {tab === "data" && (
        <>
          <CredentialsPanel />
          <section className="panel">
            <h2>保存与恢复</h2>
            <p>
              当前个人测试版保留资料、聊天、建议和全部笔记版本，不自动清理。历史恢复产生新版本。
            </p>
            <p className="muted">
              请备份服务端数据库、密钥与本地知识目录。历史记录与同步不能替代独立备份。备份操作说明见项目
              README。
            </p>
            <Link className="button secondary" to="/sources">
              <Puzzle size={16} />
              来源与插件
            </Link>
          </section>
        </>
      )}
      {onboarding && (
        <div className="form-footer">
          <Link className="button secondary" to="/">
            暂后配置，先收集资料
          </Link>
          <button
            className="primary"
            onClick={() =>
              tab === "ai"
                ? setP({ tab: "sync" })
                : tab === "sync"
                  ? setP({ tab: "desktop" })
                  : location.assign("/")
            }
          >
            {tab === "desktop" ? "完成" : "下一步"}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function ExtensionInstallGuide({ connected }: { connected: boolean }) {
  const steps = (
    <ol className="extension-setup">
      <li>
        <strong>下载并解压</strong>
        <span>选择对应浏览器，下载后解压插件包</span>
      </li>
      <li>
        <strong>安装到浏览器</strong>
        <span>
          打开浏览器的「管理扩展程序」，启用「开发者模式」，点击「加载已解压的扩展程序」，选择解压后的
          extension 文件夹
        </span>
      </li>
      <li>
        <strong>连接 Fenext</strong>
        <span>
          生成接收凭证，将服务地址和凭证填入插件的「连接设置」，点击「连接并继续」
        </span>
      </li>
    </ol>
  );
  return (
    <div className="extension-guide">
      <div className="extension-downloads">
        <p>
          Chrome：
          <a
            href="/api/integrations/extension/download?browser=chrome"
            download
            aria-label="下载 Chrome 版 Fenext插件"
          >
            Fenext 插件
          </a>
        </p>
        <p>
          Edge：
          <a
            href="/api/integrations/extension/download?browser=edge"
            download
            aria-label="下载 Edge 版 Fenext插件"
          >
            Fenext 插件
          </a>
        </p>
      </div>
      {connected ? (
        <details className="extension-more">
          <summary>安装与连接指引</summary>
          {steps}
        </details>
      ) : (
        steps
      )}
    </div>
  );
}
function SourcesPage() {
  const action = useAction();
  const connectionStatus = useResource("/integrations/extension/status", 3000);
  const connectionState = connectionStatus.error
    ? "unknown"
    : connectionStatus.data?.state || "loading";
  const pluginConnected = connectionState === "connected";
  const connectionLabel: Record<string, string> = {
    connected: "已连接",
    disconnected: "未连接",
    expired: "凭证已失效",
    unverified: "连接待确认",
    unknown: "状态暂不可用",
    loading: "确认连接中…",
  };
  const browserNames = [
    ...new Set(
      (connectionStatus.data?.connections || [])
        .filter((c: Data) => c.active)
        .map((c: Data) => (c.browser === "edge" ? "Edge" : "Chrome")),
    ),
  ].join("、");
  useEffect(() => {
    const refresh = () => connectionStatus.reload();
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [connectionStatus.reload]);
  const [selected, setSelected] = useState<Data | null>(null);
  const sources = [
    {
      name: "公开网页与论文",
      state: "无需授权",
      available: true,
      description: "读取公开网页可提取文字与 PDF 前 30 页，保留实际读取范围。",
      scope: "仅用户主动提交的 HTTP(S) 链接；不访问内网、登录内容或付费墙。",
    },
    {
      name: "文字与图片",
      state: "可提交",
      available: true,
      description: "保存原文与图片；所选模型需支持图片输入。",
      scope: "最多 4 张图片，每张 2 MB。读取结果与模型推断分别标记。",
    },
    {
      name: "电脑浏览器当前页",
      state: connectionLabel[connectionState] || "状态暂不可用",
      available: pluginConnected,
      manual: true,
      description: "在 Chrome 或 Edge 中提取当前文章，预览后保存。",
      scope: "安装插件后，将插件接收凭证填入插件的连接设置。",
    },
  ];
  const displayed = selected?.manual
    ? sources.find((source) => source.manual)!
    : selected;
  return (
    <div className="page">
      <PageHead
        overline="KEEP THE SOURCE IN SIGHT"
        title="来源与插件"
        description="知道知识从哪里来，也知道我们实际读取到了什么。"
      />
      <div className="source-grid">
        {sources.map((s) => (
          <button
            className="source-plugin"
            key={s.name}
            onClick={() => {
              action.setError("");
              setSelected(s);
            }}
          >
            <div className="plugin-head">
              <h2>{s.name}</h2>
              <Status
                value={s.available ? "completed" : "waiting_config"}
                label={s.state}
              />
            </div>
            <p>{s.description}</p>
          </button>
        ))}
      </div>
      {displayed && (
        <Modal
          title={displayed.name}
          className={
            displayed.manual ? "source-plugin-modal" : "source-info-modal"
          }
          onClose={() => setSelected(null)}
        >
          {displayed.manual && (
            <Status
              value={displayed.available ? "completed" : "waiting_config"}
              label={displayed.state}
            />
          )}
          {displayed.manual ? (
            <>
              {pluginConnected ? (
                <p>
                  {browserNames || "浏览器"} 已连接。打开文章后，点击 Fenext
                  插件即可提取并保存。
                </p>
              ) : connectionState === "expired" ? (
                <p>
                  接收凭证已失效。生成新凭证，在插件的「连接设置」中保存即可恢复。
                </p>
              ) : connectionState === "unverified" ? (
                <p>
                  你已通过插件收集过资料。打开插件即可确认连接；旧版请在「连接设置」中点击「保存连接」。
                </p>
              ) : (
                <p>
                  安装 Fenext
                  插件并连接你的账户，就能把正在阅读的文章保存到收集箱。
                </p>
              )}
              {pluginConnected && (
                <p className="fineprint">状态以插件最近一次成功连接为准</p>
              )}
              <ExtensionInstallGuide connected={pluginConnected} />
              <ErrorBox message={action.error} />
            </>
          ) : (
            <div className="source-info-copy">
              <p className="source-info-lead">
                {displayed.name === "公开网页与论文"
                  ? "粘贴文章或论文链接，交给 Fenext 整理。"
                  : "留下原文或图片，以及你想了解的问题。"}
              </p>
              <p className="source-info-detail">
                {displayed.name === "公开网页与论文"
                  ? "支持公开网页和 PDF 前 30 页。需要登录或验证的文章，可通过 Fenext插件提取，或粘贴正文。"
                  : "最多添加 4 张图片，每张不超过 2 MB；处理图片需使用支持图片输入的模型。"}
              </p>
            </div>
          )}
          {displayed.manual && (
            <Link
              className="button secondary"
              to="/settings?tab=data"
              onClick={() => setSelected(null)}
            >
              {pluginConnected ? "管理接收凭证" : "生成接收凭证"}
            </Link>
          )}
          {!displayed.manual && (
            <div className="source-info-footer">
              <Link
                className="button primary"
                to="/collect"
                onClick={() => setSelected(null)}
              >
                {displayed.name === "公开网页与论文"
                  ? "添加链接"
                  : "添加文字或图片"}
              </Link>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
