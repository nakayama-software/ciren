import { useState, useEffect, useMemo } from 'react'
import {
  Cpu, Plus, Trash2, Check, X, LogOut, LayoutDashboard,
  Globe, Sun, Moon, Wifi, ChevronRight, AlertTriangle,
} from 'lucide-react'
import { getUserDevices, addUserDevice, removeUserDevice } from '../lib/api'

const translations = {
  en: {
    locale: 'en-US',
    title: 'My Devices',
    subtitle: 'Manage your IoT main modules',
    addTitle: 'Add New Device',
    deviceIdLabel: 'Device ID',
    deviceIdPlaceholder: 'e.g. MM-001',
    addButton: 'Add Device',
    adding: 'Adding...',
    emptyState: 'No devices registered yet. Add your first device above.',
    goToDashboard: 'Dashboard',
    logout: 'Logout',
    deleteConfirm: 'Remove this device from your account?',
    deviceId: 'Device ID',
    alerts: {
      missingId: 'Please enter a Device ID.',
      addFailed: 'Failed to add device',
      deleteFailed: 'Failed to remove device',
    },
  },
  ja: {
    locale: 'ja-JP',
    title: 'マイデバイス',
    subtitle: 'IoTメインモジュールを管理',
    addTitle: '新しいデバイスを追加',
    deviceIdLabel: 'デバイスID',
    deviceIdPlaceholder: '例：MM-001',
    addButton: 'デバイスを追加',
    adding: '追加中...',
    emptyState: 'デバイスが登録されていません。上から最初のデバイスを追加してください。',
    goToDashboard: 'ダッシュボード',
    logout: 'ログアウト',
    deleteConfirm: 'このデバイスをアカウントから削除しますか？',
    deviceId: 'デバイスID',
    alerts: {
      missingId: 'デバイスIDを入力してください。',
      addFailed: 'デバイスの追加に失敗しました',
      deleteFailed: 'デバイスの削除に失敗しました',
    },
  },
}

export default function DeviceManagementPage({ username, onGoToDashboard, onLogout, theme, toggleTheme }) {
  const [language, setLanguage] = useState('ja')
  const t = useMemo(() => translations[language], [language])

  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState(null)

  const [newId, setNewId] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)

  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => { fetchDevices() }, [])

  async function fetchDevices() {
    setLoading(true)
    setErrorMsg(null)
    try {
      const devs = await getUserDevices()
      setDevices(devs)
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd() {
    setAddError(null)
    if (!newId.trim()) { setAddError(t.alerts.missingId); return }
    setAdding(true)
    try {
      await addUserDevice(newId.trim().toUpperCase())
      setNewId('')
      await fetchDevices()
    } catch (err) {
      setAddError(`${t.alerts.addFailed}: ${err.message}`)
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id) {
    try {
      await removeUserDevice(id)
      setDeletingId(null)
      await fetchDevices()
    } catch (err) {
      alert(`${t.alerts.deleteFailed}: ${err.message}`)
    }
  }

  const LangSwitch = () => (
    <div className="flex items-center gap-2">
      <Globe className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      <div className="inline-flex rounded-md bg-black/5 p-1 border border-black/10 dark:border-white/10 dark:bg-white/10">
        {['ja', 'en'].map((lang) => (
          <button key={lang} type="button" onClick={() => setLanguage(lang)}
            className={`px-3 py-1 text-xs rounded cursor-pointer ${language === lang
              ? (theme === 'dark' ? 'bg-white text-slate-900' : 'bg-slate-900 text-white')
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'}`}>
            {lang === 'ja' ? '日本語' : 'EN'}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div lang={t.locale}
      className="min-h-screen font-['Noto_Sans_JP','Hiragino_Kaku_Gothic_ProN','Yu_Gothic_UI',system-ui,sans-serif]">
      <div className="relative z-10 mx-auto max-w-3xl px-5 py-5">
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
            <button type="button" onClick={toggleTheme}
              className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 cursor-pointer">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <LangSwitch />
            <button type="button" onClick={onGoToDashboard}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100 cursor-pointer">
              <LayoutDashboard className="w-4 h-4" />
              <span>{t.goToDashboard}</span>
            </button>
            <button type="button" onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-black/5 dark:border-white/10 dark:text-white dark:hover:bg-white/10 cursor-pointer">
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
          <p className="text-xs text-slate-500 dark:text-gray-400 mb-4">
            {language === 'ja'
              ? 'メインモジュールのデバイスIDを入力してください（例：'
              : 'Enter the Device ID of your main module (e.g. '}
            <span className="font-mono text-cyan-600 dark:text-cyan-400">MM-001</span>
            {language === 'ja' ? '）。' : ').'}
          </p>
          <div className="mb-3">
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">{t.deviceIdLabel}</label>
            <input type="text" value={newId} onChange={(e) => setNewId(e.target.value)}
              placeholder={t.deviceIdPlaceholder}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-slate-900 font-mono placeholder-gray-400 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-400/30 dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder-gray-500" />
          </div>
          {addError && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{addError}</p>}
          <button type="button" onClick={handleAdd} disabled={adding}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100 disabled:opacity-50 cursor-pointer">
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
        ) : devices.length === 0 ? (
          <div className="rounded-xl border border-black/10 bg-white/70 p-8 text-center backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60">
            <Cpu className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{t.emptyState}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {devices.map((id) => (
              <div key={id}
                className="rounded-xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
                {deletingId === id ? (
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-slate-900 dark:text-white mb-3">{t.deleteConfirm}</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleDelete(id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 cursor-pointer">
                          <Trash2 className="w-3 h-3" /> {language === 'ja' ? '削除する' : 'Delete'}
                        </button>
                        <button onClick={() => setDeletingId(null)}
                          className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-black/5 dark:border-white/10 dark:text-white dark:hover:bg-white/10 cursor-pointer">
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
                      <p className="text-sm font-semibold text-slate-900 dark:text-white font-mono">{id}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{t.deviceId}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={onGoToDashboard} title={t.goToDashboard}
                        className="p-2 rounded-lg border border-black/10 text-cyan-600 hover:bg-cyan-500/10 dark:border-white/10 dark:text-cyan-400 cursor-pointer">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeletingId(id)} title={language === 'ja' ? '削除' : 'Remove'}
                        className="p-2 rounded-lg border border-red-500/20 text-red-500 hover:bg-red-500/10 dark:border-red-500/20 cursor-pointer">
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
  )
}
