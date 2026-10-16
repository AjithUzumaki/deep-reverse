import pytest
from packages.ai_core.tools.data_analyzer import analyze_data
from packages.ai_core.tools.math_solver import solve_math_problem


@pytest.mark.asyncio
async def test_solve_math_arithmetic_and_latex():
    problem = "25 * 4 + 150 / 3"
    result = await solve_math_problem(problem)
    assert result.verified is True
    assert result.numeric_value == 150
    assert "150" in result.solution
    assert len(result.steps) >= 2
    assert "$$" in result.latex_solution


@pytest.mark.asyncio
async def test_data_analysis_csv():
    csv_data = """Product,Revenue,Cost,Units
Alpha,1000,600,10
Beta,2000,1200,20
Gamma,3000,1800,30
Delta,4000,2400,40
"""
    result = await analyze_data(csv_data)
    assert result.error is None
    assert result.row_count == 4
    assert result.column_count == 4
    assert "Revenue" in result.columns
    assert "| Product | Revenue | Cost | Units |" in result.markdown_table
    assert len(result.column_summaries) == 4

    # Check numeric stats for Revenue
    revenue_summary = next(s for s in result.column_summaries if s["name"] == "Revenue")
    assert revenue_summary["dtype"] == "numeric"
    assert revenue_summary["stats"]["mean"] == 2500.0
    assert revenue_summary["stats"]["min"] == 1000.0
    assert revenue_summary["stats"]["max"] == 4000.0


@pytest.mark.asyncio
async def test_data_analysis_json():
    json_records = [
        {"user": "alice", "score": 95},
        {"user": "bob", "score": 85},
        {"user": "charlie", "score": 90},
    ]
    result = await analyze_data(json_records)
    assert result.error is None
    assert result.row_count == 3
    assert "score" in result.columns
    score_summary = next(s for s in result.column_summaries if s["name"] == "score")
    assert score_summary["stats"]["mean"] == 90.0
