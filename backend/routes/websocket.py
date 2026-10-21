from typing import Dict, Any, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

ACTIVE_WS_CONNECTIONS: Set[WebSocket] = set()


async def broadcast_aqi_update(payload: Dict[str, Any]):
    if not ACTIVE_WS_CONNECTIONS:
        return
    stale = []
    for socket in list(ACTIVE_WS_CONNECTIONS):
        try:
            await socket.send_json({"type": "aqi_update", "payload": payload})
        except Exception:
            stale.append(socket)
    for socket in stale:
        ACTIVE_WS_CONNECTIONS.discard(socket)


@router.websocket("/ws/aqi")
async def websocket_aqi(websocket: WebSocket):
    await websocket.accept()
    ACTIVE_WS_CONNECTIONS.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ACTIVE_WS_CONNECTIONS.discard(websocket)
    except Exception:
        ACTIVE_WS_CONNECTIONS.discard(websocket)
