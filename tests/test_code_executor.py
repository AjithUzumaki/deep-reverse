import pytest
from packages.ai_core.tools.code_executor import execute_code


@pytest.mark.asyncio
async def test_python_code_execution_success():
    code = """
x = 10
y = 25
print(f"Sum = {x + y}")
"""
    result = await execute_code(code, language="python")
    assert result.success is True
    assert result.exit_code == 0
    assert "Sum = 35" in result.stdout
    assert result.duration_ms > 0


@pytest.mark.asyncio
async def test_python_code_execution_math_and_data():
    code = """
import math
import statistics

nums = [10, 20, 30, 40, 50]
mean_val = statistics.mean(nums)
sqrt_val = math.sqrt(144)
print(f"Mean={mean_val}, Sqrt={sqrt_val}")
"""
    result = await execute_code(code, language="python")
    assert result.success is True
    assert "Mean=30" in result.stdout
    assert "Sqrt=12" in result.stdout


@pytest.mark.asyncio
async def test_python_code_execution_error_handling():
    code = """
raise ValueError("Intentional test exception")
"""
    result = await execute_code(code, language="python")
    assert result.success is False
    assert result.exit_code != 0
    assert "ValueError: Intentional test exception" in result.stderr


@pytest.mark.asyncio
async def test_python_timeout_protection():
    code = """
import time
time.sleep(5)
"""
    result = await execute_code(code, language="python", timeout=1.0)
    assert result.success is False
    assert "TimeoutError" in (result.error or "") or "timed out" in result.stderr
