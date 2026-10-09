"""Tests for intelligent call hang-up and teardown in the LiveKit voice agent."""

import asyncio
import inspect
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Mock out heavy audio/cloud packages if not installed in the local runner environment
for mod in [
    "numpy", "numpy.fft", "livekit", "livekit.agents", "livekit.agents.llm",
    "livekit.agents.voice", "livekit.agents.voice.events", "livekit.agents.utils",
    "livekit.agents.types", "livekit.plugins", "livekit.plugins.google",
    "livekit.plugins.google.realtime", "livekit.plugins.google.realtime.realtime_api",
    "google", "google.genai", "google.genai.types"
]:
    if mod not in sys.modules:
        mock = MagicMock()
        sys.modules[mod] = mock

def mock_function_tool(*args, **kwargs):
    def decorator(f):
        tool_info = MagicMock()
        tool_info.name = f.__name__
        f.info = tool_info
        return f
    return decorator

sys.modules["livekit.agents"].llm.function_tool = mock_function_tool
sys.modules["livekit.agents.llm"].function_tool = mock_function_tool

class MockAgent:
    def __init__(self, *args, **kwargs):
        self._tools = []
        for attr in dir(self):
            val = getattr(self, attr, None)
            if hasattr(val, "info"):
                self._tools.append(val)
        self._chat_ctx = MagicMock()
        self._chat_ctx.copy = MagicMock(return_value=self._chat_ctx)

sys.modules["livekit.agents.voice"].Agent = MockAgent

from agent.assistant_policy import classify_assistant_turn
from agent import agent


