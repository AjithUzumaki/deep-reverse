"""
Background job worker. Long-running tasks (document processing, image
generation, data analysis, code execution orchestration) get enqueued here
by the API instead of blocking a request. See ARCHITECTURE.md section 9.

Ring 1 note: this file boots a real RQ worker against Redis. Job
implementations (packages/tools/*) land as each Ring 1 phase is built —
this is intentionally not wired to fake jobs.
"""
import logging

from redis import Redis
from rq import Queue, Worker

from packages.shared.config import get_settings
from packages.shared.logging import configure_logging

settings = get_settings()
configure_logging("DEBUG" if settings.debug else "INFO")
logger = logging.getLogger("deep_reverse.worker")

QUEUES = ["default", "documents", "images", "data", "code_exec"]


def main() -> None:
    conn = Redis.from_url(settings.redis_url)
    queues = [Queue(name, connection=conn) for name in QUEUES]
    logger.info("worker_starting", extra={"queues": QUEUES})
    worker = Worker(queues, connection=conn)
    worker.work(with_scheduler=True)


if __name__ == "__main__":
    main()
