import json

from wcpp import Entry, Packet

from .wcpp.handle_name import handle_name


def create_packet(
    packet_id: str, component_id: str, dest_unit_id: str, origin_unit_id: str
):
    try:
        packet_id = ord(handle_name(packet_id, "packet"))
        component_id = ord(handle_name(component_id, "component"))
        dest_unit_id = ord(handle_name(dest_unit_id, "unit"))
        origin_unit_id = ord(handle_name(origin_unit_id, "unit"))
    except ValueError as e:
        raise e

    return Packet().telemetry(
        packet_id=packet_id,
        component_id=component_id,
        origin_unit_id=origin_unit_id,
        dest_unit_id=dest_unit_id,
    )


def sp_handler(value):
    bufs = []

    # Is value a number?
    if not isinstance(value, (int, float)):
        raise ValueError(f"Invalid value: {value}")
    value = float(value)
    entries = [Entry("Sp").set_float32(value)]
    dest_unit_names = ["Tracker", "Mission"]

    for dest_unit_name in dest_unit_names:
        packet = create_packet(
            "Grafana", "Environment", dest_unit_name, "Ground station"
        )
        packet.entries = entries
        buf = packet.encode()
        bufs.append(buf)

    return bufs


def lp_handler(value):
    # Is value a boolean?
    if not isinstance(value, bool):
        raise ValueError(f"Invalid value: {value}")

    entries = [Entry("Lp").set_bool(value)]
    packet = create_packet("Grafana", "Environment", "Mission", "Ground station")
    packet.entries = entries
    buf = packet.encode()
    return [buf]


def send_packet(data: json) -> list[bytes]:
    try:
        data = json.loads(data)
    except json.JSONDecodeError as e:
        raise e

    key, value = list(data.items())[0]

    handlers = {
        "Sp": sp_handler,
        "Lp": lp_handler,
    }

    if key not in handlers:
        raise ValueError(f"Invalid key: {key}")

    bufs = handlers[key](value)

    return bufs
