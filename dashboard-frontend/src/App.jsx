import { useState, useEffect } from 'react';
import { Activity, Wifi, Shield, BarChart3, Zap, Globe, ArrowRight, User, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Translations for English and Japanese (formalized)
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
      register: 'Register',
      submitLogin: 'Login',
      goBack: 'Back'
    },
    features: {
      realtime: { title: 'Real-time Monitoring', description: 'Monitor IoT devices with per-second updates and reliable data flow.' },
      secure: { title: 'Secure Connection', description: 'End-to-end encrypted transmission ensures your data stays safe.' },
      analytics: { title: 'Advanced Analytics', description: 'Comprehensive visualization and data insights for smart decision-making.' }
    },
    loginForm: {
      title: 'Login',
      subtitle: 'Access your IoT monitoring dashboard securely.',
      label: 'Username or Raspi Serial ID',
      placeholder: 'Enter your username or serial ID...'
    },
    alerts: {
      missingInput: 'Please enter a username or Raspi serial ID.',
      notFound: 'No matching user information found.'
    },
    footer: '© 2024 CIREN - Connected IoT Real-time Environmental Network',
    languageSwitcher: 'Language'
  },
  ja: {
    locale: 'ja-JP',
    title: 'CIREN',
    subtitle: 'コネクテッドIoTリアルタイム環境ネットワーク',
    stats: {
      activeDevices: '稼働中のデバイス',
      dataPoints: 'データポイント',
      uptime: 'システム稼働率'
    },
    buttons: {
      login: 'ダッシュボードへログイン',
      register: '新規登録',
      submitLogin: 'ログイン',
      goBack: '戻る'
    },
    features: {
      realtime: { title: 'リアルタイム監視', description: 'IoTデバイスを毎秒更新のリアルタイムデータで監視します。' },
      secure: { title: '安全な通信', description: 'エンドツーエンド暗号化によりデータを安全に保護します。' },
      analytics: { title: '高度な分析', description: '包括的なデータ可視化で精密な分析と判断を支援します。' }
    },
    loginForm: {
      title: 'ログイン画面',
      subtitle: 'IoT監視ダッシュボードにアクセスするにはログインしてください。',
      label: 'ユーザー名またはRaspiシリアルID',
      placeholder: 'ユーザー名またはシリアルIDを入力してください'
    },
    alerts: {
      missingInput: 'ユーザー名またはRaspiシリアルIDを入力してください。',
      notFound: '該当するユーザー情報が見つかりません。'
    },
    footer: '© 2024 CIREN - コネクテッドIoTリアルタイム環境ネットワーク | 全著作権所有',
    languageSwitcher: '言語'
  }
};

