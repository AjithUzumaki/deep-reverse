"""
Tools API Router for DEEP REVERSE:
Provides sandboxed code execution, math problem solving, and data analytics endpoints.
"""
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from apps.api.core.deps import get_current_user
from packages.ai_core.tools.code_executor import execute_code
from packages.ai_core.tools.data_analyzer import analyze_data
from packages.ai_core.tools.math_solver import solve_math_problem
from packages.db.models import User

router = APIRouter(prefix="/tools", tags=["tools"])


class ExecuteCodeRequest(BaseModel):
    code: str = Field(..., min_length=1, description="Source code to execute")
    language: str = Field(default="python", description="Programming language (python, javascript, java, csharp)")
    timeout: float = Field(default=15.0, ge=1.0, le=60.0, description="Execution timeout in seconds")


class SolveMathRequest(BaseModel):
    problem: str = Field(..., min_length=1, description="Mathematical equation or problem")
    category: str = Field(default="general", description="Math category")


class AnalyzeDataRequest(BaseModel):
    data: Any = Field(..., description="CSV string or JSON array of records")
    format: str = Field(default="auto", description="Data format")


@router.post("/execute-code")
async def handle_execute_code(
    body: ExecuteCodeRequest,
    user: User = Depends(get_current_user),
):
    """
    Execute sandboxed code in real-time and return stdout, stderr, exit code, and execution time.
    """
    result = await execute_code(
        code=body.code,
        language=body.language,
        timeout=body.timeout,
    )
    return result.to_dict()


@router.post("/solve-math")
async def handle_solve_math(
    body: SolveMathRequest,
    user: User = Depends(get_current_user),
):
    """
    Solve a mathematical problem with computational verification and step-by-step LaTeX derivation.
    """
    result = await solve_math_problem(
        problem=body.problem,
        category=body.category,
    )
    return result.to_dict()


@router.post("/analyze-data")
async def handle_analyze_data(
    body: AnalyzeDataRequest,
    user: User = Depends(get_current_user),
):
    """
    Analyze tabular dataset and return descriptive statistics, column summaries, and markdown tables.
    """
    result = await analyze_data(
        data=body.data,
        format=body.format,
    )
    return result.to_dict()
