"""Prompt-to-video generation through Google's Gemini Omni API."""

import base64
import os
import tempfile
import time
from typing import Any

from google import genai

from packages.shared.config import get_settings

VIDEO_MODEL = "gemini-omni-1.1-flash"


def _field(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(name, default)
    return getattr(value, name, default)


def generate_prompt_video(prompt: str, aspect_ratio: str = "16:9") -> bytes:
    """Generate real MP4 footage and return its bytes.

    Google runs generation on its servers. The API call may take a few minutes;
    callers should run this function off the event loop.
    """
    settings = get_settings()
    if settings.ai_provider != "gemini":
        raise RuntimeError("Video generation requires AI_PROVIDER=gemini.")
    if not settings.ai_api_key:
        raise RuntimeError("AI_API_KEY is not configured.")

    client = genai.Client(api_key=settings.ai_api_key)
    interaction = client.interactions.create(
        model=VIDEO_MODEL,
        input=prompt,
        response_format={
            "type": "video",
            "aspect_ratio": aspect_ratio,
            "resolution": "720p",
            "delivery": "uri",
        },
        background=False,
        store=False,
        stream=False,
    )

    video = _field(interaction, "output_video")
    if not video:
        raise RuntimeError("The video model returned no footage. Try changing the prompt.")

    inline_data = _field(video, "data")
    if inline_data:
        return base64.b64decode(inline_data)

    uri = _field(video, "uri")
    if not uri:
        raise RuntimeError("The video model response did not include a downloadable video.")

    file_id = str(uri).rstrip("/").split("/")[-1]
    file_name = f"files/{file_id}"
    video_file = None
    for _ in range(180):
        video_file = client.files.get(name=file_name)
        state = _field(_field(video_file, "state"), "name", "")
        state = str(state).upper()
        if state == "ACTIVE":
            break
        if state == "FAILED":
            raise RuntimeError("Google could not prepare the generated video for download.")
        time.sleep(5)
    else:
        raise TimeoutError("The generated video is still processing. Please try again shortly.")

    destination = None
    try:
        with tempfile.NamedTemporaryFile(prefix="deep-reverse-video-", suffix=".mp4", delete=False) as temporary:
            destination = temporary.name
        client.files.download(file=video_file, destination=destination)
        with open(destination, "rb") as generated_file:
            return generated_file.read()
    finally:
        if destination and os.path.exists(destination):
            os.remove(destination)
