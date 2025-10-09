import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, ArrowRight, ChevronLeft, Globe } from 'lucide-react';

// Translations for the component
const translations = {
  en: {
    title: "Create New Account",
    subtitle: "Register your username and IoT device.",
    usernameLabel: "Username",
    usernamePlaceholder: "Enter your chosen username...",
    raspiIdLabel: "Raspi Serial ID",
    raspiIdPlaceholder: "Enter your device's serial ID...",
    registerButton: "Register & Login",
    backButton: "Back",
    footer: "© 2024 CIREN - Connected IoT Real-time Environmental Network",
    alerts: {
      fillAllFields: "Please fill in all fields.",
      success: "Registration successful!",
      failed: "Failed",
      genericError: "An error occurred",
      connectionError: "Could not connect to the server. Please try again later."
    }
  },
  ja: {
    title: "新規アカウント作成",
    subtitle: "ユーザー名とIoTデバイスを登録します。",
    usernameLabel: "ユーザー名",
    usernamePlaceholder: "ご希望のユーザー名を入力してください...",
    raspiIdLabel: "RaspiシリアルID",
    raspiIdPlaceholder: "デバイスのシリアルIDを入力してください...",
    registerButton: "登録してログイン",
    backButton: "戻る",
    footer: "© 2024 CIREN - コネクテッドIoTリアルタイム環境ネットワーク",
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
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [raspiID, setRaspiID] = useState('');
  const [language, setLanguage] = useState('en');

  // Memoize the translations object to prevent re-renders
  const t = useMemo(() => translations[language], [language]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!username.trim() || !raspiID.trim()) {
      alert(t.alerts.fillAllFields);
      return;
    }

    try {
      const res = await fetch('http://localhost:3000/api/register-alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, raspi_serial_id: raspiID })
      });

      if (res.ok) {
        alert(t.alerts.success);
        navigate(`/ciren/${username}/dashboard`);
      } else {
        const err = await res.json();
        alert(`${t.alerts.failed}: ${err.error || t.alerts.genericError}`);
      }
    } catch (error) {
      console.error("Registration failed:", error);
      alert(t.alerts.connectionError);
    }
  };

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse delay-1000"></div>
      </div>

      <div className="relative z-10 max-w-md w-full">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl sm:rounded-3xl p-6 sm:p-8 border border-white/20 shadow-2xl">
          <div className="text-center mb-6 sm:mb-8">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserPlus className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">{t.title}</h1>
            <p className="text-gray-300 text-sm sm:text-base">{t.subtitle}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="username">
                {t.usernameLabel}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t.usernamePlaceholder}
                required
                className="w-full px-4 py-3 bg-white/10 backdrop-blur-lg border border-white/20 rounded-xl text-white placeholder-gray-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="raspiID">
                {t.raspiIdLabel}
              </label>
              <input
                id="raspiID"
                type="text"
                value={raspiID}
                onChange={(e) => setRaspiID(e.target.value)}
                placeholder={t.raspiIdPlaceholder}
                required
                className="w-full px-4 py-3 bg-white/10 backdrop-blur-lg border border-white/20 rounded-xl text-white placeholder-gray-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 focus:outline-none transition-all"
              />
            </div>

            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 pt-4">
              <button
                type="submit"
                className="flex-1 group bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white py-3 rounded-xl font-semibold transform transition-all duration-300 hover:scale-105 hover:shadow-lg flex items-center justify-center space-x-2"
              >
                <span>{t.registerButton}</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              
              <button
                type="button"
                onClick={() => navigate('/ciren')}
                className="sm:flex-shrink-0 px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold transition-all duration-300 border border-white/20 flex items-center justify-center space-x-2"
              >
                <ChevronLeft className="w-5 h-5" />
                <span>{t.backButton}</span>
              </button>
            </div>
          </form>
        </div>
         <div className="text-center mt-6 text-gray-500 text-sm">
            <div className="mb-4 flex items-center justify-center space-x-4">
                <Globe className="w-5 h-5 text-gray-400" />
                <button onClick={() => setLanguage('en')} className={`px-3 py-1 text-xs rounded-md transition-colors ${language === 'en' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>EN</button>
                <button onClick={() => setLanguage('ja')} className={`px-3 py-1 text-xs rounded-md transition-colors ${language === 'ja' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>JP</button>
            </div>
            <p>{t.footer}</p>
        </div>
      </div>
    </div>
  );
}

export default Register;