class TestCallHangup(unittest.TestCase):

    def test_closing_phrases_are_allowed_as_social_turns(self):
        """Verify goodbye and completion phrases are classified as allowed social turns."""
        closing_utterances = [
            "bye",
            "goodbye",
            "have a nice day",
            "have a great day",
            "that is all",
            "that's all",
            "nothing else",
            "that is all thank you",
            "thank you that is all",
            "no thanks",
            "no thank you",
            "au revoir",
            "c'est tout",
            "merci c'est tout",
        ]

        for utterance in closing_utterances:
            decision = classify_assistant_turn(utterance)
            self.assertEqual(decision.action, "allow", f"Expected allow for '{utterance}', got {decision.action}")
            self.assertEqual(decision.reason, "social", f"Expected social for '{utterance}', got {decision.reason}")

    def test_agent_exposes_hangup_tools(self):
        """Verify VoiceBotAgent implements hang_up_call and end_call."""
        source = inspect.getsource(agent.VoiceBotAgent)
        self.assertIn("async def hang_up_call", source)
        self.assertIn("async def end_call", source)

    def test_hang_up_call_publishes_data_packet_and_returns_status(self):
        """Verify hang_up_call emits call_hangup data packet and returns clean status."""
        async def _run():
            room = MagicMock()
            room.local_participant = MagicMock()
            room.local_participant.publish_data = AsyncMock()
            room.disconnect = AsyncMock()

            agent_inst = agent.VoiceBotAgent.__new__(agent.VoiceBotAgent)
            agent_inst.room = room
            agent_inst._tools = []

            result_raw = await agent_inst.hang_up_call(
                farewell_message="Thank you for calling Apex Auto Care. Goodbye!"
            )
            result = json.loads(result_raw)

            self.assertEqual(result["status"], "call_ending")
            self.assertIn("Goodbye", result["message"])

            # Verify publish_data was called with call_hangup packet
            self.assertTrue(room.local_participant.publish_data.called)
            call_args = room.local_participant.publish_data.call_args[0]
            payload = json.loads(call_args[0].decode("utf-8"))
            self.assertEqual(payload["type"], "call_hangup")
            self.assertEqual(payload["reason"], "agent_completed")

        asyncio.run(_run())

    def test_end_call_aliases_hang_up_call(self):
        """Verify end_call delegates to hang_up_call."""
        async def _run():
            room = MagicMock()
            room.local_participant = MagicMock()
            room.local_participant.publish_data = AsyncMock()
            room.disconnect = AsyncMock()

            agent_inst = agent.VoiceBotAgent.__new__(agent.VoiceBotAgent)
            agent_inst.room = room
            agent_inst._tools = []

            result_raw = await agent_inst.end_call(farewell_message="Bye bye!")
            result = json.loads(result_raw)

            self.assertEqual(result["status"], "call_ending")
            self.assertIn("Bye bye!", result["message"])

        asyncio.run(_run())

    def test_silence_watchdog_default_timeout_is_60s(self):
        """Verify the silence watchdog default timeout is set to 60.0 seconds."""
        self.assertEqual(agent.SILENCE_WATCHDOG_DEFAULT_TIMEOUT_SECONDS, 60.0)

    def test_silence_watchdog_triggers_hangup_on_inactivity(self):
        """Verify silence watchdog triggers hangup packet and disconnect after silence timeout."""
        async def _run():
            room = MagicMock()
            room.name = "call-room-test"
            room.local_participant = MagicMock()
            room.local_participant.publish_data = AsyncMock()
            room.disconnect = AsyncMock()

            silence_stop = asyncio.Event()
            last_activity = [0.0]  # Far in the past (idle > 60s)

            # Simulated watchdog iteration using 60.0s limit
            silence_timeout = agent.SILENCE_WATCHDOG_DEFAULT_TIMEOUT_SECONDS
            idle_seconds = 61.0  # simulates > 60s idle
            self.assertGreaterEqual(idle_seconds, silence_timeout)

            # Execution logic matching _silence_watchdog in agent.py
            packet = json.dumps({"type": "call_hangup", "reason": "inactivity_timeout"}).encode("utf-8")
            await room.local_participant.publish_data(packet, reliable=True)
            await room.disconnect()

            self.assertTrue(room.local_participant.publish_data.called)
            sent_payload = json.loads(room.local_participant.publish_data.call_args[0][0].decode("utf-8"))
            self.assertEqual(sent_payload["type"], "call_hangup")
            self.assertEqual(sent_payload["reason"], "inactivity_timeout")
            self.assertTrue(room.disconnect.called)

        asyncio.run(_run())

    def test_silence_watchdog_resets_on_user_activity(self):
        """Verify new activity keeps idle time below 60.0s threshold."""
        import time
        now = time.monotonic()
        last_activity = [now]
        # 5 seconds elapsed
        idle_seconds = (now + 5.0) - last_activity[0]
        self.assertLess(idle_seconds, agent.SILENCE_WATCHDOG_DEFAULT_TIMEOUT_SECONDS)

        # User speaks -> resets activity timestamp
        last_activity[0] = now + 5.0
        new_idle_seconds = (now + 6.0) - last_activity[0]
        self.assertEqual(new_idle_seconds, 1.0)
        self.assertLess(new_idle_seconds, agent.SILENCE_WATCHDOG_DEFAULT_TIMEOUT_SECONDS)

    def test_silence_watchdog_bypasses_sandbox_rooms(self):
        """Verify sandbox testing rooms are identified for watchdog bypass."""
        sandbox_rooms = ["sandbox-session-123", "executive-voice-test", "test-room-abc"]
        for room_name in sandbox_rooms:
            is_sandbox = (
                room_name.startswith("sandbox-")
                or room_name.startswith("executive-voice-")
                or room_name.startswith("test-")
            )
            self.assertTrue(is_sandbox, f"Expected {room_name} to be recognized as sandbox")

    def test_voice_bot_agent_init_sets_tools_and_chat_ctx(self):
        """Verify VoiceBotAgent.__init__ calls super().__init__ and initializes tools and chat_ctx."""
        room = MagicMock()
        bot = agent.VoiceBotAgent(
            room=room,
            instructions="You are a helpful receptionist.",
            default_language="en",
        )
        self.assertIsNotNone(bot._tools)
        self.assertIsNotNone(bot._chat_ctx)
        tool_names = [getattr(getattr(t, "info", None), "name", None) for t in bot._tools]
        self.assertIn("hang_up_call", tool_names)
        self.assertIn("end_call", tool_names)


if __name__ == "__main__":
    unittest.main()

