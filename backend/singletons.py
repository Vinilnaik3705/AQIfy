import asyncio
from typing import Set

from agents import (
    AttributionAgent,
    PredictiveAgent,
    EnforcementAgent,
    AdvisoryAgent,
)
from forecaster import AQIForecaster

BACKGROUND_TASKS: Set[asyncio.Task] = set()


def _schedule_background(coroutine):
    task = asyncio.create_task(coroutine)
    BACKGROUND_TASKS.add(task)
    task.add_done_callback(BACKGROUND_TASKS.discard)
    return task


async def _cancel_background_tasks() -> None:
    tasks = list(BACKGROUND_TASKS)
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


attribution_agent = AttributionAgent()
predictive_agent = PredictiveAgent()
enforcement_agent = EnforcementAgent()
advisory_agent = AdvisoryAgent()
forecaster = AQIForecaster()