function App() {
  const navigate = useNavigate();
  const [language, setLanguage] = useState('ja'); // default to Japanese
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [stats] = useState({
    activeDevices: 247,
    dataPoints: '2.4M',
    uptime: '99.8%'
  });

  const t = translations[language];

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogin = async () => {
    if (!userInput.trim()) {
      alert(t.alerts.missingInput);
      return;
    }
    // const res = await fetch(`http://localhost:3000/api/resolve/${userInput}`);
    // if (!res.ok) {
    //   alert(t.alerts.notFound);
    //   return;
    // }
    // const { username } = await res.json();
       const { username } = "raihan";
    navigate(`/ciren/${username}/dashboard`);
  };

  const features = [
    { icon: <Activity className="w-6 h-6" />, ...t.features.realtime },
    { icon: <Shield className="w-6 h-6" />, ...t.features.secure },
    { icon: <BarChart3 className="w-6 h-6" />, ...t.features.analytics }
  ];

  return (
    <div lang={t.locale} className="h-screen w-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 relative overflow-hidden fixed inset-0 font-['Noto Sans JP'] text-white">
      {/* Background softly blurred */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10"></div>
        <div className="absolute -bottom-40 -left-40 w-72 h-72 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10"></div>
      </div>

      <div className="relative z-10 h-full w-full overflow-y-auto">
        <div className="container mx-auto px-6 py-8 min-h-full flex flex-col">
          {/* Header */}
          <div className="text-center mb-10 flex-shrink-0">
            <div className="flex items-center justify-center mb-4">
              <div className="w-14 h-14 bg-gradient-to-r from-indigo-400 to-blue-500 rounded-full flex items-center justify-center shadow-xl">
                <Wifi className="w-7 h-7 text-white" />
              </div>
            </div>
            <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mb-2">
              {t.title}
            </h1>
            <p className="text-lg text-gray-300 mb-2">{t.subtitle}</p>
            <div className="text-sm text-gray-400 font-mono">{currentTime.toLocaleString(t.locale)}</div>
          </div>

          {/* Stats Section */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
            {[
              { icon: <Zap className="w-6 h-6 text-blue-400" />, value: stats.activeDevices, label: t.stats.activeDevices },
              { icon: <Globe className="w-6 h-6 text-indigo-400" />, value: stats.dataPoints, label: t.stats.dataPoints },
              { icon: <Shield className="w-6 h-6 text-cyan-400" />, value: stats.uptime, label: t.stats.uptime }
            ].map((item, i) => (
              <div key={i} className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/10 hover:border-white/30 transition-all duration-300 hover:bg-white/20">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
                    {item.icon}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">{item.value}</div>
                    <div className="text-sm text-gray-400">{item.label}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col justify-center">
            <div className="max-w-4xl mx-auto w-full">
              {!showLoginForm ? (
                <div className="text-center space-y-8">
                  {/* Buttons */}
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button
                      onClick={() => setShowLoginForm(true)}
                      className="w-full sm:w-auto bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white px-8 py-3 rounded-xl font-semibold shadow-md transition-transform transform hover:scale-105 flex items-center justify-center space-x-2"
                    >
                      <User className="w-5 h-5" />
                      <span>{t.buttons.login}</span>
                      <ArrowRight className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => navigate('/ciren/register')}
                      className="w-full sm:w-auto bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-xl font-semibold border border-white/20 transition-transform transform hover:scale-105 flex items-center justify-center space-x-2"
                    >
                      <UserPlus className="w-5 h-5" />
                      <span>{t.buttons.register}</span>
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Features */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-12">
                    {features.map((feature, index) => (
                      <div key={index} className="bg-white/5 backdrop-blur-lg rounded-xl p-6 border border-white/10 hover:border-white/30 transition-all hover:bg-white/10">
                        <div className="w-12 h-12 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-lg flex items-center justify-center mb-4">
                          {feature.icon}
                        </div>
                        <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                        <p className="text-gray-400 text-sm leading-relaxed">{feature.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-md mx-auto">
                  <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20 shadow-xl">
                    <div className="text-center mb-6">
                      <div className="w-16 h-16 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full flex items-center justify-center mx-auto mb-3">
                        <User className="w-8 h-8 text-white" />
                      </div>
                      <h2 className="text-2xl font-bold mb-1">{t.loginForm.title}</h2>
                      <p className="text-gray-400 text-sm">{t.loginForm.subtitle}</p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          {t.loginForm.label}
                        </label>
                        <input
                          type="text"
                          value={userInput}
                          onChange={(e) => setUserInput(e.target.value)}
                          placeholder={t.loginForm.placeholder}
                          className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 outline-none transition-all"
                          onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                        />
                      </div>
                      <div className="flex space-x-3 pt-4">
                        <button
                          onClick={handleLogin}
                          className="flex-1 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white py-3 rounded-lg font-semibold transition-transform transform hover:scale-105 flex items-center justify-center space-x-2"
                        >
                          <span>{t.buttons.submitLogin}</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setShowLoginForm(false);
                            setUserInput('');
                          }}
                          className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold border border-white/20 transition-all"
                        >
                          {t.buttons.goBack}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-10 text-gray-500 text-sm">
            <div className="mb-4">
              <span className="mr-3">{t.languageSwitcher}:</span>
              <button
                onClick={() => setLanguage('en')}
                className={`px-3 py-1 rounded-md text-xs transition-colors ${language === 'en' ? 'bg-blue-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
              >
                EN
              </button>
              <button
                onClick={() => setLanguage('ja')}
                className={`ml-2 px-3 py-1 rounded-md text-xs transition-colors ${language === 'ja' ? 'bg-blue-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
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
