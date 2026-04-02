import { useState, useEffect, useMemo } from 'react';
import {
  Cpu, Plus, Trash2, Pencil, Check, X, LogOut, LayoutDashboard,
  Globe, Sun, Moon, Wifi, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getRaspis, addRaspi, updateRaspi, deleteRaspi, logout, getUsername, isLoggedIn } from './lib/api';

const translations = {
  en: {
    locale: 'en-US',
    title: 'My Raspberry Pis',
    subtitle: 'Manage your IoT devices',
    addTitle: 'Add New Raspberry Pi',
    serialLabel: 'Serial ID',
    serialPlaceholder: 'e.g. 10000000c6...',
    labelLabel: 'Label (optional)',
    labelPlaceholder: 'e.g. Warehouse A',
    addButton: 'Add Device',
    adding: 'Adding...',
    emptyState: 'No devices registered yet. Add your first Raspberry Pi above.',
    goToDashboard: 'Dashboard',
    logout: 'Logout',
    deleteConfirm: 'Delete this device and ALL its sensor data? This cannot be undone.',
    editLabel: 'Edit label',
    saveLabel: 'Save',
    cancelEdit: 'Cancel',
    serialId: 'Serial ID',
    noLabel: 'No label',
    alerts: {
      missingSerial: 'Please enter a Serial ID.',
      addFailed: 'Failed to add device',
      deleteFailed: 'Failed to delete device',
      updateFailed: 'Failed to update label',
    },
  },
  ja: {
    locale: 'ja-JP',
    title: 'マイ Raspberry Pi',
    subtitle: 'IoTデバイスを管理',
    addTitle: '新しいRaspberry Piを追加',
    serialLabel: 'シリアルID',
    serialPlaceholder: '例：10000000c6...',
    labelLabel: 'ラベル（任意）',
    labelPlaceholder: '例：倉庫A',
    addButton: 'デバイスを追加',
    adding: '追加中...',
    emptyState: 'デバイスが登録されていません。上から最初のRaspberry Piを追加してください。',
    goToDashboard: 'ダッシュボード',
    logout: 'ログアウト',
    deleteConfirm: 'このデバイスとすべてのセンサーデータを削除しますか？この操作は元に戻せません。',
    editLabel: 'ラベルを編集',
    saveLabel: '保存',
    cancelEdit: 'キャンセル',
    serialId: 'シリアルID',
    noLabel: 'ラベルなし',
    alerts: {
      missingSerial: 'シリアルIDを入力してください。',
      addFailed: 'デバイスの追加に失敗しました',
      deleteFailed: 'デバイスの削除に失敗しました',
      updateFailed: 'ラベルの更新に失敗しました',
    },
  },
};

