import { useState, useMemo, useEffect } from 'react';
import { UserPlus, ArrowRight, ArrowLeft, Globe, Sun, Moon } from 'lucide-react';

const translations = {
  en: {
    locale: 'en-US',
    title: "Create New Account",
    subtitle: "Register your username and IoT device.",
    usernameLabel: "Username",
    usernamePlaceholder: "Enter your chosen username...",
    raspiIdLabel: "Raspi Serial ID",
    raspiIdPlaceholder: "Enter your device's serial ID...",
    registerButton: "Register & Login",
    backButton: "Back",
    footer: "© 2025 CIREN",
    alerts: {
      fillAllFields: "Please fill in all fields.",
      success: "Registration successful!",
      failed: "Failed",
      genericError: "An error occurred",
      connectionError: "Could not connect to the server. Please try again later."
    }
  },
  ja: {
    locale: 'ja-JP',
    title: "新規アカウント作成",
    subtitle: "ユーザー名とIoTデバイスを登録します。",
    usernameLabel: "ユーザー名",
    usernamePlaceholder: "ご希望のユーザー名を入力してください...",
    raspiIdLabel: "RaspiシリアルID",
    raspiIdPlaceholder: "デバイスのシリアルIDを入力してください...",
    registerButton: "登録してログイン",
    backButton: "戻る",
    footer: "© 2025 CIREN",
    alerts: {
      fillAllFields: "すべてのフィールドに入力してください。",
      success: "登録に成功しました！",
      failed: "失敗",
      genericError: "エラーが発生しました",
      connectionError: "サーバーに接続できませんでした。後でもう一度お試しください。"
    }
  }
};

function Register() {
  const [username, setUsername] = useState('');
  const [raspiID, setRaspiID] = useState('');
  const [language, setLanguage] = useState('ja');
  const [errorMsg, setErrorMsg] = useState(null);
  
  const [theme, setTheme] = useState(() => {
    const prefersDark = typeof window !== 'undefined'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  const t = useMemo(() => translations[language], [language]);

  useEffect(() => {
    const html = document.querySelector('html');
    if (!html) return;
    if (theme === 'dark') {
      html.classList.add('dark');
      html.style.colorScheme = 'dark';
    } else {
      html.classList.remove('dark');
      html.style.colorScheme = 'light';
    }
  }, [theme]);

  const handleSubmit = async () => {
    setErrorMsg(null);

    if (!username.trim() || !raspiID.trim()) {
      setErrorMsg(t.alerts.fillAllFields);
      return;
    }

    try {
      const res = await fetch('/api/register-alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, raspi_serial_id: raspiID })
      });

      if (res.ok) {
        window.location.href = `/ciren/${username}/dashboard`;
      } else {
        const err = await res.json();
        setErrorMsg(`${t.alerts.failed}: ${err.error || t.alerts.genericError}`);
      }
    } catch (error) {
      console.error("Registration failed:", error);
      setErrorMsg(t.alerts.connectionError);
    }
  };

  const LangSwitch = () => (
    <div className="flex items-center gap-2">
      <Globe className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      <div className="inline-flex rounded-md bg-black/5 p-1 border border-black/10 dark:border-white/10 dark:bg-white/10">
        <button
          type="button"
          onClick={() => setLanguage('ja')}
          className={`px-3 py-1 text-xs rounded ${language === 'ja'
            ? (theme === 'dark' ? 'bg-white text-slate-900' : 'bg-slate-900 text-white')
            : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'}`}
        >
          日本語
        </button>
        <button
          type="button"
          onClick={() => setLanguage('en')}
          className={`px-3 py-1 text-xs rounded ${language === 'en'
            ? (theme === 'dark' ? 'bg-white text-slate-900' : 'bg-slate-900 text-white')
            : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'}`}
        >
          EN
        </button>
      </div>
    </div>
  );

  const ThemeSwitch = () => (
    <button
      type="button"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      <span>{theme === 'dark' ? (language === 'ja' ? 'ライト' : 'Light') : (language === 'ja' ? 'ダーク' : 'Dark')}</span>
    </button>
  );

  return (
    <div
      lang={t.locale}
      className="fixed inset-0 min-h-screen overflow-hidden font-['Noto_Sans_JP','Hiragino Kaku Gothic ProN','Yu Gothic UI',system-ui,sans-serif]
                 selection:bg-cyan-300/30 selection:text-white
                 bg-slate-50 text-slate-900 dark:text-white
                 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950
                 transition-colors duration-500"
    >
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col px-5">
        {/* Header */}
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
            <ThemeSwitch />
            <LangSwitch />
          </div>
        </header>

        {/* Main */}
        <main className="flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-black/10 bg-white/80 p-6 backdrop-blur-sm 
                            dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
              
              {/* Icon & Title */}
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full 
                                bg-gradient-to-r from-cyan-500 to-indigo-500">
                  <UserPlus className="h-6 w-6 text-white" />
                </div>
                <h2 className="text-lg font-medium tracking-tight text-slate-900 dark:text-white">
                  {t.title}
                </h2>
                <p className="mt-1 text-xs text-gray-700 dark:text-gray-400">
                  {t.subtitle}
                </p>
              </div>

              {/* Form Fields */}
              <div className="space-y-4">
                <div>
                  <label 
                    htmlFor="username" 
                    className="block text-xs text-gray-700 dark:text-gray-300 mb-2"
                  >
                    {t.usernameLabel}
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t.usernamePlaceholder}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-slate-900 
                               placeholder-gray-500 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-400/30
                               dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder-gray-400"
                  />
                </div>

                <div>
                  <label 
                    htmlFor="raspiID" 
                    className="block text-xs text-gray-700 dark:text-gray-300 mb-2"
                  >
                    {t.raspiIdLabel}
                  </label>
                  <input
                    id="raspiID"
                    type="text"
                    value={raspiID}
                    onChange={(e) => setRaspiID(e.target.value)}
                    placeholder={t.raspiIdPlaceholder}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-slate-900 
                               placeholder-gray-500 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-400/30
                               dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder-gray-400"
                  />
                </div>

                {errorMsg && (
                  <div
                    role="alert"
                    className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200"
                  >
                    {errorMsg}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:ring-2 focus:ring-cyan-400 dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100"
                  >
                    {t.registerButton}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => window.location.href = '/ciren'}
                    className="inline-flex items-center justify-center rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 hover:bg-black/5 focus:ring-2 focus:ring-cyan-400 dark:border-white/10 dark:text-white dark:hover:bg-white/10"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="py-6 text-center text-xs text-gray-600 dark:text-gray-500">
          {t.footer}
        </footer>
      </div>
    </div>
  );
}

export default Register;