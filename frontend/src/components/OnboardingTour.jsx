import { useEffect, useRef } from 'react'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

const TOUR_KEY = 'ciren-tour-done'

export function isTourDone() {
  return localStorage.getItem(TOUR_KEY) === 'true'
}

export function resetTour() {
  localStorage.removeItem(TOUR_KEY)
}

const steps = {
  en: [
    {
      element: '[data-tour="controller-cards"]',
      popover: {
        title: 'Sensor Controllers',
        description:
          'Each card is a sensor hub that can connect up to 8 sensors. Click <b>View Details</b> to see live readings from each sensor.',
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

export default function OnboardingTour({ active, lang, onDone }) {
  const driverRef = useRef(null)

  useEffect(() => {
    if (!active) return

    const tourSteps = steps[lang] || steps.en
    const isJa = lang === 'ja'

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
      onDestroyStarted: () => {
        localStorage.setItem(TOUR_KEY, 'true')
        driverRef.current?.destroy()
        onDone?.()
      },
    })

    driverRef.current.drive()

    return () => {
      driverRef.current?.destroy()
    }
  }, [active])

  return null
}