export default function RaspiManagement() {
  const navigate = useNavigate();

  const [language, setLanguage] = useState('ja');
  const t = useMemo(() => translations[language], [language]);

  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('ciren-theme') : null;
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  });

  useEffect(() => {
    if (!isLoggedIn()) { navigate('/ciren', { replace: true }); return; }
    fetchRaspis();
  }, []);

  useEffect(() => {
    const html = document.querySelector('html');
    if (!html) return;
    html.classList.toggle('dark', theme === 'dark');
    html.style.colorScheme = theme;
    localStorage.setItem('ciren-theme', theme);
  }, [theme]);

  const [raspis, setRaspis]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // Add form
  const [newSerial, setNewSerial] = useState('');
  const [newLabel,  setNewLabel]  = useState('');
  const [adding, setAdding]       = useState(false);
  const [addError, setAddError]   = useState(null);

  // Inline edit
  const [editingId,    setEditingId]    = useState(null);
  const [editingLabel, setEditingLabel] = useState('');

  // Delete confirm
  const [deletingId, setDeletingId] = useState(null);

  const username = getUsername();

  async function fetchRaspis() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await getRaspis();
      setRaspis(data.raspis || []);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    setAddError(null);
    if (!newSerial.trim()) { setAddError(t.alerts.missingSerial); return; }
    setAdding(true);
    try {
      await addRaspi(newSerial.trim(), newLabel.trim() || null);
      setNewSerial('');
      setNewLabel('');
      await fetchRaspis();
    } catch (err) {
      setAddError(`${t.alerts.addFailed}: ${err.message}`);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(serial) {
    try {
      await deleteRaspi(serial);
      setDeletingId(null);
      await fetchRaspis();
    } catch (err) {
      alert(`${t.alerts.deleteFailed}: ${err.message}`);
    }
  }

  async function handleSaveLabel(serial) {
    try {
      await updateRaspi(serial, editingLabel.trim() || null);
      setEditingId(null);
      await fetchRaspis();
    } catch (err) {
      alert(`${t.alerts.updateFailed}: ${err.message}`);
    }
  }

  function handleLogout() {
    logout();
    navigate('/ciren');
  }

  const LangSwitch = () => (
    <div className="flex items-center gap-2">
      <Globe className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      <div className="inline-flex rounded-md bg-black/5 p-1 border border-black/10 dark:border-white/10 dark:bg-white/10">
        {['ja', 'en'].map(lang => (
          <button key={lang} type="button" onClick={() => setLanguage(lang)}
            className={`px-3 py-1 text-xs rounded ${language === lang
              ? (theme === 'dark' ? 'bg-white text-slate-900' : 'bg-slate-900 text-white')
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'}`}>
            {lang === 'ja' ? '日本語' : 'EN'}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div lang={t.locale}
      className="min-h-screen font-['Noto_Sans_JP','Hiragino Kaku Gothic ProN','Yu Gothic UI',system-ui,sans-serif]
                 bg-slate-50 text-slate-900 dark:text-white
                 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 transition-colors duration-500">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-32 -right-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-5 py-5">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {username} · {t.subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <LangSwitch />
            <button type="button" onClick={() => navigate('/ciren/dashboard')}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100">
              <LayoutDashboard className="w-4 h-4" />
              <span>{t.goToDashboard}</span>
            </button>
            <button type="button" onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-black/5 dark:border-white/10 dark:text-white dark:hover:bg-white/10">
              <LogOut className="w-4 h-4" />
              <span>{t.logout}</span>
            </button>
          </div>
        </header>

        {/* Add Device Form */}
        <div className="rounded-2xl border border-black/10 bg-white/80 p-5 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm mb-6">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
            <Plus className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            {t.addTitle}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">{t.serialLabel}</label>
              <input type="text" value={newSerial} onChange={e => setNewSerial(e.target.value)}
                placeholder={t.serialPlaceholder}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-slate-900
                           placeholder-gray-400 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-400/30
                           dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder-gray-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">{t.labelLabel}</label>
              <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder={t.labelPlaceholder}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-slate-900
                           placeholder-gray-400 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-400/30
                           dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder-gray-500" />
            </div>
          </div>
          {addError && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-3">{addError}</p>
          )}
          <button type="button" onClick={handleAdd} disabled={adding}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100 disabled:opacity-50">
            <Plus className="w-4 h-4" />
            {adding ? t.adding : t.addButton}
          </button>
        </div>

        {/* Device List */}
        {loading ? (
          <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
            {language === 'ja' ? '読み込み中...' : 'Loading...'}
          </div>
        ) : errorMsg ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        ) : raspis.length === 0 ? (
          <div className="rounded-xl border border-black/10 bg-white/70 p-8 text-center backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60">
            <Cpu className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{t.emptyState}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {raspis.map(raspi => (
              <div key={raspi.raspberry_serial_id}
                className="rounded-xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm">

                {/* Delete confirm overlay */}
                {deletingId === raspi.raspberry_serial_id ? (
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-slate-900 dark:text-white mb-3">{t.deleteConfirm}</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleDelete(raspi.raspberry_serial_id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                          <Trash2 className="w-3 h-3" /> {language === 'ja' ? '削除する' : 'Delete'}
                        </button>
                        <button onClick={() => setDeletingId(null)}
                          className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-black/5 dark:border-white/10 dark:text-white dark:hover:bg-white/10">
                          <X className="w-3 h-3" /> {language === 'ja' ? 'キャンセル' : 'Cancel'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500">
                      <Cpu className="h-5 w-5 text-white" />
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Label row */}
                      {editingId === raspi.raspberry_serial_id ? (
                        <div className="flex items-center gap-2 mb-1">
                          <input type="text" value={editingLabel}
                            onChange={e => setEditingLabel(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveLabel(raspi.raspberry_serial_id); if (e.key === 'Escape') setEditingId(null); }}
                            className="flex-1 rounded border border-black/10 bg-white/80 px-2 py-1 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-400/30 dark:border-white/20 dark:bg-slate-900/70 dark:text-white"
                            autoFocus />
                          <button onClick={() => handleSaveLabel(raspi.raspberry_serial_id)}
                            className="p-1 rounded text-green-600 hover:bg-green-500/10"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)}
                            className="p-1 rounded text-gray-500 hover:bg-black/5 dark:hover:bg-white/10"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                            {raspi.label || <span className="text-gray-400 dark:text-gray-500 italic">{t.noLabel}</span>}
                          </span>
                          <button onClick={() => { setEditingId(raspi.raspberry_serial_id); setEditingLabel(raspi.label || ''); }}
                            className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                        {t.serialId}: {raspi.raspberry_serial_id}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => { setEditingId(raspi.raspberry_serial_id); setEditingLabel(raspi.label || ''); }}
                        title={t.editLabel}
                        className="p-2 rounded-lg border border-black/10 text-gray-600 hover:bg-black/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => navigate('/ciren/dashboard')}
                        title={t.goToDashboard}
                        className="p-2 rounded-lg border border-black/10 text-cyan-600 hover:bg-cyan-500/10 dark:border-white/10 dark:text-cyan-400">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeletingId(raspi.raspberry_serial_id)}
                        title={language === 'ja' ? '削除' : 'Delete'}
                        className="p-2 rounded-lg border border-red-500/20 text-red-500 hover:bg-red-500/10 dark:border-red-500/20">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}