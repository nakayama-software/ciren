import { useState } from 'react'
import { UserPlus, ArrowRight, ArrowLeft, Globe, Sun, Moon, Eye, EyeOff } from 'lucide-react'
import { register } from '../lib/api'

const translations = {
  en: {
    locale: 'en-US',
    title: 'Create New Account',
    subtitle: 'Register your username and password.',
    usernameLabel: 'Username',
    usernamePlaceholder: 'Choose a username...',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Choose a password...',
    confirmPasswordLabel: 'Confirm Password',
    confirmPasswordPlaceholder: 'Re-enter your password...',
    registerButton: 'Create Account',
    backButton: 'Back',
    footer: '© 2025 CIREN',
    alerts: {
      fillAllFields: 'Please fill in all fields.',
      passwordMismatch: 'Passwords do not match.',
      passwordTooShort: 'Password must be at least 6 characters.',
      success: 'Account created! Please sign in.',
      failed: 'Failed',
      genericError: 'An error occurred',
    },
  },
  ja: {
    locale: 'ja-JP',
    title: '新規アカウント作成',
    subtitle: 'ユーザー名とパスワードを登録します。',
    usernameLabel: 'ユーザー名',
    usernamePlaceholder: 'ご希望のユーザー名を入力...',
    passwordLabel: 'パスワード',
    passwordPlaceholder: 'パスワードを入力...',
    confirmPasswordLabel: 'パスワード（確認）',
    confirmPasswordPlaceholder: 'パスワードを再入力...',
    registerButton: 'アカウント作成',
    backButton: '戻る',
    footer: '© 2025 CIREN',
    alerts: {
      fillAllFields: 'すべてのフィールドに入力してください。',
      passwordMismatch: 'パスワードが一致しません。',
      passwordTooShort: 'パスワードは6文字以上にしてください。',
      success: 'アカウントを作成しました！ログインしてください。',
      failed: '失敗',
      genericError: 'エラーが発生しました',
    },
  },
}

const PasswordInput = ({ id, value, onChange, placeholder, show, onToggle, autoComplete }) => (
  <div className="relative">
    <input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange}
      placeholder={placeholder} autoComplete={autoComplete}
      className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 pr-10 text-sm text-slate-900 placeholder-gray-500 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-400/30 dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder-gray-400" />
    <button type="button" onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer">
      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  </div>
)

export default function RegisterPage({ onLogin, onGoLogin, theme, toggleTheme }) {
  const [language, setLanguage] = useState('ja')
  const t = translations[language]

  const [username, setUsernameState] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setErrorMsg(null)
    if (!username.trim() || !password.trim() || !confirmPassword.trim()) {
      setErrorMsg(t.alerts.fillAllFields); return
    }
    if (password.length < 6) {
      setErrorMsg(t.alerts.passwordTooShort); return
    }
    if (password !== confirmPassword) {
      setErrorMsg(t.alerts.passwordMismatch); return
    }
    setLoading(true)
    try {
      await register(username.trim(), password)
      alert(t.alerts.success)
      onGoLogin()
    } catch (err) {
      setErrorMsg(`${t.alerts.failed}: ${err.message || t.alerts.genericError}`)
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

  return (
    <div lang={t.locale}
      className="fixed inset-0 flex flex-col font-['Noto_Sans_JP','Hiragino_Kaku_Gothic_ProN','Yu_Gothic_UI',system-ui,sans-serif]">
      <div className="mx-auto flex h-full max-w-5xl flex-col px-5 w-full">
        <header className="flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">CIREN</h1>
              <p className="text-xs text-gray-600 dark:text-gray-400">Registration</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={toggleTheme}
              className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 cursor-pointer">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <LangSwitch />
          </div>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-black/10 bg-white/80 p-6 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500">
                  <UserPlus className="h-6 w-6 text-white" />
                </div>
                <h2 className="text-lg font-medium tracking-tight text-slate-900 dark:text-white">{t.title}</h2>
                <p className="mt-1 text-xs text-gray-700 dark:text-gray-400">{t.subtitle}</p>
              </div>
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleSubmit() }}>
                <div>
                  <label htmlFor="reg-username" className="block text-xs text-gray-700 dark:text-gray-300 mb-2">{t.usernameLabel}</label>
                  <input id="reg-username" type="text" value={username}
                    onChange={(e) => setUsernameState(e.target.value)}
                    placeholder={t.usernamePlaceholder}
                    autoComplete="username"
                    className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder-gray-500 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-400/30 dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder-gray-400" />
                </div>
                <div>
                  <label htmlFor="reg-password" className="block text-xs text-gray-700 dark:text-gray-300 mb-2">{t.passwordLabel}</label>
                  <PasswordInput id="reg-password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.passwordPlaceholder}
                    autoComplete="new-password"
                    show={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                </div>
                <div>
                  <label htmlFor="reg-confirm" className="block text-xs text-gray-700 dark:text-gray-300 mb-2">{t.confirmPasswordLabel}</label>
                  <PasswordInput id="reg-confirm" value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t.confirmPasswordPlaceholder}
                    autoComplete="new-password"
                    show={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} />
                </div>
                {errorMsg && (
                  <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
                    {errorMsg}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2">
                  <button type="submit" disabled={loading}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:ring-2 focus:ring-cyan-400 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100 disabled:opacity-50 cursor-pointer">
                    {loading ? (language === 'ja' ? '作成中...' : 'Creating...') : t.registerButton}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={onGoLogin}
                    className="inline-flex items-center justify-center rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 hover:bg-black/5 focus:ring-2 focus:ring-cyan-400 dark:border-white/10 dark:text-white dark:hover:bg-white/10 cursor-pointer">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </main>
        <footer className="py-6 text-center text-xs text-gray-600 dark:text-gray-500">{t.footer}</footer>
      </div>
    </div>
  )
}
