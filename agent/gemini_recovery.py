"""Bounded recovery helpers for Gemini Live realtime sessions.

The Google plugin can resume an established session, but a failed reconnect
attempt may become terminal before its configured retry budget is exhausted.
This module layers fresh, delayed Gemini sessions behind LiveKit's realtime
fallback adapter so the AgentSession remains alive while recovery is possible.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
import logging
from typing import Any

from livekit.agents import llm
from livekit.agents.types import APIConnectOptions
from livekit.plugins.google.realtime.realtime_api import (
    RealtimeModel as GoogleRealtimeModel,
    RealtimeSession as GoogleRealtimeSession,
)


DEFAULT_RECOVERY_DELAYS_SECONDS = (0.0, 1.0, 2.0, 4.0, 8.0)
logger = logging.getLogger("voice_bot.agent.gemini_recovery")


def parse_recovery_delays(
    raw_value: str | None,
    *,
    default: Iterable[float] = DEFAULT_RECOVERY_DELAYS_SECONDS,
) -> tuple[float, ...]:
    """Return a bounded, monotonic recovery schedule with an immediate slot."""
    values: list[float] = []
    if raw_value:
        try:
            values = [float(item.strip()) for item in raw_value.split(",") if item.strip()]
        except ValueError:
            values = []

    if not values:
        values = [float(value) for value in default]

    normalized = sorted({min(max(value, 0.0), 30.0) for value in values})
    if not normalized or normalized[0] != 0.0:
        normalized.insert(0, 0.0)
    return tuple(normalized[:6])


class ExponentialAPIConnectOptions(APIConnectOptions):
    """Use bounded exponential delays for reconnects within one Gemini session."""

    def _interval_for_retry(self, num_retries: int) -> float:
        return min(self.retry_interval * (2 ** max(num_retries, 0)), 8.0)


class DelayedRealtimeSession(GoogleRealtimeSession):
    """Delay a fresh provider connection without blocking the worker event loop."""

    def __init__(self, realtime_model: "DelayedRealtimeModel", startup_delay: float) -> None:
        self._recovery_startup_delay = startup_delay
        super().__init__(realtime_model)

    async def _main_task(self) -> None:
        if self._recovery_startup_delay > 0:
            logger.info(
                "Waiting before fresh Gemini session: delay_seconds=%.1f",
                self._recovery_startup_delay,
            )
            await asyncio.sleep(self._recovery_startup_delay)
        await super()._main_task()


class DelayedRealtimeModel(GoogleRealtimeModel):
    """Gemini model instance that starts after its assigned recovery delay."""

    def __init__(self, *, startup_delay: float = 0.0, **kwargs: Any) -> None:
        self._recovery_startup_delay = startup_delay
        super().__init__(**kwargs)

    def session(self, *, turn_detection_disabled: bool = False) -> DelayedRealtimeSession:
        # Gemini currently cannot disable its provider-side turn detection. Match
        # the plugin's session() behavior while substituting the delayed session.
        session = DelayedRealtimeSession(self, self._recovery_startup_delay)
        self._sessions.add(session)
        return session


class ObservableRealtimeFallbackAdapter(llm.RealtimeModelFallbackAdapter):
    """Expose successful internal swaps to the application lifecycle publisher."""

    def __init__(self, *args: Any, models: Any = (), **kwargs: Any) -> None:
        self._models = list(models)
        self._regenerate_on_swap = kwargs.get("regenerate_on_swap", False)
        super().__init__(*args, models=models, **kwargs)

    def session(self, *, turn_detection_disabled: bool = False):
        session = super().session(turn_detection_disabled=turn_detection_disabled)
        session.on("session_reconnected", lambda event: self.emit("recovery_succeeded", event))
        return session


def build_resilient_realtime_model(
    *,
    recovery_delays: Iterable[float] = DEFAULT_RECOVERY_DELAYS_SECONDS,
    cooldown_seconds: float = 30.0,
    **model_kwargs: Any,
) -> ObservableRealtimeFallbackAdapter:
    """Build a resumable Gemini model with bounded fresh-session fallbacks."""
    delays = tuple(recovery_delays)
    if not delays:
        delays = DEFAULT_RECOVERY_DELAYS_SECONDS

    models = [
        DelayedRealtimeModel(
            startup_delay=delay,
            conn_options=ExponentialAPIConnectOptions(
                max_retry=5,
                retry_interval=1.0,
                timeout=15.0,
            ),
            **model_kwargs,
        )
        for delay in delays
    ]
    return ObservableRealtimeFallbackAdapter(
        models=models,
        cooldown=cooldown_seconds,
        # Reissuing a partially generated reply can repeat a consequential tool
        # call. The next committed user turn safely drives the recovered session.
        regenerate_on_swap=False,
    )
