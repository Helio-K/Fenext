import { useState } from "react";
import {
  api,
  ErrorBox,
  Loading,
  Modal,
  useAction,
  useResource,
  type Data,
} from "./lib";
const generatedAt = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "生成时间未记录";

export function CredentialsPanel() {
  const credentials = useResource<Data[]>("/integrations/tokens");
  const action = useAction();
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<Data | null>(null);
  const [deleting, setDeleting] = useState<Data | null>(null);
  const [editing, setEditing] = useState<Data | null>(null);
  const [remark, setRemark] = useState("");
  const [feedback, setFeedback] = useState("");
  const copy = (text: string, message: string) =>
    action.run(async () => {
      await navigator.clipboard.writeText(text);
      setFeedback(message);
    });
  return (
    <section className="panel credentials-panel">
      <h2>接收凭证</h2>
      <p className="muted">
        用于连接
        Fenext插件或其他收集工具。凭证长期有效，删除后立即失效；仅允许提交资料和查询对应任务。
      </p>
      <div className="service-address">
        <label>
          Fenext 服务地址
          <input readOnly value={window.location.origin} />
        </label>
        <button
          className="secondary"
          onClick={() => copy(window.location.origin, "服务地址已复制")}
        >
          复制服务地址
        </button>
      </div>
      <form
        className="credential-create"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            setFeedback("");
            const result = await api("/integrations/tokens", { label });
            setFresh(result);
            setLabel("");
            credentials.reload();
          });
        }}
      >
        <label>
          凭证备注<span className="optional">选填</span>
          <input
            maxLength={80}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="例如：Chrome · 工作电脑"
          />
        </label>
        <button className="primary" disabled={action.busy}>
          {action.busy ? "处理中…" : "生成接收凭证"}
        </button>
      </form>
      <ErrorBox
        message={credentials.error || action.error}
        retry={credentials.error ? credentials.reload : undefined}
      />
      {feedback && (
        <p className="credential-feedback" role="status">
          {feedback}
        </p>
      )}
      {fresh && (
        <div className="new-credential">
          <strong>已生成：{fresh.label}</strong>
          <p>
            凭证仅在这里显示一次。复制后，粘贴到
            Fenext插件的「接收凭证」中，点击「连接并继续」。
          </p>
          <div className="credential-secret">
            <input
              aria-label="新接收凭证"
              type="password"
              value={fresh.token}
              readOnly
            />
            <button
              className="primary"
              onClick={() => copy(fresh.token, "凭证已复制")}
            >
              复制凭证
            </button>
          </div>
        </div>
      )}
      <div className="credential-list" aria-label="已生成的接收凭证">
        <div className="credential-list-head">
          <span>备注</span>
          <span>生成时间</span>
          <span>有效期</span>
          <span>操作</span>
        </div>
        {credentials.loading && !credentials.data ? (
          <Loading />
        ) : !credentials.data?.length ? (
          <p className="credential-empty">暂无凭证，生成后即可连接插件。</p>
        ) : (
          credentials.data.map((item) => (
            <div className="credential-record" key={item.id}>
              <strong>{item.label || "未命名凭证"}</strong>
              <time
                dateTime={item.created_at || undefined}
                data-label="生成时间"
              >
                {generatedAt(item.created_at)}
              </time>
              <span className="credential-validity" data-label="有效期">
                {item.expires_at ? "已失效" : "长期有效"}
              </span>
              <div className="credential-actions">
                <button
                  className="text-button"
                  disabled={action.busy}
                  onClick={() => {
                    setRemark(item.label);
                    setEditing(item);
                  }}
                >
                  修改备注
                </button>
                <button
                  className="text-button delete-credential"
                  disabled={action.busy}
                  onClick={() => setDeleting(item)}
                >
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      {editing && (
        <Modal
          title="修改凭证备注"
          onClose={() => {
            if (!action.busy) setEditing(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                await api(
                  `/integrations/tokens/${editing.id}`,
                  { label: remark },
                  "PATCH",
                );
                if (fresh?.id === editing.id)
                  setFresh({ ...fresh, label: remark.trim() });
                setEditing(null);
                credentials.reload();
              });
            }}
          >
            <label>
              备注
              <input
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                maxLength={80}
                required
                autoFocus
              />
            </label>
            <ErrorBox message={action.error} />
            <div className="actions">
              <button
                className="secondary"
                type="button"
                disabled={action.busy}
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={action.busy || !remark.trim()}
              >
                保存备注
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="删除接收凭证"
          onClose={() => {
            if (!action.busy) setDeleting(null);
          }}
        >
          <p>
            删除“{deleting.label}
            ”后，使用这条凭证的插件或收集工具将无法继续连接。已收集的资料不会删除。
          </p>
          <ErrorBox message={action.error} />
          <div className="actions">
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() => setDeleting(null)}
            >
              取消
            </button>
            <button
              className="primary"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  await api(
                    `/integrations/tokens/${deleting.id}`,
                    {},
                    "DELETE",
                  );
                  if (fresh?.id === deleting.id) setFresh(null);
                  setDeleting(null);
                  setFeedback("凭证已删除");
                  credentials.reload();
                })
              }
            >
              {action.busy ? "删除中…" : "确认删除"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
