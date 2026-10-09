"""
Backend Configuration Settings
Loads typed environment settings from .env file.
"""

from pathlib import Path
from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Multi-path .env resolution (repo root, backend dir, CWD)
_repo_root = Path(__file__).resolve().parents[2]
_backend_dir = Path(__file__).resolve().parents[1]
_env_files = [
    str(_repo_root / ".env"),
    str(_backend_dir / ".env"),
    ".env",
]


class Settings(BaseSettings):
    # Server settings
    backend_host: str = Field(default="127.0.0.1", validation_alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, validation_alias="BACKEND_PORT")
    backend_url: str = Field(default="http://127.0.0.1:8000", validation_alias="BACKEND_URL")
    cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        validation_alias="CORS_ORIGINS",
    )

    # Database (Neon PostgreSQL)
    database_url: str = Field(default="", validation_alias="DATABASE_URL")

    # External APIs
    google_client_id: str = Field(default="", validation_alias="GOOGLE_CLIENT_ID")
    google_redirect_uri: str = Field(
        default="https://ai-voice-assistants.vercel.app/auth/google/callback",
        validation_alias="GOOGLE_REDIRECT_URI",
    )
    google_oauth_state_secret: str = Field(default="", validation_alias="GOOGLE_OAUTH_STATE_SECRET")
    trigger_api_key: str = Field(default="", validation_alias="TRIGGER_API_KEY")
    credential_broker_url: str = Field(default="http://127.0.0.1:8001", validation_alias="CREDENTIAL_BROKER_URL")
    credential_broker_shared_secret: str = Field(default="", validation_alias="CREDENTIAL_BROKER_SHARED_SECRET")
    calendar_availability_cache_ttl_seconds: float = Field(
        default=15.0,
        ge=0.0,
        le=60.0,
        validation_alias="CALENDAR_AVAILABILITY_CACHE_TTL_SECONDS",
    )
    calendar_events_cache_ttl_seconds: float = Field(
        default=10.0,
        ge=0.0,
        le=60.0,
        validation_alias="CALENDAR_EVENTS_CACHE_TTL_SECONDS",
    )
    calendar_mirror_enabled: bool = Field(
        default=False,
        validation_alias="CALENDAR_MIRROR_ENABLED",
    )
    calendar_mirror_max_staleness_seconds: int = Field(
        default=30,
        ge=5,
        le=300,
        validation_alias="CALENDAR_MIRROR_MAX_STALENESS_SECONDS",
    )
    calendar_mirror_reconcile_interval_seconds: int = Field(
        default=30,
        ge=10,
        le=300,
        validation_alias="CALENDAR_MIRROR_RECONCILE_INTERVAL_SECONDS",
    )
    calendar_mirror_active_tenant_ttl_seconds: int = Field(
        default=3600,
        ge=60,
        le=86400,
        validation_alias="CALENDAR_MIRROR_ACTIVE_TENANT_TTL_SECONDS",
    )

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        env_file=_env_files,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
