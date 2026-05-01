import { useEffect, useRef } from 'react'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

// ─── Stage management ────────────────────────────────────────────────────────
// null        → brand new user, login tour pending
// 'devices'   → login done, devices tour pending
// 'dashboard' → devices done, dashboard tour pending
// 'done'      → all tours complete

const STAGE_KEY = 'ciren-onboarding'
const NEXT_STAGE = { login: 'devices', devices: 'dashboard', dashboard: 'done' }

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

const loginSteps = {
  en: [
    {
      popover: {
        title: 'Welcome to CIREN',
        description:
          'CIREN is a real-time IoT sensor monitoring dashboard. This short guide will walk you through getting started.',
      },
    },
    {
      element: '[data-tour="login-btn"]',
      popover: {
        title: 'Log In',
        description:
          'Click <b>Login</b> to open the sign-in form. Use the username and password provided with your device.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-username"]',
      popover: {
        title: 'Username',
        description: 'Enter the username provided by your administrator.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-password"]',
      popover: {
        title: 'Password',
        description:
          'Enter your password. Click the eye icon on the right to show or hide it.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-submit"]',
      popover: {
        title: "You're ready!",
        description:
          'Enter your credentials above and click <b>Sign In</b> to start monitoring your sensors.',
        side: 'top',
      },
    },
  ],
  ja: [
    {
      popover: {
        title: 'CIRENへようこそ',
        description:
          'CIRENはIoTセンサーのデータをリアルタイムで監視するダッシュボードです。以下の手順に沿ってご利用を開始しましょう。',
      },
    },
    {
      element: '[data-tour="login-btn"]',
      popover: {
        title: 'ログイン',
        description:
          '<b>ログイン</b>ボタンをクリックすると入力フォームが表示されます。製品に同梱のユーザー名とパスワードをご使用ください。',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-username"]',
      popover: {
        title: 'ユーザー名',
        description: '管理者から提供されたユーザー名を入力してください。',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-password"]',
      popover: {
        title: 'パスワード',
        description:
          'パスワードを入力してください。右側のアイコンで表示／非表示を切り替えられます。',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="login-submit"]',
      popover: {
        title: 'ログインしましょう',
        description:
          'ユーザー名とパスワードを入力したら、<b>ログイン</b>ボタンを押してください。',
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

const ALL_STEPS = { login: loginSteps, devices: devicesSteps, dashboard: dashboardSteps }

// ─── Component ───────────────────────────────────────────────────────────────
// page: 'login' | 'devices' | 'dashboard'
// openLoginForm: () => void — called at login step 1 Next click to reveal the form
export default function OnboardingTour({ page, lang, active, onDone, openLoginForm }) {
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
      const config = {
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
      }

      // At login step index 1 (login button), clicking Next opens the form
      if (page === 'login' && openLoginForm) {
        config.onNextClick = (el, step, { state }) => {
          if (state.activeIndex === 1) {
            openLoginForm()
            setTimeout(() => driverRef.current?.moveNext(), 400)
          } else {
            driverRef.current?.moveNext()
          }
        }
      }

      driverRef.current = driver(config)
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
