import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Sun, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const translations = {
  en: {
    locale: 'en-US',
    title: "Page Not Found",
    message: "Sorry, the page you are looking for does not exist or has been moved.",
    redirecting: "Redirecting to the main page",
    seconds: "seconds"
  },
  ja: {
    locale: 'ja-JP',
    title: "ページが見つかりません",
    message: "申し訳ありませんが、お探しのページは存在しないか、移動されました。",
    redirecting: "メインページにリダイレクトしています",
    seconds: "秒"
  }
};

function NotFound() {
  const  navigate = useNavigate()
  const [language, setLanguage] = useState(() => {
    const lang = navigator.language.split('-')[0];
    return lang === 'ja' ? 'ja' : 'en';
  });
  
  const [theme, setTheme] = useState(() => {
    const prefersDark = typeof window !== 'undefined'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  const [countdown, setCountdown] = useState(3);

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

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Navigate to main page
          navigate('/ciren');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

  // useEffect(() => {
  //   // Wait for 3 seconds before redirecting to the main page
  //   const timer = setTimeout(() => {
  //     navigate('/ciren');
  //   }, 3000);

  //   return () => clearTimeout(timer);
  // }, [navigate]);

  const ThemeSwitch = () => (
    <button
      type="button"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
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

      {/* Theme switcher in corner */}
      <div className="absolute top-5 right-5 z-20">
        <ThemeSwitch />
      </div>

      {/* Content */}
      <div className="relative z-10 flex h-full items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-black/10 bg-white/80 p-8 backdrop-blur-sm 
                          dark:border-white/10 dark:bg-slate-800/60 shadow-sm text-center">
            
            {/* Icon */}
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full 
                            bg-gradient-to-r from-orange-500 to-red-500">
              <AlertTriangle className="h-8 w-8 text-white" />
            </div>

            {/* 404 */}
            <h1 className="mb-2 text-5xl font-bold tracking-tight text-slate-900 dark:text-white">
              404
            </h1>

            {/* Title */}
            <h2 className="mb-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {t.title}
            </h2>

            {/* Message */}
            <p className="mb-6 text-sm leading-6 text-gray-700 dark:text-gray-300">
              {t.message}
            </p>

            {/* Countdown */}
            <div className="rounded-xl border border-black/10 bg-white/70 p-4 backdrop-blur-sm 
                            dark:border-white/10 dark:bg-slate-800/60">
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                {t.redirecting}
              </div>
              <div className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                {countdown}
                <span className="text-base ml-1 text-gray-600 dark:text-gray-400">
                  {t.seconds}
                </span>
              </div>
            </div>

            {/* Language toggle */}
            <div className="mt-6 flex justify-center gap-2">
              <button
                onClick={() => setLanguage('en')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  language === 'en'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-black/5 text-gray-600 hover:bg-black/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
                }`}
              >
                EN
              </button>
              <button
                onClick={() => setLanguage('ja')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  language === 'ja'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-black/5 text-gray-600 hover:bg-black/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
                }`}
              >
                日本語
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NotFound;

