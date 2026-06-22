# CanSat Ground Station Test

本プロジェクトは、WASA CanSat向けに開発された、WCPP（WASA Common Packet Protocol）を用いたテレメトリ受信・コマンド送信用の地上局システムです。

---

## 主な機能
- **WCPPバイナリ完全対応**: Node.jsの `Buffer` を用いたリトルエンディアン処理と、厳格なCCITT CRC-8計算によるパケットのデコード・エンコードを実装済み。
- **リアルタイム3D可視化**: BNO055（9軸センサ）のPitch/Roll/Yawデータを受け取り、`@react-three/fiber` を用いて機体の姿勢を3Dでリアルタイム描画。
- **GNSSモニタリング**: 緯度・経度・捕捉衛星数をダッシュボードに表示。
- **WASD 手動操縦コントロール**: ブラウザ上のUIから、W/A/S/Dキー操作感覚で「前進・後退・左右旋回・停止」のコマンドをUDP経由でCanSatへ送信可能。
- **ESP32 モック送信機**: 実際のESP32などのマイコンにそのまま書き込めるC++の通信シミュレーションコードを同梱（`cansat-esp32-mock`）。

---

## 技術スタック
- **Monorepo**: npm workspaces を使用し、フロントエンド・バックエンド・共有設定を1つのリポジトリで管理。
- **Frontend**: React 18, Vite 8, Tailwind CSS, Recharts (グラフ), `@react-three/fiber` & `@react-three/drei` (3D描画)
- **Backend**: Node.js, `ws` (WebSockets), `dgram` (UDP)
- **Language**: TypeScript

---

## 実行方法（ローカル環境）

### 1. 依存関係のインストール
プロジェクトのルートディレクトリで以下を実行し、すべてのワークスペースのパッケージをインストールします。
```bash
npm install
```

### 2. システムの起動
以下のコマンドで、バックエンド（UDP受信＆WebSocket配信）とフロントエンド（React/Vite）を同時に立ち上げます。
```bash
npm run dev
```
起動後、ブラウザで `http://localhost:5173` にアクセスしてください。

### 3. ダミー送信機（シミュレーター）の起動
CanSat実機の代わりに、ダミーのセンサーデータ（高度低下や機体の回転など）を送信するモックサーバーを起動できます。別のターミナルを開いて以下を実行してください。
```bash
npm run mock --workspace=backend
```
UI上の3Dモデルが動き出し、グラフがリアルタイムに更新されます。また、ダッシュボードの「W・A・S・D」ボタンを押すと、このモックサーバーがコマンドを受信したログがターミナルに出力されます。

---

## 実機（ESP32等）を使ったテスト
本番に近いテストを行うためのArduinoスケッチが `cansat-esp32-mock/` に用意されています。
1. `cansat-esp32-mock/main.ino` をArduino IDEやPlatformIOで開きます。
2. SSID、パスワード、およびPCのローカルIPアドレス（`gs_ip`）をネットワーク環境に合わせて変更します。
3. ESP32に書き込むと、Node.jsバックエンドに対してUDPパケットが送信され始めます。
