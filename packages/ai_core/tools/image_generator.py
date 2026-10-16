"""
Image Generation Engine for DEEP REVERSE.
Supports prompt enhancement, style presets, aspect ratio configuration, and direct image synthesis.
"""
import random
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Optional
from uuid import uuid4

STYLE_PROMPTS = {
    "cinematic": "cinematic lighting, 8k resolution, dramatic atmosphere, photorealistic, highly detailed, octane render",
    "photorealistic": "ultra-realistic, 35mm photography, high quality, 8k, natural light, studio portrait, sharp focus",
    "anime": "vibrant anime aesthetic, studio ghibli and makoto shinkai inspired, clean line art, masterwork illustration",
    "cyberpunk": "neon lights, cyberpunk city, dark futuristic, rainy reflections, high tech, glowing holograms",
    "3d_render": "3D pixar style render, unreal engine 5, raytracing, soft lighting, vibrant colors, clean geometry",
    "fantasy": "epic high fantasy, magical aura, mythical landscape, intricate details, matte painting, digital art masterpiece",
    "minimalist": "minimalist design, clean background, modern aesthetic, vector lines, balanced negative space",
}

ASPECT_RATIOS = {
    "1:1": (1024, 1024),
    "16:9": (1280, 720),
    "9:16": (720, 1280),
    "4:3": (1024, 768),
    "3:2": (1080, 720),
}


@dataclass
class ImageGenerationResult:
    id: str
    prompt: str
    enhanced_prompt: str
    image_url: str
    style: str
    aspect_ratio: str
    width: int
    height: int
    created_at: float
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "prompt": self.prompt,
            "enhanced_prompt": self.enhanced_prompt,
            "image_url": self.image_url,
            "style": self.style,
            "aspect_ratio": self.aspect_ratio,
            "width": self.width,
            "height": self.height,
            "created_at": self.created_at,
            "error": self.error,
        }


async def generate_image(
    prompt: str,
    style: str = "photorealistic",
    aspect_ratio: str = "1:1",
    seed: Optional[int] = None,
) -> ImageGenerationResult:
    """
    Generate an image URL from text prompt with style enhancements and aspect ratio controls.
    """
    cleaned_prompt = prompt.strip()
    img_id = str(uuid4())
    img_seed = seed if seed is not None else random.randint(10000, 999999)

    style_key = style.lower().replace(" ", "_")
    style_suffix = STYLE_PROMPTS.get(style_key, "")

    if style_suffix:
        enhanced_prompt = f"{cleaned_prompt}, {style_suffix}"
    else:
        enhanced_prompt = cleaned_prompt

    dimensions = ASPECT_RATIOS.get(aspect_ratio, (1024, 1024))
    width, height = dimensions

    # Generate high-resolution image URL via Pollinations AI Engine
    encoded_prompt = urllib.parse.quote(enhanced_prompt)
    image_url = (
        f"https://image.pollinations.ai/prompt/{encoded_prompt}"
        f"?width={width}&height={height}&seed={img_seed}&nologo=true&enhance=true"
    )

    return ImageGenerationResult(
        id=img_id,
        prompt=cleaned_prompt,
        enhanced_prompt=enhanced_prompt,
        image_url=image_url,
        style=style,
        aspect_ratio=aspect_ratio,
        width=width,
        height=height,
        created_at=time.time(),
        error=None,
    )
