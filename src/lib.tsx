import { useState, useEffect, useRef, type ReactNode } from "react";
import { X, LoaderCircle, AlertCircle, ArrowUpRight } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
export type Data = Record<string, any>;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
  headers?: Record<string, string>,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) {
    if (r.status === 401 && !["/login", "/auth"].includes(path))
      window.dispatchEvent(new Event("fenext-unauthorized"));
    throw new ApiError(d.error || "请求失败", r.status);
  }
  return d;
}
export function useResource<T = any>(
  path: string,
  poll = 0,
  keepPrevious = false,
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    lastPath = useRef("");
  const reload = () => setRevision((v) => v + 1);
  useEffect(() => {
    let active = true,
      inflight = false;
    setLoading(true);
    if (lastPath.current !== path) {
      if (!keepPrevious) setData(null);
      lastPath.current = path;
    }
    async function load() {
      if (inflight) return;
      inflight = true;
      try {
        const d = await api<T>(path);
        if (active) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inflight = false;
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = poll ? setInterval(load, poll) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, poll, revision, keepPrevious]);
  return { data, error, loading, reload, setData };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return message ? (
    <div className="notice danger" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          重试
        </button>
      )}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="skeletons" aria-label="正在加载">
      <div />
      <div />
      <div />
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle size={16} className="spin" />;
}
export function Empty({
  icon,
  headline,
  children,
  action,
}: {
  icon: ReactNode;
  headline: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{headline}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export const stages: Record<string, string> = {
  waiting_config: "等待 AI 配置",
  waiting_auth: "等待授权",
  queued: "排队中",
  reading: "读取资料",
  extracting: "提炼知识",
  comparing: "对照已有知识",
  completed: "已完成",
  failed: "处理失败",
  cancelled: "已取消",
};
export function Status({ value, label }: { value: string; label?: string }) {
  return (
    <span className={"status " + value}>
      <i />
      {label || stages[value] || value}
    </span>
  );
}
export const date = (s: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(s));
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={[wide ? "wide" : "", className].filter(Boolean).join(" ")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function RichText({
  body,
  onTerm,
}: {
  body: string;
  onTerm?: (s: string) => void;
}) {
  const md = body.replace(
    /\[\[([^\]\n]+)\]\]/g,
    (_, value: string) =>
      `[${value.split("|").pop()}](#term:${encodeURIComponent(value.split("|")[0])})`,
  );
  return (
    <div className="prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href?.startsWith("#term:") ? (
              <button
                className="term-link"
                onClick={() => onTerm?.(decodeURIComponent(href.slice(6)))}
              >
                {children}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
                <ArrowUpRight size={12} />
              </a>
            ),
        }}
      >
        {md}
      </Markdown>
    </div>
  );
}
declare global {
  interface Window {
    fenext?: {
      connectObsidian: () => Promise<any>;
      openObsidian: () => Promise<any>;
      status: () => Promise<any>;
      sync: () => Promise<any>;
      importNotes: () => Promise<any>;
      shortcut: (s: string) => Promise<any>;
      openNote: (id: string) => Promise<any>;
      openMain: () => Promise<void>;
      hide: () => Promise<void>;
    };
  }
}
