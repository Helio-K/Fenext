import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Settings, LogOut } from "lucide-react";
import choices from "../shared/emojis.json";
import { api, ErrorBox, Modal, useAction, type Data } from "./lib";

function EmojiChoices({
  values,
  value,
  onChange,
}: {
  values: string[];
  value: string;
  onChange: (emoji: string) => void;
}) {
  return (
    <div className="emoji-grid" aria-label="选择 emoji">
      {values.map((emoji) => (
        <button
          type="button"
          key={emoji}
          aria-label={emoji}
          aria-pressed={value === emoji}
          onClick={() => onChange(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function MaterialIcon({
  task,
  onSaved,
}: {
  task: Data;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(task.icon || "");
  const action = useAction();
  return (
    <>
      <button
        className="file-icon material-icon"
        aria-label={"更换资料图标：" + task.title}
        title="更换资料图标"
        onClick={() => {
          setSelected(task.icon || "");
          setOpen(true);
        }}
      >
        {task.icon ? (
          <span className="chosen-emoji">{task.icon}</span>
        ) : (
          <FileText size={20} />
        )}
      </button>
      {open && (
        <Modal
          title="选择资料图标"
          onClose={() => {
            if (!action.busy) setOpen(false);
          }}
        >
          <EmojiChoices
            values={choices.materials}
            value={selected}
            onChange={setSelected}
          />
          <ErrorBox message={action.error} />
          <div className="actions">
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() => setSelected("")}
            >
              使用默认图标
            </button>
            <button
              className="primary"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  await api(
                    `/tasks/${task.id}/icon`,
                    { emoji: selected },
                    "PATCH",
                  );
                  onSaved();
                  setOpen(false);
                })
              }
            >
              {action.busy ? "保存中…" : "保存图标"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function AccountControls({
  user,
  onUser,
  mobile = false,
}: {
  user: Data;
  onUser: (user: Data | null) => void;
  mobile?: boolean;
}) {
  const [menu, setMenu] = useState(false),
    [editing, setEditing] = useState(false);
  const [name, setName] = useState(""),
    [avatar, setAvatar] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const action = useAction();
  const displayName = user.displayName || user.username;
  const face = user.avatar || displayName.slice(0, 1).toUpperCase();
  useEffect(() => {
    if (menu) {
      const element = dialog.current;
      element?.showModal();
      return () => element?.close();
    }
  }, [menu]);
  const hadPopup = useRef(false);
  useEffect(() => {
    if (menu || editing) hadPopup.current = true;
    else if (hadPopup.current) {
      trigger.current?.focus();
      hadPopup.current = false;
    }
  }, [menu, editing]);
  const closeMenu = () => {
    dialog.current?.close();
    setMenu(false);
  };
  const edit = () => {
    setName(displayName);
    setAvatar(user.avatar || "");
    closeMenu();
    setEditing(true);
  };
  const closeEdit = () => {
    if (!action.busy) {
      setEditing(false);
      trigger.current?.focus();
    }
  };
  return (
    <>
      <button
        ref={trigger}
        className={mobile ? "mobile-account" : "account account-trigger"}
        aria-label="个人菜单"
        aria-haspopup="dialog"
        aria-expanded={menu}
        onClick={() => setMenu(true)}
      >
        <span className="avatar">{face}</span>
        {mobile ? (
          <span>我的</span>
        ) : (
          <>
            <span>
              <strong>{displayName}</strong>
              <small>个人知识空间</small>
            </span>
          </>
        )}
      </button>
      {menu && (
        <dialog
          ref={dialog}
          className={"account-popover" + (mobile ? " mobile" : "")}
          aria-label="个人菜单"
          onCancel={(event) => {
            event.preventDefault();
            closeMenu();
          }}
          onClick={(event) => {
            if (event.target === dialog.current) {
              const r = dialog.current.getBoundingClientRect();
              if (
                event.clientX < r.left ||
                event.clientX > r.right ||
                event.clientY < r.top ||
                event.clientY > r.bottom
              )
                closeMenu();
            }
          }}
        >
          <button
            className="profile-menu-header"
            onClick={edit}
            aria-label="编辑个人资料"
          >
            <span className="avatar">{face}</span>
            <span>
              <strong>{displayName}</strong>
              <small>编辑个人资料</small>
            </span>
          </button>
          <div className="account-menu-items">
            <Link to="/settings" onClick={closeMenu}>
              <Settings size={20} />
              设置与同步
            </Link>
            <button
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  await api("/logout", {});
                  closeMenu();
                  onUser(null);
                })
              }
            >
              <LogOut size={20} />
              退出登录
            </button>
          </div>
          <ErrorBox message={action.error} />
        </dialog>
      )}
      {editing && (
        <Modal title="编辑个人资料" onClose={closeEdit}>
          <form
            className="profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                const updated = await api(
                  "/me",
                  { displayName: name, avatar },
                  "PATCH",
                );
                onUser(updated);
                setEditing(false);
                trigger.current?.focus();
              });
            }}
          >
            <div className="profile-preview">
              <span className="avatar">
                {avatar || name.slice(0, 1).toUpperCase()}
              </span>
              <span>选择头像</span>
            </div>
            <EmojiChoices
              values={choices.avatars}
              value={avatar}
              onChange={setAvatar}
            />
            <button
              type="button"
              className="text-button"
              onClick={() => setAvatar("")}
            >
              使用名字首字
            </button>
            <label>
              昵称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={40}
                required
              />
            </label>
            <p className="muted">登录账号：{user.username}</p>
            <ErrorBox message={action.error} />
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={action.busy}
                onClick={closeEdit}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={action.busy || !name.trim()}
              >
                {action.busy ? "保存中…" : "保存资料"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
