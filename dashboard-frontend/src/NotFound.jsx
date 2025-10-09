import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

// Translations for the component
const translations = {
  en: {
    title: "Page Not Found",
    message: "Sorry, the page you are looking for does not exist or has been moved.",
    redirecting: "Redirecting to the main page"
  },
  ja: {
    title: "ページが見つかりません",
    message: "申し訳ありませんが、お探しのページは存在しないか、移動されました。",
    redirecting: "メインページにリダイレクトしています"
  }
};

function NotFound() {
  const navigate = useNavigate();

  // Detect browser language and select the appropriate text
  const t = useMemo(() => {
    const lang = navigator.language.split('-')[0];
    return lang === 'ja' ? translations.ja : translations.en;
  }, []);

  useEffect(() => {
    // Wait for 3 seconds before redirecting to the main page
    const timer = setTimeout(() => {
      navigate('/ciren');
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white flex items-center justify-center p-4">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse delay-1000"></div>
      </div>

      <div className="relative z-10 max-w-md w-full text-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl sm:rounded-3xl p-8 sm:p-12 border border-white/20 shadow-2xl">
          <div className="w-20 h-20 bg-gradient-to-r from-orange-500 to-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-3">404</h1>
          <h2 className="text-xl sm:text-2xl font-semibold text-white mb-4">{t.title}</h2>
          <p className="text-gray-300 text-sm sm:text-base mb-6">
            {t.message}
          </p>
          <div className="flex items-center justify-center space-x-2 text-gray-400">
            <span>{t.redirecting}</span>
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0s' }}></div>
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NotFound;