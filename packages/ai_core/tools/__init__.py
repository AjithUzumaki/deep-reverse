"""
Tools module for DEEP REVERSE:
- code_executor: Sandboxed code runner (Python, JavaScript)
- math_solver: Step-by-step mathematical reasoning and calculus
- data_analyzer: Tabular dataset analytics & statistics
- image_generator: Text-to-image generator with style presets
"""
from packages.ai_core.tools.code_executor import CodeExecutionResult, execute_code
from packages.ai_core.tools.math_solver import MathProblemResult, solve_math_problem
from packages.ai_core.tools.data_analyzer import DataAnalysisResult, analyze_data
from packages.ai_core.tools.image_generator import ImageGenerationResult, generate_image

__all__ = [
    "CodeExecutionResult",
    "execute_code",
    "MathProblemResult",
    "solve_math_problem",
    "DataAnalysisResult",
    "analyze_data",
    "ImageGenerationResult",
    "generate_image",
]
