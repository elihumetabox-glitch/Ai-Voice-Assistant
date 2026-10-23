"""Voice-agent configuration and canonical policy wiring."""

import os
from pathlib import Path
from dotenv import load_dotenv

try:
    from .assistant_policy import ASSISTANT_POLICY_VERSION, CALENDAR_SYSTEM_INSTRUCTION
except ImportError:
    from assistant_policy import ASSISTANT_POLICY_VERSION, CALENDAR_SYSTEM_INSTRUCTION

env_path = Path(__file__).parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

# LiveKit Media Transport
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "wss://ai-voice-assistant-vu6rr406.livekit.cloud")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")

# Google Gemini Multimodal Live Engine (ADR-008 Active Baseline)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-live")
GEMINI_API_VERSION = os.getenv("GEMINI_API_VERSION", "v1beta")
GEMINI_VOICE = os.getenv("GEMINI_VOICE", "Aoede")
GEMINI_RECOVERY_ENABLED = os.getenv("GEMINI_RECOVERY_ENABLED", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
GEMINI_RECOVERY_DELAYS_SECONDS = os.getenv(
    "GEMINI_RECOVERY_DELAYS_SECONDS", "0,1,2,4,8"
)
try:
    GEMINI_RECOVERY_COOLDOWN_SECONDS = max(
        1.0, min(float(os.getenv("GEMINI_RECOVERY_COOLDOWN_SECONDS", "30")), 300.0)
    )
except (TypeError, ValueError):
    GEMINI_RECOVERY_COOLDOWN_SECONDS = 30.0
try:
    AGENT_HEARTBEAT_SECONDS = max(
        1.0, min(float(os.getenv("AGENT_HEARTBEAT_SECONDS", "5")), 30.0)
    )
except (TypeError, ValueError):
    AGENT_HEARTBEAT_SECONDS = 5.0

# Tool Dispatching Backend Endpoint
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
BACKEND_TIMEOUT_SECONDS = float(os.getenv("BACKEND_TIMEOUT_SECONDS", "15"))

# LiveKit dispatch metadata is signed by the service that creates the job.
# An empty secret intentionally makes context verification fail closed.
SESSION_CONTEXT_SIGNING_SECRET = os.getenv("LIVEKIT_SESSION_CONTEXT_SECRET", "")
try:
    _configured_context_age = int(os.getenv("LIVEKIT_SESSION_CONTEXT_MAX_AGE_SECONDS", "300"))
except (TypeError, ValueError):
    _configured_context_age = 0
# Keep dispatch credentials short-lived even if deployment configuration is
# accidentally broadened. Zero makes verification fail closed.
SESSION_CONTEXT_MAX_AGE_SECONDS = (
    _configured_context_age
    if 0 < _configured_context_age <= 15 * 60
    else 0
)

# Keep the worker name in one place so dispatch and worker configuration cannot
# silently drift apart.
AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "calendar-assistant")

# System prompt is loaded from the canonical cross-runtime calendar policy.
SYSTEM_INSTRUCTION = CALENDAR_SYSTEM_INSTRUCTION
POLICY_VERSION = ASSISTANT_POLICY_VERSION
