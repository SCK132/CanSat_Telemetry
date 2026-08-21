# CanSat Ground Station

本プロジェクトは、WASA CanSat向けに開発された、WCPP（WASA Common Packet Protocol）を用いたテレメトリ受信・コマンド送信用の地上局システムです。

従来のWi-Fi経由のUDP通信から、長距離伝送に適した **ESP-NOW** および **USBシリアル通信** を用いた通信構成に移行されています。

---

## システム構成

```mermaid
graph LR
    SubGraph1[CanSat子機 (Transmitter)] -->|ESP-NOW (Broadcast)| SubGraph2[地上局親機 (Receiver)]
    SubGraph2 -->|USBシリアル (115200 bps)| SubGraph3[PC バックエンド (Node.js)]
    SubGraph3 -->|WebSocket (ws://localhost:8080)| SubGraph4[フロントエンド (React)]
```

---

## 主な機能
- **WCPPバイナリ完全対応**: Node.jsの `Buffer` を用いたリトルエンディアン処理と、厳格なCCITT CRC-8計算によるパケットのデコード・エンコードを実装済み。
- **ESP-NOW & シリアル連携**: CanSat（子機）と地上局（親機）は長距離無線通信「ESP-NOW」で通信し、親機とPC間はUSBシリアルケーブルを通じて通信を行います。
- **シリアル自動認識 & 自動復旧**: バックエンドが接続中のUSBシリアルポート（COMやUSB等）を自動検出し、通信が途切れた際も自動で再接続を試みます。
- **リアルタイム3D可視化**: CanSatのPitch/Roll/Yawを反映し、状態0〜2ではRegulusロケット、状態3以降ではCanSatモデルを表示します。状態5以降は車輪展開状態へ切り替わります。
- **GNSSモニタリング**: 緯度・経度・捕捉衛星数をダッシュボードに表示。
- **ミッションコマンド**: 状態0で開発／ミッションモードを選択し、ミッションモードの状態1からLAUNCHコマンドを送信できます。モーター操作は仕様確定まで無効です。

---

## 技術スタック
- **Monorepo**: npm workspaces を使用し、フロントエンド・バックエンド・共有設定を1つのリポジトリで管理。
- **Frontend**: React 18, Vite 8, Tailwind CSS, Recharts (グラフ), `@react-three/fiber` & `@react-three/drei` (3D描画)
- **Backend**: Node.js, `ws` (WebSockets), `serialport` (USB Serial)
- **Language**: TypeScript

---

## 実行方法（ローカル環境）

### 1. 依存関係のインストール
プロジェクトのルートディレクトリで以下を実行し、すべてのワークスペースのパッケージをインストールします。
```bash
npm install
```

### 2. 親機（Receiver）の接続
地上局用の親機ESP32（`cansat-esp32-mock/receiver/`を書き込み済み）をUSBケーブルでPCに接続します。

### 3. システムの起動
以下のコマンドで、バックエンド（シリアル受信＆WebSocket配信）とフロントエンド（React/Vite）を同時に立ち上げます。
```bash
npm run dev
```
起動後、自動でUSBシリアルポートが検出され、接続されます。
ブラウザで `http://localhost:5173` にアクセスしてダッシュボードを開いてください。

---

## 実機（ESP32等）を使ったセットアップ

本構成では2台のESP32モジュールを使用します。

### 1. 子機（CanSat搭載用：Transmitter）
* **ソースコード**: [cansat-esp32-mock/transmitter/transmitter.ino](file:///c:/Users/chrik/WASA/cansat-ground-station/cansat-esp32-mock/transmitter/transmitter.ino)
* **接続センサー**: `BNO055`
* **配線**:
  * SCL -> **GPIO 22**
  * SDA -> **GPIO 21**
  * VIN -> **3.3V**
  * GND -> **GND**
* **依存ライブラリ**: Arduino IDE等で以下をインストールしてください。
  * `Adafruit BNO055`
  * `Adafruit Unified Sensor`
* **コンパイル**: `transmitter.ino` と同じフォルダに、`WCPP/cpp/` 以下のすべてのファイル（`packet.h`, `Packet.cpp`, `float16.h`, `float16.cpp`, `cppcrc.h`）をコピーしてコンパイルします。

### 2. 親機（地上局PC接続用：Receiver）
* **ソースコード**: [cansat-esp32-mock/receiver/receiver.ino](file:///c:/Users/chrik/WASA/cansat-ground-station/cansat-esp32-mock/receiver/receiver.ino)
* **配線**: PCにUSBケーブルで直接接続するだけです。
* **コンパイル**: 通常通り書き込みを行ってください。

## Flight log storage and download

The backend creates two fixed-column CSV files for every startup under `backend/logs`:

- `telemetry_<timestamp>.csv`: all parsed telemetry fields, including minimal-packet-safe empty columns
- `events_<timestamp>.csv`: ground-station startup, serial/WebSocket link changes, receiver reset reason, mission state transitions, commands, and errors

The Flight Control header provides **Telemetry CSV** and **Event CSV** links. The backend serves `GET /api/logs`, `GET /api/logs/latest?type=telemetry|events`, and `GET /api/logs/<filename>` on port 8080. Download paths accept only generated log filenames.
## Manual phase recovery

Mission Control exposes guarded recovery controls only in valid states. `Confirm deployed / State 3` is available in Mission Mode at State 2. `Confirm landed / State 4` is available in Mission Mode at State 2/3 and in Development Mode at State 0 for ground testing. A visual/safety checkbox is required before transmission because State 4 starts the 10 second motor separation sequence immediately.