"""
Images API Router for DEEP REVERSE:
Provides AI image generation endpoint with style presets and aspect ratio configuration.
"""
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from apps.api.core.deps import get_current_user
from packages.ai_core.tools.image_generator import generate_image
from packages.db.models import User

router = APIRouter(prefix="/images", tags=["images"])


class GenerateImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1000, description="Image description/prompt")
    style: str = Field(default="photorealistic", description="Style preset: photorealistic, cinematic, anime, cyberpunk, 3d_render, fantasy, minimalist")
    aspect_ratio: str = Field(default="1:1", description="Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:2")
    seed: Optional[int] = Field(default=None, description="Optional random seed for reproducibility")


@router.post("/generate")
async def handle_generate_image(
    body: GenerateImageRequest,
    user: User = Depends(get_current_user),
):
    """
    Generate an AI image based on text prompt, style preset, and aspect ratio.
    """
    result = await generate_image(
        prompt=body.prompt,
        style=body.style,
        aspect_ratio=body.aspect_ratio,
        seed=body.seed,
    )
    return result.to_dict()
