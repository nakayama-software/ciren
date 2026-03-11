import React, { useState, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";

function buildKey(raspiId, controllerId) {
  if (controllerId) return `ciren-alias-ctrl-${raspiId}-${controllerId}`;
  return `ciren-alias-raspi-${raspiId}`;
}

export function getAlias(raspiId, controllerId = null) {
  try {
    return localStorage.getItem(buildKey(raspiId, controllerId)) || "";
  } catch {
    return "";
  }
}

function saveAlias(raspiId, controllerId, value) {
  try {
    const key = buildKey(raspiId, controllerId);
    if (value.trim()) {
      localStorage.setItem(key, value.trim());
    } else {
      localStorage.removeItem(key);
    }
  } catch {}
}

// Accessible button substitute safe to nest inside a <button>
function IconBtn({ onClick, title, className, children }) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") onClick(e);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      title={title}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </span>
  );
}

export default function AliasInlineEdit({
  raspiId,
  controllerId = null,
  originalName,
  className = "",
  textClass = "",
}) {
  const [alias, setAliasState] = useState(() => getAlias(raspiId, controllerId));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Re-read alias from localStorage whenever the target (raspiId / controllerId) changes.
  // Without this, the initial useState value sticks when React reuses the component instance.
  useEffect(() => {
    setAliasState(getAlias(raspiId, controllerId));
    setEditing(false);
    setDraft("");
  }, [raspiId, controllerId]);

  const displayName = alias || originalName;

  const startEdit = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setDraft(alias);
    setEditing(true);
  };

  const save = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    saveAlias(raspiId, controllerId, draft);
    setAliasState(draft.trim());
    setEditing(false);
  };

  const cancel = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    setDraft("");
    setEditing(false);
  };

  if (editing) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save(e);
            if (e.key === "Escape") cancel(e);
          }}
          placeholder={originalName}
          className="rounded border border-cyan-400 px-2 py-0.5 text-sm bg-white dark:bg-slate-800
                     text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-cyan-500
                     min-w-0 w-40"
        />
        <IconBtn
          onClick={save}
          title="Save alias"
          className="p-0.5 rounded hover:bg-green-100 dark:hover:bg-green-900/40 text-green-600 dark:text-green-400 transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn
          onClick={cancel}
          title="Cancel"
          className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 dark:text-red-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </IconBtn>
      </span>
    );
  }

  return (
    <span className={`group inline-flex items-center gap-1.5 ${className}`}>
      <span className={textClass}>{displayName}</span>
      {alias && (
        <span className="text-xs text-gray-400 dark:text-gray-500 font-mono font-normal">
          ({originalName})
        </span>
      )}
      <IconBtn
        onClick={startEdit}
        title="Set alias"
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded
                   hover:bg-black/10 dark:hover:bg-white/10
                   text-gray-400 hover:text-cyan-500 dark:hover:text-cyan-400
                   transition-opacity flex-shrink-0"
      >
        <Pencil className="w-3 h-3" />
      </IconBtn>
    </span>
  );
}