"""Prompt-driven AI video generation endpoints."""

import asyncio
import logging
import time
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from apps.api.core.deps import get_current_user
from packages.ai_core.tools.video_generator import VIDEO_MODEL, generate_prompt_video
from packages.db.models import User
from packages.shared.config import get_settings

logger = logging.getLogger("deep_reverse.video")
router = APIRouter(prefix="/videos", tags=["videos"])

# Generated clips stay private to the user who requested them. This in-memory
# job store is suitable for the current single-process local development API.
_jobs: dict[str, dict] = {}


class GenerateVideoRequest(BaseModel):
    prompt: str = Field(..., min_length=8, max_length=3000)
    aspect_ratio: Literal["16:9", "9:16"] = "16:9"


def _public_error(error: Exception) -> str:
    message = str(error).lower()
    if any(token in message for token in ("quota", "billing", "resource_exhausted", "429", "rate limit")):
        return "Gemini video quota or billing limit reached. Check that paid-tier video generation is enabled for your API key."
    if any(token in message for token in ("api key", "permission", "unauthorized", "403", "not configured")):
        return "This Gemini API key cannot access video generation. Check the key and paid-tier model access."
    if any(token in message for token in ("safety", "blocked", "policy")):
        return "The video prompt was blocked by the model’s safety filter. Please revise the prompt."
    if isinstance(error, TimeoutError):
        return "Video generation took too long. Try again with a shorter or simpler prompt."
    return "Video generation failed. Check Gemini API access and server logs, then try again."


async def _run_video_job(job_id: str, prompt: str, aspect_ratio: str) -> None:
    job = _jobs[job_id]
    job["status"] = "generating"
    job["message"] = "Gemini is generating your footage. This can take a few minutes."
    try:
        video_bytes = await asyncio.to_thread(generate_prompt_video, prompt, aspect_ratio)
        if not video_bytes:
            raise RuntimeError("The video model returned an empty video.")
        job["video_bytes"] = video_bytes
        job["status"] = "complete"
        job["message"] = "Your AI-generated footage is ready."
    except Exception as error:
        logger.exception("AI video generation failed", extra={"job_id": job_id})
        job["status"] = "failed"
        job["message"] = _public_error(error)


def _owned_job(job_id: str, user: User) -> dict:
    job = _jobs.get(job_id)
    if not job or job["user_id"] != str(user.id):
        raise HTTPException(status_code=404, detail="Video job not found.")
    return job


@router.post("/generate", status_code=202)
async def start_video_generation(
    body: GenerateVideoRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
):
    settings = get_settings()
    if settings.ai_provider != "gemini":
        raise HTTPException(status_code=503, detail="AI video generation currently requires the Gemini provider.")
    if not settings.ai_api_key:
        raise HTTPException(status_code=503, detail="Set AI_API_KEY in the API environment to enable video generation.")

    now = time.time()
    expired = [job_id for job_id, job in _jobs.items() if now - job["created_at"] > 60 * 60]
    for job_id in expired:
        _jobs.pop(job_id, None)

    job_id = str(uuid4())
    _jobs[job_id] = {
        "id": job_id,
        "user_id": str(user.id),
        "status": "queued",
        "message": "Your prompt is queued for Gemini video generation.",
        "video_bytes": None,
        "created_at": now,
        "model": VIDEO_MODEL,
        "aspect_ratio": body.aspect_ratio,
    }
    background_tasks.add_task(_run_video_job, job_id, body.prompt.strip(), body.aspect_ratio)
    return {
        "id": job_id,
        "status": "queued",
        "message": _jobs[job_id]["message"],
        "model": VIDEO_MODEL,
        "aspect_ratio": body.aspect_ratio,
    }


@router.get("/jobs/{job_id}")
async def get_video_job(job_id: str, user: User = Depends(get_current_user)):
    job = _owned_job(job_id, user)
    return {
        "id": job["id"],
        "status": job["status"],
        "message": job["message"],
        "model": job["model"],
        "aspect_ratio": job["aspect_ratio"],
    }


@router.get("/jobs/{job_id}/file")
async def download_video_job(job_id: str, user: User = Depends(get_current_user)):
    job = _owned_job(job_id, user)
    if job["status"] != "complete" or not job["video_bytes"]:
        raise HTTPException(status_code=409, detail="The generated video is not ready yet.")
    return Response(
        content=job["video_bytes"],
        media_type="video/mp4",
        headers={"Content-Disposition": 'inline; filename="deep-reverse-ai-footage.mp4"'},
    )
