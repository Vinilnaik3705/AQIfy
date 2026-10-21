import json
import os
import time
import uuid
from typing import Any

import redis.asyncio as redis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Redis is an optional accelerator. Short socket timeouts keep every cache and
# rate-limit lookup from holding an API request open when Redis is not deployed.
client = redis.from_url(
    REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=0.5,
    socket_timeout=0.75,
    retry_on_timeout=False,
)


async def get_redis_client():
    try:
        await client.ping()
        return client
    except Exception:
        return None


async def cache_get_json(key: str):
    redis_client = await get_redis_client()
    if not redis_client:
        return None
    try:
        payload = await redis_client.get(key)
        if payload is None:
            return None
        return json.loads(payload)
    except Exception:
        return None


async def cache_set_json(key: str, value: Any, ttl_seconds: int):
    redis_client = await get_redis_client()
    if not redis_client:
        return False
    try:
        await redis_client.set(key, json.dumps(value), ex=ttl_seconds)
        return True
    except Exception:
        return False


async def cache_delete(key: str):
    redis_client = await get_redis_client()
    if not redis_client:
        return
    try:
        await redis_client.delete(key)
    except Exception:
        return


async def rate_limit(key: str, limit: int = 20, window_seconds: int = 60, identifier: str | None = None) -> bool:
    redis_client = await get_redis_client()
    if not redis_client:
        return True
    target = f"rl:{key}:{identifier or 'global'}"
    now = int(time.time())
    window_start = now - window_seconds
    try:
        await redis_client.zremrangebyscore(target, 0, window_start)
        member = f"{now}-{uuid.uuid4()}"
        await redis_client.zadd(target, {member: now})
        await redis_client.expire(target, window_seconds)
        current_count = await redis_client.zcard(target)
        return current_count <= limit
    except Exception:
        return True


async def rate_limit_or_429(request, key: str, limit: int = 20, window_seconds: int = 60):
    from fastapi import HTTPException
    client_id = request.client.host if request.client else "unknown"
    if not await rate_limit(f"{key}:{client_id}", limit=limit, window_seconds=window_seconds):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
