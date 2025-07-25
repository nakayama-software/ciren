import { useState, useEffect } from 'react';
import { Activity, Wifi, Shield, BarChart3, Zap, Globe, ArrowRight, User, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Translations for English and Japanese
const translations = {
  en: {
    locale: 'en-US',
    title: 'CIREN',
    subtitle: 'Connected IoT Real-time Environmental Network',
    stats: {
      activeDevices: 'Active Devices',
      dataPoints: 'Data Points',
      uptime: 'System Uptime'
    },
    buttons: {
      login: 'Login to Dashboard',
      register: 'Register Now',
      submitLogin: 'Login',
      goBack: 'Back'
    },
    features: {
      realtime: { title: 'Real-time Monitoring', description: 'Monitor IoT devices in real-time with per-second data updates.' },
      secure: { title: 'Secure Connection', description: 'Secure connection with end-to-end encryption for all IoT data.' },
      analytics: { title: 'Advanced Analytics', description: 'In-depth analysis with comprehensive data visualizations.' }
    },
    loginForm: {
      title: 'Welcome Back',
      subtitle: 'Log in to your IoT monitoring dashboard.',
      label: 'Username or Raspi Serial ID',
      placeholder: 'Enter username or serial ID...'
    },
    alerts: {
      missingInput: 'Please enter a username or Raspi serial ID.',
      notFound: 'Username or Raspi ID not found.'
    },
    footer: '© 2024 CIREN - Connected IoT Real-time Environmental Network',
    languageSwitcher: 'Language'
  },
  ja: {
    locale: 'ja-JP',
    title: 'CIREN',
    subtitle: 'コネクテッドIoTリアルタイム環境ネットワーク',
    stats: {
      activeDevices: 'アクティブなデバイス',
      dataPoints: 'データポイント',
      uptime: 'システム稼働時間'
    },
    buttons: {
      login: 'ダッシュボードにログイン',
      register: '今すぐ登録',
      submitLogin: 'ログイン',
      goBack: '戻る'
    },
    features: {
      realtime: { title: 'リアルタイム監視', description: 'IoTデバイスをリアルタイムで監視し、毎秒データを更新します。' },
      secure: { title: 'セキュアな接続', description: '全てのIoTデータに対してエンドツーエンドの暗号化による安全な接続。' },
      analytics: { title: '高度な分析', description: '包括的なデータ可視化による詳細な分析。' }
    },
    loginForm: {
      title: 'おかえりなさい',
      subtitle: 'IoT監視ダッシュボードにログインします。',
      label: 'ユーザー名またはRaspiシリアルID',
      placeholder: 'ユーザー名またはシリアルIDを入力...'
    },
    alerts: {
      missingInput: 'ユーザー名またはRaspiシリアルIDを入力してください。',
      notFound: 'ユーザー名またはRaspi IDが見つかりません。'
    },
    footer: '© 2024 CIREN - コネクテッドIoTリアルタイム環境ネットワーク',
    languageSwitcher: '言語'
  }
};

function App() {
  const navigate = useNavigate();
  const [language, setLanguage] = useState('en');
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [stats] = useState({
    activeDevices: 247,
    dataPoints: '2.4M',
    uptime: '99.8%'
  });

  const t = translations[language]; // Get current language strings

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogin = async () => {
    if (!userInput.trim()) {
      alert(t.alerts.missingInput);
      return;
    }
    const res = await fetch(`http://localhost:3000/api/resolve/${userInput}`);
    if (!res.ok) {
      alert(t.alerts.notFound);
      return;
    }
    const { username } = await res.json();
    navigate(`/ciren/${username}/dashboard`);
  };
  
  const features = [
    { icon: <Activity className="w-6 h-6" />, ...t.features.realtime },
    { icon: <Shield className="w-6 h-6" />, ...t.features.secure },
    { icon: <BarChart3 className="w-6 h-6" />, ...t.features.analytics }
  ];

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden fixed inset-0">
      {/* Background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse delay-1000"></div>
      </div>
      
      <div className="relative z-10 h-full w-full overflow-y-auto">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8 min-h-full flex flex-col">
          {/* Header */}
          <div className="text-center mb-6 sm:mb-8 lg:mb-12 flex-shrink-0">
            <div className="flex items-center justify-center mb-4 sm:mb-6">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full flex items-center justify-center shadow-2xl">
                    <Wifi className="w-6 h-6 sm:w-8 sm:h-8 text-white animate-pulse" />
                </div>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 mb-2 sm:mb-4">
              {t.title}
            </h1>
            <p className="text-lg sm:text-xl text-gray-300 mb-1 sm:mb-2 px-4">
              {t.subtitle}
            </p>
            <div className="text-xs sm:text-sm text-gray-400 font-mono">
              {currentTime.toLocaleString(t.locale)}
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6 mb-6 sm:mb-8 lg:mb-12 px-2 sm:px-0">
            {/* Active Devices */}
            <div className="bg-white/10 backdrop-blur-lg rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-white/20 hover:bg-white/20 transition-all duration-300 hover:scale-105">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-500/20 rounded-lg sm:rounded-xl flex items-center justify-center"><Zap className="w-5 h-5 sm:w-6 sm:h-6 text-green-400" /></div>
                    <div className="text-right">
                        <div className="text-xl sm:text-2xl font-bold text-white">{stats.activeDevices}</div>
                        <div className="text-xs sm:text-sm text-gray-400">{t.stats.activeDevices}</div>
                    </div>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5 sm:h-2"><div className="bg-gradient-to-r from-green-400 to-cyan-400 h-1.5 sm:h-2 rounded-full w-4/5"></div></div>
            </div>
            {/* Data Points */}
            <div className="bg-white/10 backdrop-blur-lg rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-white/20 hover:bg-white/20 transition-all duration-300 hover:scale-105">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-500/20 rounded-lg sm:rounded-xl flex items-center justify-center"><Globe className="w-5 h-5 sm:w-6 sm:h-6 text-purple-400" /></div>
                    <div className="text-right">
                        <div className="text-xl sm:text-2xl font-bold text-white">{stats.dataPoints}</div>
                        <div className="text-xs sm:text-sm text-gray-400">{t.stats.dataPoints}</div>
                    </div>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5 sm:h-2"><div className="bg-gradient-to-r from-purple-400 to-pink-400 h-1.5 sm:h-2 rounded-full w-full"></div></div>
            </div>
            {/* System Uptime */}
            <div className="bg-white/10 backdrop-blur-lg rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-white/20 hover:bg-white/20 transition-all duration-300 hover:scale-105 sm:col-span-2 lg:col-span-1">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-cyan-500/20 rounded-lg sm:rounded-xl flex items-center justify-center"><Shield className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400" /></div>
                    <div className="text-right">
                        <div className="text-xl sm:text-2xl font-bold text-white">{stats.uptime}</div>
                        <div className="text-xs sm:text-sm text-gray-400">{t.stats.uptime}</div>
                    </div>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5 sm:h-2"><div className="bg-gradient-to-r from-cyan-400 to-blue-400 h-1.5 sm:h-2 rounded-full w-full"></div></div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col justify-center">
            <div className="max-w-4xl mx-auto w-full px-2 sm:px-4">
              {!showLoginForm ? (
                <div className="text-center space-y-6 sm:space-y-8">
                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center px-4 sm:px-0">
                    <button onClick={() => setShowLoginForm(true)} className="w-full sm:w-auto group bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-semibold shadow-2xl transform transition-all duration-300 hover:scale-105 flex items-center justify-center space-x-2">
                      <User className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span className="text-sm sm:text-base">{t.buttons.login}</span>
                      <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform" />
                    </button>
                    <button onClick={() => navigate('/ciren/register')} className="w-full sm:w-auto group bg-white/10 backdrop-blur-lg hover:bg-white/20 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-semibold border border-white/20 transform transition-all duration-300 hover:scale-105 flex items-center justify-center space-x-2">
                      <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span className="text-sm sm:text-base">{t.buttons.register}</span>
                      <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                  {/* Features Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mt-8 sm:mt-12 lg:mt-16 px-2 sm:px-0">
                    {features.map((feature, index) => (
                      <div key={index} className="bg-white/5 backdrop-blur-lg rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-white/10 hover:border-white/30 transition-all duration-300 hover:bg-white/10 group">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-lg sm:rounded-xl flex items-center justify-center mb-3 sm:mb-4 group-hover:scale-110 transition-transform">{feature.icon}</div>
                        <h3 className="text-base sm:text-lg font-semibold text-white mb-2">{feature.title}</h3>
                        <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">{feature.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-sm sm:max-w-md mx-auto px-4 sm:px-0">
                  <div className="bg-white/10 backdrop-blur-lg rounded-2xl sm:rounded-3xl p-6 sm:p-8 border border-white/20 shadow-2xl">
                    <div className="text-center mb-4 sm:mb-6">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4"><User className="w-6 h-6 sm:w-8 sm:h-8 text-white" /></div>
                      <h2 className="text-xl sm:text-2xl font-bold text-white mb-1 sm:mb-2">{t.loginForm.title}</h2>
                      <p className="text-gray-400 text-sm sm:text-base">{t.loginForm.subtitle}</p>
                    </div>
                    <div className="space-y-3 sm:space-y-4">
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-300 mb-2">{t.loginForm.label}</label>
                        <input type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder={t.loginForm.placeholder} className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-white/10 backdrop-blur-lg border border-white/20 rounded-lg sm:rounded-xl text-white placeholder-gray-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 focus:outline-none transition-all text-sm sm:text-base" onKeyPress={(e) => e.key === 'Enter' && handleLogin()} />
                      </div>
                      <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3 pt-2 sm:pt-4">
                        <button onClick={handleLogin} className="flex-1 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white py-2.5 sm:py-3 rounded-lg sm:rounded-xl font-semibold transform transition-all duration-300 hover:scale-105 flex items-center justify-center space-x-2 text-sm sm:text-base">
                          <span>{t.buttons.submitLogin}</span><ArrowRight className="w-4 h-4" />
                        </button>
                        <button onClick={() => { setShowLoginForm(false); setUserInput(''); }} className="sm:flex-shrink-0 px-4 sm:px-6 py-2.5 sm:py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg sm:rounded-xl font-semibold transition-all duration-300 border border-white/20 text-sm sm:text-base">
                          {t.buttons.goBack}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer & Language Switcher */}
          <div className="text-center mt-6 sm:mt-8 lg:mt-16 text-gray-500 text-xs sm:text-sm flex-shrink-0 px-4">
            <div className="mb-4">
                <span className="mr-4">{t.languageSwitcher}:</span>
                <button
                    onClick={() => setLanguage('en')}
                    className={`px-3 py-1 rounded-md text-xs transition-colors ${language === 'en' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                >
                    EN
                </button>
                <button
                    onClick={() => setLanguage('ja')}
                    className={`ml-2 px-3 py-1 rounded-md text-xs transition-colors ${language === 'ja' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                >
                    JP
                </button>
            </div>
            <p>{t.footer}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;