# CIREN - Realtime IoT Monitoring System (Plug-and-Play & Customizable)

## English 🇬🇧

CIREN is a **real-time IoT monitoring system** designed with a **plug-and-play** and **customizable** architecture. This system is ideal for flexible sensor configurations and rapid deployment in various monitoring applications.

### 🔧 System Architecture

1. **Main Module**
   - Components: Raspberry Pi, GPS, ESP Receiver
   - Function: Collects data from Sensor Controllers and sends it to the server

2. **Sensor Controller**
   - Components: ESP32, 1–10 Sensor Nodes
   - Function: Receives data from multiple Sensor Nodes and transmits it to the Main Module

3. **Sensor Node**
   - Components: Seeeduino Xiao, 1 Sensor
   - Function: Monitors sensor data and sends it to the Sensor Controller  
   - Supports various sensor types based on application requirements

### 🌟 Features

- Plug-and-play integration
- Modular and scalable architecture
- Supports multiple types of sensors
- Real-time data communication via ESP and Raspberry Pi

### 📂 Repository

View full source code and documentation here:  
🔗 [https://github.com/nakayama-software/ciren](https://github.com/nakayama-software/ciren)

---

## 日本語 🇯🇵

CIRENは、**プラグアンドプレイ**かつ**カスタマイズ可能**な設計に基づいた**リアルタイムIoTモニタリングシステム**です。柔軟なセンサー構成と迅速な導入が可能で、さまざまなモニタリング用途に対応できます。

### 🔧 システム構成

1. **メインモジュール**
   - 構成: Raspberry Pi、GPS、ESP受信機  
   - 役割: センサーコントローラーからデータを収集し、サーバーへ送信

2. **センサーコントローラー**
   - 構成: ESP32、1〜10個のセンサーノード  
   - 役割: 各センサーノードからデータを受け取り、メインモジュールに送信

3. **センサーノード**
   - 構成: Seeeduino Xiao、1つのセンサー  
   - 役割: センサーによるデータ監視とセンサーコントローラーへの送信  
   - 使用センサーは用途に応じて柔軟に選択可能

### 🌟 特徴

- プラグアンドプレイ対応
- モジュール式で拡張性あり
- 多様なセンサーに対応
- ESPとRaspberry Piによるリアルタイム通信

### 📂 リポジトリ

ソースコードと詳細ドキュメントはこちら:  
🔗 [https://github.com/nakayama-software/ciren](https://github.com/nakayama-software/ciren)
