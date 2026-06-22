import json
import logging
import struct

from datetime import datetime

from lib.send_packet import send_packet
from lib.write_measurement import write_measurement

import tornado.ioloop
import tornado.web
import tornado.websocket

from lib.predict import get_values
from wcpp import Packet
from lib.wcpp.handle_name import handle_name

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

error_log = ""

# 新しいグローバル変数：ブラウザクライアント管理
web_clients = set()


def parse_wcpp(binary_data):
    """
    WCPP形式のバイナリデータをパースして地図表示用の辞書に変換する。
    
    Args:
        binary_data: WCPP形式のバイナリデータ
    
    Returns:
        {"lat": float, "lon": float, "alt": float, "device_type": str, "device_id": str, ...}
        の形式の辞書。パース失敗時はNoneを返す
    """
    try:
        # WCPPパケットをパース
        packet = Packet.parse(binary_data)
        
        # 抽出する エントリの マッピング
        field_mapping = {
            "La": "lat",           # 緯度
            "Lo": "lon",           # 経度
            "Al": "alt",           # GPS高度
            "Te": "temp",          # 温度
            "Hu": "humidity",      # 湿度
            "Pr": "pressure",      # 気圧
            "Pa": "pressure_alt",  # 気圧高度
        }
        
        parsed_data = {}
        
        # パケット内のすべてのエントリをイテレート
        for entry in packet.entries:
            if entry.name in field_mapping:
                output_key = field_mapping[entry.name]
                
                # データ型に応じて値を抽出
                if entry.is_float32() or entry.is_float64() or entry.is_float16():
                    parsed_data[output_key] = entry.float()
                elif entry.is_int():
                    parsed_data[output_key] = entry.int()
                else:
                    parsed_data[output_key] = entry.float()
        
        # デバイスタイプとID情報を取得
        try:
            origin_unit_name = handle_name(chr(packet.origin_unit_id), "unit")
            parsed_data["device_id"] = origin_unit_name
            
            # デバイスタイプをunit_nameから推測
            unit_name_lower = origin_unit_name.lower()
            if "rocket" in unit_name_lower or "balloon" in unit_name_lower:
                parsed_data["device_type"] = "balloon"
            elif "tracker" in unit_name_lower or "ground" in unit_name_lower:
                parsed_data["device_type"] = "ground_station"
            elif "ship" in unit_name_lower or "boat" in unit_name_lower:
                parsed_data["device_type"] = "ship"
            else:
                parsed_data["device_type"] = "balloon"  # デフォルト
        except Exception as e:
            logger.warning(f"Failed to extract device info: {e}")
            parsed_data["device_id"] = f"unknown_{packet.origin_unit_id}"
            parsed_data["device_type"] = "balloon"
        
        # 地図表示に必須の項目（緯度・経度）が存在することを確認
        if "lat" in parsed_data and "lon" in parsed_data:
            logger.info(f"WCPP parsed: lat={parsed_data['lat']}, lon={parsed_data['lon']}, device={parsed_data.get('device_id', 'unknown')}")
            return parsed_data
        else:
            logger.warning("Required fields (lat/lon) not found in WCPP packet")
            return None
            
    except Exception as e:
        logger.error(f"WCPP パース エラー: {e}", exc_info=True)
        return None


class WebSocketHandler(tornado.websocket.WebSocketHandler):
    clients = {}

    def check_origin(self, origin):
        # This method can be used to allow/disallow cross-origin requests
        # Here, it's set to always allow. You might want to restrict it to certain origins.
        return True

    def set_default_headers(self):
        # Set CORS headers here
        self.set_header("Access-Control-Allow-Origin", "*")
        self.set_header(
            "Access-Control-Allow-Headers", "Content-Type, X-Requested-With"
        )
        self.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def open(self):
        logger.info("WebSocket opened")
        client_name = self.get_argument(
            "client_name", "anonymous"
        )  # Get the client name
        self.client_name = client_name  # Store the client name
        if client_name in self.clients:  # If a client with the same name already exists
            self.clients[client_name].close()  # Close the old client's connection
        self.clients[client_name] = self  # Store the WebSocketHandler instance

    def on_message(self, message):
        global error_log

        try:
            error_log = ""
            # 既存: InfluxDBにデータを保存
            record = write_measurement(message)
            
            # 新規: WCPP をパースしてブラウザクライアントにブロードキャスト
            parsed_data = parse_wcpp(message)
            if parsed_data and 'lat' in parsed_data and 'lon' in parsed_data:
                broadcast_to_web_clients(parsed_data)
            
        except ValueError:
            self.write_message("Invalid data.")
            error_log = str(datetime.now()) + ": " + "Invalid data."
            logger.warning("WebSocket received invalid data")
        except Exception as e:
            error_log = str(datetime.now()) + ": " + str(e)
            logger.exception("Unexpected error while handling WebSocket message")

    def on_close(self):
        logger.info("WebSocket closed")
        if (
            self in self.clients.values()
        ):  # Only remove the client if it's still in the clients dictionary
            del self.clients[self.client_name]  # Remove the WebSocketHandler instance

    @classmethod
    def send_to_clients(cls, bufs):
        logger.info("Sending packets to %d clients", len(cls.clients))
        for client in cls.clients.values():
            for buf in bufs:
                client.write_message(buf, binary=True)


