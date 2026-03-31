import { useState, useEffect } from 'react'
import { Wifi, ArrowRight, User, UserPlus, Globe, Sun, Moon, Eye, EyeOff } from 'lucide-react'
import { login, setToken, setUsername } from '../lib/api'

const translations = {
  en: {
    locale: 'en-US',
    title: 'CIREN',
    subtitle: 'Real-time IoT Monitoring',
    stats: { activeDevices: 'Active Devices', dataPoints: 'Data Points', uptime: 'Uptime' },
    buttons: { login: 'Login', register: 'Create account', submitLogin: 'Sign In', goBack: 'Back' },
    features: {
      realtime:  { title: 'Realtime',   description: 'Per-second device updates.' },
      secure:    { title: 'Secure',     description: 'End-to-end encrypted transport.' },
      analytics: { title: 'Analytics',  description: 'Clear, actionable insights.' },
    },
    loginForm: {
      title: 'Sign in',
      subtitle: 'Enter your username and password.',
      usernameLabel: 'Username',
      usernamePlaceholder: 'your username',
      passwordLabel: 'Password',
      passwordPlaceholder: '••••••••',
    },
    alerts: {
      missingInput: 'Please enter username and password.',
      invalidCredentials: 'Invalid username or password.',
    },
    footer: '© 2025 CIREN',
  },
  ja: {
    locale: 'ja-JP',
    title: 'CIREN',
    subtitle: 'リアルタイムIoTモニタリング',
    stats: { activeDevices: '稼働デバイス', dataPoints: 'データポイント', uptime: '稼働率' },
    buttons: { login: 'ログイン', register: '新規登録', submitLogin: 'ログイン', goBack: '戻る' },
    features: {
      realtime:  { title: 'リアルタイム', description: '毎秒更新で状態を把握。' },
      secure:    { title: 'セキュア',     description: 'エンドツーエンド暗号化で安全に伝送。' },
      analytics: { title: '分析',         description: '簡潔な可視化で意思決定を支援。' },
    },
    loginForm: {
      title: 'ログイン',
      subtitle: 'ユーザー名とパスワードを入力してください。',
      usernameLabel: 'ユーザー名',
      usernamePlaceholder: 'ユーザー名を入力',
      passwordLabel: 'パスワード',
      passwordPlaceholder: '••••••••',
    },
    alerts: {
      missingInput: 'ユーザー名とパスワードを入力してください。',
      invalidCredentials: 'ユーザー名またはパスワードが正しくありません。',
    },
    footer: '© 2025 CIREN',
  },
}

