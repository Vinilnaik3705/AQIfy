import asyncio

from fastapi import APIRouter, Request

from services.guidance_service import (
    _LOCAL_TRANSLATIONS,
    _cache_translation,
    _local_translate_text,
    _translation_cache,
)

router = APIRouter()
_TRANSLATION_GATE = asyncio.Lock()
_TRANSLATION_NEXT_ALLOWED_AT = 0.0
_TRANSLATION_MIN_GAP_SECONDS = 0.25


async def _translate_batch(translator, texts):
    """Serialize public Google Translate calls and keep them off the event loop."""
    global _TRANSLATION_NEXT_ALLOWED_AT
    async with _TRANSLATION_GATE:
        wait_seconds = _TRANSLATION_NEXT_ALLOWED_AT - asyncio.get_running_loop().time()
        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)
        translated = await asyncio.to_thread(translator.translate_batch, texts)
        _TRANSLATION_NEXT_ALLOWED_AT = asyncio.get_running_loop().time() + _TRANSLATION_MIN_GAP_SECONDS
        return translated


@router.post("/api/translate")
async def translate_texts(request: Request):
    """Translate an array of text strings to a target language using deep-translator.
    Request body: { "texts": ["Hello", "Dashboard"], "target": "hi" }
    Response:     { "translations": ["नमस्ते", "डैशबोर्ड"] }
    """
    body = await request.json()
    texts = body.get("texts", [])
    target = body.get("target", "en")

    if target == "en" or not texts:
        return {"translations": texts}

    results = [None] * len(texts)
    to_translate = []

    for i, text in enumerate(texts):
        stripped = text.strip()
        if not stripped:
            results[i] = text
            continue
        cache_key = (stripped, target)
        if cache_key in _translation_cache:
            results[i] = _translation_cache[cache_key]
        else:
            local_value = _local_translate_text(stripped, target)
            if local_value != stripped:
                # Prefer deterministic bundled translations for common UI copy.
                # This keeps language switching instant and avoids spending
                # public translator quota on strings we already know.
                results[i] = local_value
                _cache_translation(cache_key, local_value)
            else:
                to_translate.append((i, stripped))

    if to_translate:
        unique_texts = list(dict.fromkeys(t for _, t in to_translate))
        translated_map = {}
        try:
            from deep_translator import GoogleTranslator

            translator = GoogleTranslator(source="en", target=target)
            chunk_size = 50
            for i in range(0, len(unique_texts), chunk_size):
                chunk = unique_texts[i:i + chunk_size]
                # deep-translator performs blocking network I/O. Keep it off
                # FastAPI's event loop so one translation cannot stall state,
                # map, or advisory requests for every connected user.
                translated_chunk = await _translate_batch(translator, chunk)
                for orig, trans in zip(chunk, translated_chunk):
                    translated_value = trans or orig
                    translated_map[orig] = translated_value
                    _cache_translation((orig, target), translated_value)
        except Exception as e:
            print(f"Translation error: {e}")
            for text in unique_texts:
                fallback = _local_translate_text(text, target)
                translated_map[text] = fallback
                # Cache failed results too. Repeated DOM observer scans should
                # not retry a provider that is currently rate-limited.
                _cache_translation((text, target), fallback)

        for i, stripped in to_translate:
            results[i] = translated_map.get(stripped, _local_translate_text(stripped, target))

    for i in range(len(results)):
        if results[i] is None:
            results[i] = _local_translate_text(texts[i], target) if texts[i] else texts[i]

    return {"translations": results}
