import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

for mod in [
    "numpy", "numpy.fft", "livekit", "livekit.agents", "livekit.agents.llm",
    "livekit.agents.voice", "livekit.agents.voice.events", "livekit.agents.utils",
    "livekit.agents.types", "livekit.plugins", "livekit.plugins.google",
    "livekit.plugins.google.realtime", "livekit.plugins.google.realtime.realtime_api",
    "google", "google.genai", "google.genai.types"
]:
    if mod not in sys.modules:
        sys.modules[mod] = MagicMock()

class MockAPIConnectOptions:
    def __init__(self, max_retry=3, retry_interval=2.0, timeout=10.0, **kwargs):
        self.max_retry = max_retry
        self.retry_interval = retry_interval
        self.timeout = timeout
    def _interval_for_retry(self, num_retries: int) -> float:
        return self.retry_interval

if not hasattr(sys.modules["livekit.agents.types"], "APIConnectOptions") or isinstance(sys.modules["livekit.agents.types"].APIConnectOptions, MagicMock):
    sys.modules["livekit.agents.types"].APIConnectOptions = MockAPIConnectOptions
if "types" in dir(sys.modules["livekit.agents"]):
    sys.modules["livekit.agents"].types.APIConnectOptions = MockAPIConnectOptions

class MockRealtimeModelFallbackAdapter:
    def __init__(self, models=(), cooldown=30.0, regenerate_on_swap=False, **kwargs):
        self._models = list(models)
        self._cooldown = cooldown
        self._regenerate_on_swap = regenerate_on_swap
    def session(self, *args, **kwargs):
        return MagicMock()

if not hasattr(sys.modules["livekit.agents.llm"], "RealtimeModelFallbackAdapter") or isinstance(sys.modules["livekit.agents.llm"].RealtimeModelFallbackAdapter, MagicMock):
    sys.modules["livekit.agents.llm"].RealtimeModelFallbackAdapter = MockRealtimeModelFallbackAdapter
if "llm" in dir(sys.modules["livekit.agents"]):
    sys.modules["livekit.agents"].llm.RealtimeModelFallbackAdapter = MockRealtimeModelFallbackAdapter

class MockGoogleRealtimeModel:
    def __init__(self, **kwargs):
        self._sessions = set()

if not hasattr(sys.modules["livekit.plugins.google.realtime.realtime_api"], "RealtimeModel") or isinstance(sys.modules["livekit.plugins.google.realtime.realtime_api"].RealtimeModel, MagicMock):
    sys.modules["livekit.plugins.google.realtime.realtime_api"].RealtimeModel = MockGoogleRealtimeModel
    sys.modules["livekit.plugins.google.realtime"].realtime_api.RealtimeModel = MockGoogleRealtimeModel
    sys.modules["livekit.plugins.google"].realtime.realtime_api.RealtimeModel = MockGoogleRealtimeModel
    sys.modules["livekit.plugins"].google.realtime.realtime_api.RealtimeModel = MockGoogleRealtimeModel

from agent.gemini_recovery import (
    ExponentialAPIConnectOptions,
    build_resilient_realtime_model,
    parse_recovery_delays,
)
from agent.lifecycle import AgentLifecyclePublisher


class GeminiRecoveryTests(unittest.IsolatedAsyncioTestCase):
    def test_recovery_schedule_is_bounded_sorted_and_includes_immediate_slot(self) -> None:
        self.assertEqual(parse_recovery_delays("8,2,4,1"), (0.0, 1.0, 2.0, 4.0, 8.0))
        self.assertEqual(parse_recovery_delays("invalid"), (0.0, 1.0, 2.0, 4.0, 8.0))
        self.assertEqual(parse_recovery_delays("0,100,-2"), (0.0, 30.0))

    def test_connect_options_use_bounded_exponential_intervals(self) -> None:
        options = ExponentialAPIConnectOptions(max_retry=5, retry_interval=1.0, timeout=15.0)
        self.assertEqual(
            [options._interval_for_retry(index) for index in range(5)],
            [1.0, 2.0, 4.0, 8.0, 8.0],
        )

    def test_fresh_session_pool_disables_automatic_reply_regeneration(self) -> None:
        adapter = build_resilient_realtime_model(
            recovery_delays=(0.0, 1.0, 2.0),
            api_key="test-key",
            model="gemini-3.8-live",
            voice="Aoede",
            api_version="v1beta",
        )
        self.assertEqual(
            [model._recovery_startup_delay for model in adapter._models],
            [0.0, 1.0, 2.0],
        )
        self.assertFalse(adapter._regenerate_on_swap)

    async def test_lifecycle_messages_are_sanitized_and_sequence_ordered(self) -> None:
        participant = SimpleNamespace(publish_data=AsyncMock())
        room = SimpleNamespace(local_participant=participant)
        publisher = AgentLifecyclePublisher(room, "session-123", heartbeat_seconds=60)

        await publisher.transition("recovering", code="provider_connection_error", retryable=True)
        await publisher.transition("failed", code="provider_connection_error", retryable=False)
        await publisher.stop()

        first = json.loads(participant.publish_data.await_args_list[0].args[0])
        second = json.loads(participant.publish_data.await_args_list[1].args[0])
        self.assertEqual(first["state"], "recovering")
        self.assertEqual(first["recovery_attempt"], 1)
        self.assertEqual(first["sequence"], 1)
        self.assertEqual(second["state"], "failed")
        self.assertEqual(second["sequence"], 2)
        self.assertNotIn("error", first)
        self.assertNotIn("exception", first)

    async def test_heartbeat_reports_current_recovery_state(self) -> None:
        participant = SimpleNamespace(publish_data=AsyncMock())
        room = SimpleNamespace(local_participant=participant)
        publisher = AgentLifecyclePublisher(room, "session-456", heartbeat_seconds=1)
        await publisher.transition("recovering", retryable=True)
        publisher.start_heartbeat()
        await asyncio.sleep(1.05)
        await publisher.stop()

        payloads = [json.loads(call.args[0]) for call in participant.publish_data.await_args_list]
        self.assertTrue(
            any(
                payload["type"] == "agent_heartbeat" and payload["state"] == "recovering"
                for payload in payloads
            )
        )


if __name__ == "__main__":
    unittest.main()
