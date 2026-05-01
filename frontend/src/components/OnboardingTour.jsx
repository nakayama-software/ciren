import { useEffect, useRef } from 'react'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

// ─── Stage management ────────────────────────────────────────────────────────
// null           → brand new user, login-landing tour pending
// 'register'     → landing done, register form tour pending
// 'login-form'   → register done, login form tour pending
// 'devices'      → login done, devices tour pending
// 'dashboard'    → devices done, dashboard tour pending
// 'done'         → all tours complete

const STAGE_KEY = 'ciren-onboarding'
const NEXT_STAGE = {
  'login-landing': 'register',
  'register':      'login-form',
  'login-form':    'devices',
  'devices':       'dashboard',
  'dashboard':     'done',
}

export const getStage = () => {
  const s = localStorage.getItem(STAGE_KEY)
  // migrate from old key
  if (!s && localStorage.getItem('ciren-tour-done') === 'true') return 'done'
  return s
}
export const setStage  = (s) => localStorage.setItem(STAGE_KEY, s)
export const resetAll  = () => localStorage.removeItem(STAGE_KEY)
export const isTourDone = () => getStage() === 'done'
export const resetTour  = resetAll  // backward compat

// ─── Step definitions ────────────────────────────────────────────────────────

// Login landing page — highlight the Register button
const loginLandingSteps = {
  en: [
    {
      popover: {
        title: 'Welcome to CIREN',
        description:
          'CIREN is a real-time IoT sensor monitoring dashboard. Let\'s get you set up in a few steps.',
      },
    },
    {
      element: '[data-tour="register-btn"]',
      popover: {
        title: 'Create Your Account',
        description:
          'Since this is your first time, click <b>Create account</b> to register. You will need a username and password.',
        side: 'bottom',
      },
    },
  ],
  ja: [
    {
      popover: {
        title: 'CIRENへようこそ',
        description:
          'CIRENはIoTセンサーのデータをリアルタイムで監視するダッシュボードです。以下の手順に沿って初期設定を進めましょう。',
      },
    },
    {
      element: '[data-tour="register-btn"]',
      popover: {
        title: 'アカウントを作成する',
        description:
          '初めてご利用の方は、<b>新規登録</b>ボタンをクリックしてアカウントを作成してください。ユーザー名とパスワードを設定します。',
        side: 'bottom',
      },
    },
  ],
}

