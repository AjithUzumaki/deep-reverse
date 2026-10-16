"""
Centralized configuration. Every service (api, worker) imports Settings
from here rather than reading os.environ directly, so there is exactly
one place that knows the shape of the environment.
"""
from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Project metadata
    project_name: str = Field(default="DEEP REVERSE", alias="PROJECT_NAME")

    # App
    env: str = Field(default="development", alias="APP_ENV")
    debug: bool = Field(default=True, alias="DEBUG")

    # Database
    database_url: str = Field(default="postgresql+asyncpg://deep_reverse:deep_reverse@localhost:5432/deep_reverse", alias="DATABASE_URL")

    # Redis
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

    # Auth - Extended to 1440 mins (24h) + continuous background keep-alive for unlimited chat
    jwt_secret: str = Field(default="dev-jwt-secret-deep-reverse-super-secure-key-2026", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_ttl_minutes: int = Field(default=1440, alias="ACCESS_TOKEN_TTL_MINUTES")
    refresh_token_ttl_days: int = Field(default=90, alias="REFRESH_TOKEN_TTL_DAYS")

    # Object storage (S3-compatible / MinIO in dev)
    storage_endpoint: str = Field(default="http://minio:9000", alias="STORAGE_ENDPOINT")
    storage_access_key: str = Field(default="", alias="STORAGE_ACCESS_KEY")
    storage_secret_key: str = Field(default="", alias="STORAGE_SECRET_KEY")
    storage_bucket: str = Field(default="deep-reverse", alias="STORAGE_BUCKET")

    # AI providers
    ai_provider: str = Field(default="gemini", alias="AI_PROVIDER")
    ai_api_key: str = Field(default="", alias="AI_API_KEY")
    anthropic_model: str = Field(default="claude-sonnet-5", alias="ANTHROPIC_MODEL")
    gemini_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_MODEL")
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")
    groq_model: str = Field(default="openai/gpt-oss-120b", alias="GROQ_MODEL")
    ollama_enabled: bool = Field(default=True, alias="OLLAMA_ENABLED")
    ollama_base_url: str = Field(default="http://ollama:11434", alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="qwen3:4b", alias="OLLAMA_MODEL")
    prototype_builder_api_url: str = Field(
        default="https://ai-prototype-builder-s36q.vercel.app/api/generate",
        alias="PROTOTYPE_BUILDER_API_URL",
    )

    # Code execution sandbox
    code_exec_timeout_seconds: int = Field(default=15, alias="CODE_EXEC_TIMEOUT_SECONDS")
    code_exec_max_output_length: int = Field(default=10000, alias="CODE_EXEC_MAX_OUTPUT_LENGTH")

    # Image generation
    image_gen_provider: str = Field(default="pollinations", alias="IMAGE_GEN_PROVIDER")

    # CORS
    allowed_origins: str = Field(default="http://localhost:3000", alias="ALLOWED_ORIGINS")

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