class WebSocketWebHandler(tornado.websocket.WebSocketHandler):
    """
    ブラウザ用のWebSocketハンドラー。
    リアルタイムマップ表示用のクライアントを管理し、
    ESP32から受信したWCPPデータをJSON形式で送信する。
    """

    def check_origin(self, origin):
        return True

    def set_default_headers(self):
        self.set_header("Access-Control-Allow-Origin", "*")
        self.set_header(
            "Access-Control-Allow-Headers", "Content-Type, X-Requested-With"
        )
        self.set_header("Access-Control-Allow-Methods", "GET, OPTIONS")

    def open(self):
        """クライアント接続時の処理"""
        web_clients.add(self)
        logger.info(f"Web client connected. Total web clients: {len(web_clients)}")

    def on_close(self):
        """クライアント切断時の処理"""
        web_clients.discard(self)
        logger.info(f"Web client disconnected. Total web clients: {len(web_clients)}")

    def on_message(self, message):
        """ブラウザからのメッセージ受信（通常は使用しない）"""
        logger.debug(f"Web client message: {message}")


class ApiHandler(tornado.web.RequestHandler):  # Add this class
    def set_default_headers(self):
        # Set CORS headers here
        self.set_header("Access-Control-Allow-Origin", "*")
        self.set_header(
            "Access-Control-Allow-Headers",
            "x-requested-with, Content-Type, " "Access-Control-Allow-Origin",
        )
        self.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def post(self):
        global error_log
        try:
            bufs = send_packet(self.request.body)
            WebSocketHandler.send_to_clients(bufs)
        except json.JSONDecodeError:
            self.set_status(400)  # Bad Request
            self.write({"error": "Invalid JSON."})
            error_log = str(datetime.now()) + ": " + "Invalid JSON."
            logger.warning("API received invalid JSON")
            return
        except ValueError:
            self.set_status(400)
            self.write({"error": "Invalid data."})
            error_log = str(datetime.now()) + ": " + "Invalid data."
            logger.warning("API received invalid data")
            return
        except Exception as e:
            self.set_status(400)
            self.write({"error": "An unexpected error occurred."})
            error_log = str(datetime.now()) + ": " + str(e)
            logger.exception("Unexpected error in API POST handler")

    def get(self):
        url = get_values()
        if error_log:
            self.write({"error": error_log})
        else:
            self.write(url)

    def options(self):
        self.set_status(204)
        self.finish()


def broadcast_to_web_clients(data):
    """
    すべての接続中のWebクライアントにJSONデータをブロードキャストする。
    
    Args:
        data: 辞書形式のデータ（内部でJSON化される）
    """
    if not web_clients:
        return
    
    json_data = json.dumps(data)
    logger.info(f"Broadcasting to {len(web_clients)} web clients: {json_data}")
    
    for client in web_clients:
        try:
            client.write_message(json_data)
        except Exception as e:
            logger.error(f"Failed to send message to web client: {e}")
            web_clients.discard(client)


def make_app():
    return tornado.web.Application([
        (r"/ws", WebSocketHandler),
        (r"/ws_web", WebSocketWebHandler),
        (r"/send", ApiHandler),
    ])


if __name__ == "__main__":
    app = make_app()
    app.listen(8888)
    tornado.autoreload.start()  # ここでautoreloadを開始
    tornado.ioloop.IOLoop.current().start()