// Register form tour
const registerSteps = {
  en: [
    {
      popover: {
        title: 'Create Your Account',
        description: 'Fill in the form below to create your CIREN account.',
      },
    },
    {
      element: '[data-tour="reg-username"]',
      popover: {
        title: 'Username',
        description: 'Choose a username for your account. You will use this to log in.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="reg-password"]',
      popover: {
        title: 'Password',
        description: 'Choose a secure password (minimum 6 characters).',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="reg-confirm"]',
      popover: {
        title: 'Confirm Password',
        description: 'Re-enter your password to confirm it matches.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="reg-submit"]',
      popover: {
        title: 'Create Account',
        description:
          'Click <b>Create Account</b> to finish registration. You will then be redirected to sign in.',
        side: 'top',
      },
    },
  ],
  ja: [
    {
      popover: {
        title: 'アカウント作成',
        description: '以下のフォームに入力してCIRENアカウントを作成します。',
      },
    },
    {
      element: '[data-tour="reg-username"]',
      popover: {
        title: 'ユーザー名',
        description: 'ログイン時に使用するユーザー名を入力してください。',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="reg-password"]',
      popover: {
        title: 'パスワード',
        description: '6文字以上のパスワードを設定してください。',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="reg-confirm"]',
      popover: {
        title: 'パスワード（確認）',
        description: 'パスワードを再入力して確認します。',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="reg-submit"]',
      popover: {
        title: 'アカウントを作成する',
        description:
          '<b>アカウント作成</b>ボタンをクリックして登録を完了します。その後、ログイン画面に移動します。',
        side: 'top',
      },
    },
  ],
}

// Login form tour — shown after registration
const loginFormSteps = {
  en: [
    {
      popover: {
        title: 'Account Created!',
        description:
          'Your account is ready. Now sign in with the username and password you just created.',
      },
    },
    {
      element: '[data-tour="login-username"]',
      popover: {
        title: 'Username',
        description: 'Enter the username you just registered.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-password"]',
      popover: {
        title: 'Password',
        description: 'Enter your password. Click the eye icon to show or hide it.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-submit"]',
      popover: {
        title: "Let's Go!",
        description: 'Click <b>Sign In</b> to access your dashboard.',
        side: 'top',
      },
    },
  ],
  ja: [
    {
      popover: {
        title: 'アカウント作成完了！',
        description:
          'アカウントが作成されました。登録したユーザー名とパスワードでログインしてください。',
      },
    },
    {
      element: '[data-tour="login-username"]',
      popover: {
        title: 'ユーザー名',
        description: '先ほど登録したユーザー名を入力してください。',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-password"]',
      popover: {
        title: 'パスワード',
        description: 'パスワードを入力してください。右のアイコンで表示切り替えができます。',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-submit"]',
      popover: {
        title: 'ログインしましょう',
        description: '<b>ログイン</b>ボタンをクリックしてダッシュボードへ進みます。',
        side: 'top',
      },
    },
  ],
}

const devicesSteps = {
  en: [
    {
      popover: {
        title: 'Device Management',
        description:
          'This page lists all your registered IoT devices. You can add or remove devices here.',
      },
    },
    {
      element: '[data-tour="devices-add"]',
      popover: {
        title: 'Add Your Device',
        description:
          'Enter the Device ID printed on the label of your CIREN main module, then click <b>Add Device</b>.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="devices-list"]',
      popover: {
        title: 'Open the Dashboard',
        description:
          'Once your device appears here, click the <b>→</b> button to open the live sensor monitoring dashboard.',
        side: 'top',
      },
    },
  ],
  ja: [
    {
      popover: {
        title: 'デバイス管理',
        description:
          'こちらは登録済みIoTデバイスの管理画面です。デバイスの追加・削除ができます。',
      },
    },
    {
      element: '[data-tour="devices-add"]',
      popover: {
        title: 'デバイスを追加する',
        description:
          'CIRENメインモジュールのラベルに記載されているデバイスIDを入力し、<b>デバイスを追加</b>をクリックしてください。',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="devices-list"]',
      popover: {
        title: 'ダッシュボードを開く',
        description:
          'デバイスが一覧に表示されたら、<b>→</b>ボタンをクリックするとリアルタイムの監視ダッシュボードが開きます。',
        side: 'top',
      },
    },
  ],
}

const dashboardSteps = {
  en: [
    {
      element: '[data-tour="controller-cards"]',
      popover: {
        title: 'Sensor Controllers',
        description:
          'Each card is a sensor hub that can connect up to 8 sensors. Click <b>View Details</b> to see live readings.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="main-module-status"]',
      popover: {
        title: 'Main Module Status',
        description:
          "Shows your device's connection type (WiFi or mobile network), signal strength, and firmware version.",
        side: 'left',
        align: 'start',
      },
    },
    {
      element: '[data-tour="header-ws"]',
      popover: {
        title: 'Live Connection',
        description:
          'Green = receiving real-time data. If it turns red, the connection is lost — it will reconnect automatically.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="header-theme"]',
      popover: {
        title: 'Theme',
        description: 'Toggle between dark and light mode.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="header-lang"]',
      popover: {
        title: 'Language',
        description: 'Switch the interface between Japanese (JP) and English (EN).',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="header-devices"]',
      popover: {
        title: 'Device Management',
        description: 'Manage your registered devices or switch to a different one.',
        side: 'bottom',
        align: 'end',
      },
    },
  ],
  ja: [
    {
      element: '[data-tour="controller-cards"]',
      popover: {
        title: 'センサーコントローラー',
        description:
          '各カードは最大8つのセンサーを接続できるセンサーハブです。<b>詳細を表示</b>をクリックすると各センサーのライブ値を確認できます。',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="main-module-status"]',
      popover: {
        title: 'メインモジュールの状態',
        description:
          'デバイスの接続方式（WiFiまたはモバイルネットワーク）・信号強度・ファームウェアバージョンを表示します。',
        side: 'left',
        align: 'start',
      },
    },
    {
      element: '[data-tour="header-ws"]',
      popover: {
        title: 'ライブ接続',
        description:
          '緑＝リアルタイムでデータ受信中。赤になった場合は接続が切れており、自動で再接続します。',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="header-theme"]',
      popover: {
        title: 'テーマ',
        description: 'ダーク・ライトモードを切り替えます。',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="header-lang"]',
      popover: {
        title: '言語',
        description: '日本語（JP）と英語（EN）を切り替えます。',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="header-devices"]',
      popover: {
        title: 'デバイス管理',
        description: '登録済みデバイスの管理・切り替えができます。',
        side: 'bottom',
        align: 'end',
      },
    },
  ],
}

const ALL_STEPS = {
  'login-landing': loginLandingSteps,
  'register':      registerSteps,
  'login-form':    loginFormSteps,
  'devices':       devicesSteps,
  'dashboard':     dashboardSteps,
}

// ─── Component ───────────────────────────────────────────────────────────────
// page: 'login-landing' | 'register' | 'login-form' | 'devices' | 'dashboard'
export default function OnboardingTour({ page, lang, active, onDone }) {
  const driverRef = useRef(null)

  useEffect(() => {
    if (!active) return

    const stepsMap = ALL_STEPS[page] || ALL_STEPS.dashboard
    const tourSteps = stepsMap[lang] || stepsMap.ja
    const isJa = lang === 'ja'

    const finish = () => {
      setStage(NEXT_STAGE[page] || 'done')
      driverRef.current?.destroy()
      onDone?.()
    }

    try {
      driverRef.current = driver({
        showProgress: true,
        animate: true,
        smoothScroll: true,
        allowClose: true,
        stagePadding: 10,
        stageRadius: 12,
        nextBtnText: isJa ? '次へ →' : 'Next →',
        prevBtnText: isJa ? '← 戻る' : '← Back',
        doneBtnText: isJa ? '完了' : 'Done',
        steps: tourSteps,
        onDestroyStarted: finish,
      })
      driverRef.current.drive()
    } catch (err) {
      console.error('[OnboardingTour] failed to start:', err)
      setStage(NEXT_STAGE[page] || 'done')
      onDone?.()
    }

    return () => { driverRef.current?.destroy() }
  }, [active])

  return null
}