export default function LoginPage({ onLogin, onGoRegister, theme, toggleTheme }) {
  const [language, setLanguage] = useState('ja')
  const t = translations[language]

  const [showLoginForm, setShowLoginForm] = useState(false)
  const [username, setUsernameState] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())
  const stats = { activeDevices: '—', dataPoints: '—', uptime: '—' }

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const fmtJaTime = (date, locale) => {
    if (locale !== 'ja-JP') return date.toLocaleString(locale)
    const o = new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, weekday: 'short',
    }).formatToParts(date)
    const get = (type) => o.find((p) => p.type === type)?.value || ''
    return `${get('year')}/${get('month')}/${get('day')}(${get('weekday')}) ${get('hour')}:${get('minute')}:${get('second')}`
  }

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setErrorMsg(t.alerts.missingInput)
      return
    }
    setErrorMsg(null)
    setLoading(true)
    try {
      const { token, username: uname } = await login(username.trim(), password)
      setToken(token)
      setUsername(uname)
      onLogin(uname)
    } catch {
      setErrorMsg(t.alerts.invalidCredentials)
    } finally {
      setLoading(false)
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

  const ThemeSwitch = () => (
    <button type="button" onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 cursor-pointer">
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      <span>{theme === 'dark' ? (language === 'ja' ? 'ライト' : 'Light') : (language === 'ja' ? 'ダーク' : 'Dark')}</span>
    </button>
  )

  const StatCard = ({ label, value }) => (
    <div className="rounded-xl border border-black/10 bg-white/70 p-4 text-slate-900 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 dark:text-white shadow-sm">
      <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  )

  return (
    <div lang={t.locale}
      className="fixed inset-0 flex flex-col font-['Noto_Sans_JP','Hiragino_Kaku_Gothic_ProN','Yu_Gothic_UI',system-ui,sans-serif]">
      <div className="mx-auto flex h-full max-w-5xl flex-col px-5 w-full">
        <header className="flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
              <p className="text-xs text-gray-600 dark:text-gray-400">{t.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeSwitch />
            <LangSwitch />
          </div>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-3xl">
            <div className="mb-6 text-right text-[11px] font-mono text-gray-600 dark:text-gray-400">
              {fmtJaTime(currentTime, t.locale)}
            </div>

            {!showLoginForm ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-5">
                <div className="sm:col-span-3">
                  <div className="rounded-2xl border border-black/10 bg-white/80 p-6 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 transition-colors">
                    <h2 className="text-lg font-medium tracking-tight">{t.subtitle}</h2>
                    <p className="mt-2 text-sm leading-6 text-gray-700 dark:text-gray-300">
                      {language === 'ja'
                        ? '重要な情報だけを、見やすく、静かに。過度な装飾を避け、業務に集中できるUIです。'
                        : 'Quiet, legible UI that surfaces only the essentials—so teams stay focused.'}
                    </p>
                    <div className="mt-6 grid grid-cols-3 gap-3">
                      <StatCard label={t.stats.activeDevices} value={stats.activeDevices} />
                      <StatCard label={t.stats.dataPoints}    value={stats.dataPoints} />
                      <StatCard label={t.stats.uptime}        value={stats.uptime} />
                    </div>
                    <div className="mt-8 flex flex-col gap-2 sm:flex-row">
                      <button type="button" onClick={() => setShowLoginForm(true)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus:ring-2 focus:ring-cyan-400 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100 cursor-pointer">
                        <User className="h-4 w-4" />
                        <span>{t.buttons.login}</span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={onGoRegister}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-black/10 bg-transparent px-4 py-2 text-sm font-medium text-slate-900 hover:bg-black/5 focus:ring-2 focus:ring-cyan-400 dark:border-white/10 dark:text-white dark:hover:bg-white/10 cursor-pointer">
                        <UserPlus className="h-4 w-4" />
                        <span>{t.buttons.register}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:col-span-2">
                  {Object.values(t.features).map((feat) => (
                    <div key={feat.title} className="rounded-xl border border-black/10 bg-white/70 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60">
                      <div className="text-sm font-medium">{feat.title}</div>
                      <div className="mt-1 text-xs text-gray-700 dark:text-gray-400">{feat.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-md">
                <div className="rounded-2xl border border-black/10 bg-white/80 p-6 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60">
                  <div className="mb-5 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
                      <User className="h-6 w-6" />
                    </div>
                    <h2 className="text-lg font-medium tracking-tight">{t.loginForm.title}</h2>
                    <p className="mt-1 text-xs text-gray-700 dark:text-gray-400">{t.loginForm.subtitle}</p>
                  </div>

                  <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); handleLogin() }}>
                    <div>
                      <label htmlFor="login-username" className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                        {t.loginForm.usernameLabel}
                      </label>
                      <input id="login-username" type="text" value={username}
                        onChange={(e) => setUsernameState(e.target.value)}
                        placeholder={t.loginForm.usernamePlaceholder}
                        autoComplete="username"
                        className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder-gray-500 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-400/30 dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder-gray-400" />
                    </div>
                    <div>
                      <label htmlFor="login-password" className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                        {t.loginForm.passwordLabel}
                      </label>
                      <div className="relative">
                        <input id="login-password" type={showPassword ? 'text' : 'password'} value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={t.loginForm.passwordPlaceholder}
                          autoComplete="current-password"
                          className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 pr-10 text-sm text-slate-900 placeholder-gray-500 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-400/30 dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder-gray-400" />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    {errorMsg && (
                      <div role="status" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
                        {errorMsg}
                      </div>
                    )}
                    <div className="mt-4 flex items-center gap-2">
                      <button type="submit" disabled={loading}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:ring-2 focus:ring-cyan-400 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100 disabled:opacity-50 cursor-pointer">
                        {loading ? (language === 'ja' ? '確認中...' : 'Signing in...') : t.buttons.submitLogin}
                        {!loading && <ArrowRight className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => { setShowLoginForm(false); setUsernameState(''); setPassword(''); setErrorMsg(null) }}
                        className="inline-flex items-center justify-center rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 hover:bg-black/5 focus:ring-2 focus:ring-cyan-400 dark:border-white/10 dark:text-white dark:hover:bg-white/10 cursor-pointer">
                        {t.buttons.goBack}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </main>

        <footer className="py-6 text-center text-xs text-gray-600 dark:text-gray-500 transition-colors">
          {t.footer}
        </footer>
      </div>
    </div>
  )
}
