import pytest
from packages.ai_core.tools.image_generator import generate_image


@pytest.mark.asyncio
async def test_image_generation_url_creation():
    prompt = "A majestic mechanical tiger in neon city"
    result = await generate_image(prompt, style="cyberpunk", aspect_ratio="16:9", seed=42)
    assert result.prompt == prompt
    assert "cyberpunk" in result.style
    assert result.aspect_ratio == "16:9"
    assert result.width == 1280
    assert result.height == 720
    assert "image.pollinations.ai" in result.image_url
    assert "neon" in result.enhanced_prompt.lower() or "cyberpunk" in result.enhanced_prompt.lower()
    assert result.error is None
