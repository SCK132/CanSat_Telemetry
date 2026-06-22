# CanSat Ground Station 詳細仕様書

本ドキュメントは、WASA CanSatプロジェクトにおける地上局（Ground Station）のシステムアーキテクチャ詳細、ファイル構成の役割、および今後の改善事項をまとめた最新版の仕様書です。

---

## 1. システムアーキテクチャ詳細

本システムは、npm workspacesを利用したモノレポ構成を採用し、フロントエンド・バックエンドの境界を明確に分離しつつ、型や定数を共有する堅牢なアーキテクチャとなっています。

### 1.1 ディレクトリ構成と役割

```text
cansat-ground-station/
├── shared/                 # 共通モジュール（Frontend/Backend両方から参照）
│   ├── types/
│   │   └── telemetry.ts    # テレメトリの型定義（高度・気圧・GNSS・IMUなど）
│   └── constants/
│       └── wcpp_codes.ts   # WCPPの識別子やデータ型、機体のステート、アクション(WASD)定数
│
├── backend/                # サーバーサイド（Node.js / UDP / WebSocket）
│   ├── src/
│   │   ├── server.ts           # サーバーの起点。UDPでCanSatからのデータを受け取り、WSでフロントへ流す
│   │   ├── logger.ts           # 受信したテレメトリを非同期でCSVファイル等に保存するロガー
│   │   ├── wcpp_utils.ts       # CRC-8（CCITT規格）の計算や、ビットシフトを用いたエンコード・デコード処理群
│   │   ├── wcpp_parser.ts      # [コアロジック] 受信したWCPPバイナリをパースし、JSON(TelemetryData)に変換する
│   │   ├── wcpp_builder.ts     # [コアロジック] フロントからのコマンドをWCPPバイナリにエンコードする
│   │   └── dummy_transmitter.ts# テスト用。仮想のCanSatとして振る舞い、サイン波のIMUデータやダミーの高度を送る
│
├── frontend/               # クライアントサイド（React 18 / Vite 8 / Three.js）
│   ├── src/
│   │   ├── components/
│   │   │   └── CanSat3D.tsx    # @react-three/fiber を用いた3D機体モデル。Pitch/Roll/Yawを受け取り機体を回転させる
│   │   ├── hooks/
│   │   │   └── useTelemetry.ts # WebSocketでバックエンドと通信し、最新のテレメトリ配列を管理するカスタムフック
│   │   ├── App.tsx             # メインUI。ダッシュボードのレイアウト、グラフ描画、WASDコントロールUIを統括
│   │   └── index.css           # Tailwind CSSのエントリーポイントと、グラスモーフィズムなどのカスタムCSS定義
│
└── cansat-esp32-mock/      # 実機テスト用ファームウェア
    └── main.ino            # ESP32用のC++コード。公式WCPP C++ライブラリを使用し、UDP通信を行う実証コード
```

### 1.2 データフローの仕組み
1. **受信フロー**:
   - CanSat (ESP32) -> [UDP] -> `server.ts` -> `wcpp_parser.ts` でバイナリ解読 -> JSON化 -> [WebSocket] -> `useTelemetry.ts` -> React State更新 -> UIおよび3Dモデル (`CanSat3D.tsx`) の再描画
2. **送信フロー (アップリンク)**:
   - ユーザーがUIのWASDボタンをクリック -> `useTelemetry.ts` から WebSocket送信 -> `server.ts` -> `wcpp_builder.ts` でバイナリ化 -> [UDP] -> CanSat (ESP32)

---

## 2. センサーとWCPPエントリーの対応表 (Telemetry)

| センサー種類 | WCPP 2文字コード | 型 | 説明 |
| --- | --- | --- | --- |
| システム | `TI` | float64 | 起動からの経過時間 |
| 気圧・高度計 | `AL` | float32 | 高度 (m) |
| 気圧・高度計 | `PR` | float32 | 気圧 (hPa) |
| 気圧・高度計 | `TE` | float32 | 温度 (°C) |
| 状態管理 | `ST` | int | フライトステート (0:待機, 1:降下, 2:パラシュート, 3:着地) |
| GNSS | `LA` | float64 | 緯度 (Latitude) |
| GNSS | `LO` | float64 | 経度 (Longitude) |
| GNSS | `SA` | int | 捕捉衛星数 |
| BNO055 (IMU) | `OX` | float32 | 姿勢 X軸 (Pitch) |
| BNO055 (IMU) | `OY` | float32 | 姿勢 Y軸 (Roll) |
| BNO055 (IMU) | `OZ` | float32 | 姿勢 Z軸 (Yaw) |

---

## 3. 今後改善すべき事項・追加機能の提案

本システムは動作するプロトタイプとして非常に堅牢に設計されていますが、実際の運用（フィールドテスト等）に向けて以下の拡張が推奨されます。

### 3.1 UI・フロントエンドの改善
- **GNSSデータの実地図マッピング**: 
  現在緯度・経度は数値としてのみ表示されていますが、`react-leaflet` や `Mapbox GL JS` などの地図ライブラリを導入し、CanSatの現在地や移動軌跡をマップ上にプロットする機能を追加すると視覚的に非常に強力になります。
- **カメラ映像のリアルタイムストリーミング表示**: 
  CanSatにカメラモジュール（ESP32-CAM等）を搭載し、RTSPやWebRTCなどでGround Stationに映像を送り、ダッシュボードの1つのパネルとして表示する機能。
- **アラートとトースト通知**: 
  高度が0になった時（着地判定）、またはパケットロスが発生した際に、画面上に目立つトースト通知（Toastify等）を出す仕組み。
- **モバイルレスポンシブの強化**: 
  現状はPCの広い画面を想定したグリッドですが、フィールドではタブレットで確認することも多いため、タブレット縦持ちなどに最適化されたレイアウトの調整。

### 3.2 バックエンド・インフラの改善
- **データベースによる永続化**: 
  現在はメモリ上で配列に保持し、CSVファイルに書き出しているだけですが、SQLiteやPostgreSQL等のデータベースを導入することで、過去のフライトデータを画面上で振り返る「リプレイ機能」が実装可能になります。
- **コマンドの到達確認（ACK）メカニズム**: 
  現在UDPで送るアップリンクは「送りっぱなし」です。CanSat側から「コマンド受け取ったよ」というACK（確認応答）を返させ、UI上で「送信成功」を緑のチェックマークで表示するような仕組みを作ると操作の確実性が上がります。
- **再接続・切断検知の強化**: 
  CanSatとのUDP通信が一定時間（例：5秒間）途絶えた場合に、フロントエンドで「CanSat Signal Lost」と警告を出すハートビート監視機能の実装。

### 3.3 3Dモデルの拡張
- **独自のGLTFモデルの読み込み**:
  現在はThree.jsの標準円柱（CylinderGeometry）を表示していますが、CanSatの実際のCADデータ（STLやGLTF/GLBファイル）を `useGLTF` フックで読み込ませることで、本物と全く同じ見た目の機体が画面上で回転するようになります。