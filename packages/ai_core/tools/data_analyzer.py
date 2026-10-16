"""
Data analytics engine for DEEP REVERSE.
Performs descriptive statistics, correlation analysis, distributions, and tabular summaries.
"""
import csv
import io
import json
import math
import statistics
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ColumnSummary:
    name: str
    dtype: str
    count: int
    null_count: int
    unique_count: int
    stats: dict[str, Any] = field(default_factory=dict)


@dataclass
class DataAnalysisResult:
    row_count: int
    column_count: int
    columns: list[str]
    column_summaries: list[dict[str, Any]]
    sample_rows: list[dict[str, Any]]
    markdown_table: str
    insights: list[str] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "row_count": self.row_count,
            "column_count": self.column_count,
            "columns": self.columns,
            "column_summaries": self.column_summaries,
            "sample_rows": self.sample_rows,
            "markdown_table": self.markdown_table,
            "insights": self.insights,
            "error": self.error,
        }


def _try_parse_number(val: Any) -> Optional[float]:
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


async def analyze_data(
    data: str | list[dict[str, Any]],
    format: str = "auto",
) -> DataAnalysisResult:
    """
    Ingests CSV string or JSON records and generates descriptive stats, data profiles, and markdown tables.
    """
    rows: list[dict[str, Any]] = []

    try:
        if isinstance(data, list):
            rows = data
        elif isinstance(data, str):
            trimmed = data.strip()
            if trimmed.startswith("[") and trimmed.endswith("]"):
                rows = json.loads(trimmed)
            else:
                # Parse as CSV
                reader = csv.DictReader(io.StringIO(trimmed))
                rows = [row for row in reader]
    except Exception as e:
        return DataAnalysisResult(
            row_count=0,
            column_count=0,
            columns=[],
            column_summaries=[],
            sample_rows=[],
            markdown_table="",
            insights=[],
            error=f"Failed to parse data: {e}",
        )

    if not rows:
        return DataAnalysisResult(
            row_count=0,
            column_count=0,
            columns=[],
            column_summaries=[],
            sample_rows=[],
            markdown_table="",
            insights=["Dataset is empty."],
            error=None,
        )

    columns = list(rows[0].keys())
    row_count = len(rows)
    column_summaries = []
    insights = []

    for col in columns:
        vals = [r.get(col) for r in rows]
        null_count = sum(1 for v in vals if v is None or v == "")
        non_null_vals = [v for v in vals if v is not None and v != ""]
        unique_count = len(set(non_null_vals))

        # Check if numeric
        num_vals = []
        for v in non_null_vals:
            parsed = _try_parse_number(v)
            if parsed is not None:
                num_vals.append(parsed)

        is_numeric = len(num_vals) > 0 and (len(num_vals) == len(non_null_vals))

        if is_numeric and num_vals:
            avg = statistics.mean(num_vals)
            med = statistics.median(num_vals)
            stdev = statistics.stdev(num_vals) if len(num_vals) > 1 else 0.0
            min_v = min(num_vals)
            max_v = max(num_vals)
            summary = ColumnSummary(
                name=col,
                dtype="numeric",
                count=len(num_vals),
                null_count=null_count,
                unique_count=unique_count,
                stats={
                    "mean": round(avg, 3),
                    "median": round(med, 3),
                    "stdev": round(stdev, 3),
                    "min": min_v,
                    "max": max_v,
                    "sum": round(sum(num_vals), 3),
                },
            )
            insights.append(f"Column '{col}' ranges from {min_v} to {max_v} with a mean of {avg:.2f}.")
        else:
            summary = ColumnSummary(
                name=col,
                dtype="categorical/text",
                count=len(non_null_vals),
                null_count=null_count,
                unique_count=unique_count,
                stats={"unique_values": unique_count},
            )
            if unique_count == row_count:
                insights.append(f"Column '{col}' has distinct values for every row (potential identifier).")

        column_summaries.append(summary.__dict__)

    # Generate Markdown Table for first 5 sample rows
    headers = " | ".join(columns)
    separators = " | ".join(["---"] * len(columns))
    row_lines = []
    for r in rows[:5]:
        row_lines.append(" | ".join(str(r.get(c, "")) for c in columns))
    markdown_table = f"| {headers} |\n| {separators} |\n" + "\n".join(f"| {l} |" for l in row_lines)

    return DataAnalysisResult(
        row_count=row_count,
        column_count=len(columns),
        columns=columns,
        column_summaries=column_summaries,
        sample_rows=rows[:10],
        markdown_table=markdown_table,
        insights=insights,
        error=None,
    )
