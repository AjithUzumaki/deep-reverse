"""
DEEP REVERSE code execution for Python, JavaScript, Java, and C# examples.
"""
import asyncio
import base64
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


@dataclass
class CodeExecutionResult:
    language: str
    code: str
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: float
    success: bool
    error: Optional[str] = None
    output_files: list[str] = field(default_factory=list)
    images: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "language": self.language,
            "code": self.code,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "exit_code": self.exit_code,
            "duration_ms": self.duration_ms,
            "success": self.success,
            "error": self.error,
            "output_files": self.output_files,
            "images": self.images,
        }


async def execute_code(
    code: str,
    language: str = "python",
    timeout: float = 15.0,
    max_output_length: int = 20000,
) -> CodeExecutionResult:
    """
    Execute code in a sandboxed subprocess and return stdout, stderr, and execution metadata.
    """
    lang = language.lower().strip()
    if lang in ("py", "python3"):
        lang = "python"
    elif lang in ("js", "node"):
        lang = "javascript"
    elif lang in ("cs", "c#", "dotnet"):
        lang = "csharp"

    start_time = time.perf_counter()

    if lang == "python":
        return await _execute_python(code, timeout, max_output_length, start_time)
    elif lang == "javascript":
        return await _execute_javascript(code, timeout, max_output_length, start_time)
    elif lang == "java":
        return await _execute_java(code, timeout, max_output_length, start_time)
    elif lang == "csharp":
        return await _execute_csharp(code, timeout, max_output_length, start_time)
    else:
        return CodeExecutionResult(
            language=lang,
            code=code,
            stdout="",
            stderr="",
            exit_code=1,
            duration_ms=0.0,
            success=False,
            error=f"Unsupported execution language: {language}. Supported: python, javascript, java, csharp",
        )


async def _run_command(
    command: list[str],
    timeout: float,
    env: Optional[dict[str, str]] = None,
    cwd: Optional[str] = None,
) -> tuple[bytes, bytes, int, bool]:
    """Run one compiler/runtime command and report whether it timed out."""
    proc = await asyncio.create_subprocess_exec(
        *command,
        cwd=cwd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=max(timeout, 0.1))
        return stdout, stderr, proc.returncode if proc.returncode is not None else 0, False
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        stdout, stderr = await proc.communicate()
        return stdout, stderr, -1, True


def _code_runner_env(temp_dir: str, overrides: Optional[dict[str, str]] = None) -> dict[str, str]:
    """Give user code runtime essentials without inheriting API credentials."""
    secret_markers = (
        "API_KEY", "_KEY", "SECRET", "TOKEN", "PASSWORD", "CREDENTIAL",
        "DATABASE_URL", "REDIS_URL", "CODEX",
    )
    env = {
        key: value for key, value in os.environ.items()
        if not any(marker in key.upper() for marker in secret_markers)
    }
    env.update({
        "TEMP": temp_dir,
        "TMP": temp_dir,
        "APPDATA": str(Path(temp_dir) / "appdata"),
        "LOCALAPPDATA": str(Path(temp_dir) / "local-appdata"),
    })
    if overrides:
        env.update(overrides)
    return env


async def _execute_java(
    code: str,
    timeout: float,
    max_output_length: int,
    start_time: float,
) -> CodeExecutionResult:
    javac = shutil.which("javac")
    java = shutil.which("java")
    if not javac or not java:
        return CodeExecutionResult(
            language="java", code=code, stdout="", stderr="",
            exit_code=1, duration_ms=0.0, success=False,
            error="Java Run Code needs a JDK with both javac and java available on PATH.",
        )

    class_match = re.search(r"\b(?:public\s+)?class\s+([A-Za-z_$][\w$]*)", code)
    main_class = class_match.group(1) if class_match else "Main"
    elapsed_timeout = lambda: max(timeout - (time.perf_counter() - start_time), 0.1)
    with tempfile.TemporaryDirectory(prefix="deep-reverse-java-") as temp_dir:
        source_path = Path(temp_dir) / f"{main_class}.java"
        source_path.write_text(code, encoding="utf-8")
        try:
            _, compile_err, compile_exit, timed_out = await _run_command(
                [javac, "-encoding", "UTF-8", "-d", temp_dir, str(source_path)],
                elapsed_timeout(),
                env=_code_runner_env(temp_dir),
                cwd=temp_dir,
            )
            if timed_out or compile_exit != 0:
                duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
                stderr = "Java compilation timed out." if timed_out else compile_err.decode("utf-8", errors="replace")[:max_output_length]
                return CodeExecutionResult(
                    language="java", code=code, stdout="", stderr=stderr,
                    exit_code=-1 if timed_out else compile_exit, duration_ms=duration_ms,
                    success=False, error=stderr or "Java compilation failed.",
                )

            stdout_bytes, stderr_bytes, exit_code, timed_out = await _run_command(
                [java, "-cp", temp_dir, main_class],
                elapsed_timeout(), env=_code_runner_env(temp_dir), cwd=temp_dir,
            )
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            stdout = stdout_bytes.decode("utf-8", errors="replace")[:max_output_length]
            stderr = stderr_bytes.decode("utf-8", errors="replace")[:max_output_length]
            if timed_out:
                stderr = f"Execution timed out after {timeout} seconds."
            return CodeExecutionResult(
                language="java", code=code, stdout=stdout, stderr=stderr,
                exit_code=-1 if timed_out else exit_code, duration_ms=duration_ms,
                success=(not timed_out and exit_code == 0), error=stderr if timed_out or exit_code != 0 else None,
            )
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            message = f"Could not run Java code: {exc}"
            return CodeExecutionResult(
                language="java", code=code, stdout="", stderr=message,
                exit_code=1, duration_ms=duration_ms, success=False, error=message,
            )


def _find_dotnet() -> Optional[str]:
    configured = os.environ.get("DEEP_REVERSE_DOTNET")
    project_root = Path(__file__).resolve().parents[3]
    candidates = [
        configured,
        str(project_root / ".tools" / "dotnet" / "dotnet.exe"),
        shutil.which("dotnet"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


async def _execute_csharp(
    code: str,
    timeout: float,
    max_output_length: int,
    start_time: float,
) -> CodeExecutionResult:
    dotnet = _find_dotnet()
    if not dotnet:
        return CodeExecutionResult(
            language="csharp", code=code, stdout="", stderr="",
            exit_code=1, duration_ms=0.0, success=False,
            error="C# Run Code needs the .NET SDK. Install the SDK or set DEEP_REVERSE_DOTNET to dotnet.exe.",
        )

    with tempfile.TemporaryDirectory(prefix="deep-reverse-csharp-") as temp_dir:
        temp_path = Path(temp_dir)
        project_path = temp_path / "RunCode.csproj"
        source_path = temp_path / "Program.cs"
        config_path = temp_path / "NuGet.Config"
        output_dir = temp_path / "build"
        project_path.write_text(
            "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup>"
            "<OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework>"
            "<ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>"
            "<RestoreIgnoreFailedSources>true</RestoreIgnoreFailedSources>"
            "</PropertyGroup></Project>",
            encoding="utf-8",
        )
        source_path.write_text(code, encoding="utf-8")
        config_path.write_text(
            '<?xml version="1.0" encoding="utf-8"?><configuration>'
            '<packageSources><clear /></packageSources></configuration>',
            encoding="utf-8",
        )
        command_env = _code_runner_env(temp_dir, {
            "DOTNET_ROOT": str(Path(dotnet).resolve().parent),
            "DOTNET_CLI_HOME": str(temp_path / ".dotnet-home"),
            "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
            "DOTNET_NOLOGO": "1",
            "NUGET_PACKAGES": str(temp_path / "nuget"),
            "APPDATA": str(temp_path / "appdata"),
        })
        remaining = lambda: max(timeout - (time.perf_counter() - start_time), 0.1)
        try:
            restore_out, restore_err, restore_exit, timed_out = await _run_command(
                [dotnet, "restore", str(project_path), "--configfile", str(config_path), "--verbosity", "quiet"],
                remaining(), env=command_env, cwd=temp_dir,
            )
            if timed_out or restore_exit != 0:
                duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
                detail = (restore_err or restore_out).decode("utf-8", errors="replace")[:max_output_length]
                stderr = "C# project setup timed out." if timed_out else detail
                return CodeExecutionResult(
                    language="csharp", code=code, stdout="", stderr=stderr,
                    exit_code=-1 if timed_out else restore_exit, duration_ms=duration_ms,
                    success=False, error=stderr or "C# project setup failed.",
                )

            build_out, build_err, build_exit, timed_out = await _run_command(
                [dotnet, "build", str(project_path), "--no-restore", "--output", str(output_dir), "--verbosity", "quiet", "--nologo"],
                remaining(), env=command_env, cwd=temp_dir,
            )
            if timed_out or build_exit != 0:
                duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
                detail = (build_err or build_out).decode("utf-8", errors="replace")[:max_output_length]
                stderr = "C# compilation timed out." if timed_out else detail
                return CodeExecutionResult(
                    language="csharp", code=code, stdout="", stderr=stderr,
                    exit_code=-1 if timed_out else build_exit, duration_ms=duration_ms,
                    success=False, error=stderr or "C# compilation failed.",
                )

            stdout_bytes, stderr_bytes, exit_code, timed_out = await _run_command(
                [dotnet, str(output_dir / "RunCode.dll")], remaining(), env=command_env, cwd=temp_dir,
            )
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            stdout = stdout_bytes.decode("utf-8", errors="replace")[:max_output_length]
            stderr = stderr_bytes.decode("utf-8", errors="replace")[:max_output_length]
            if timed_out:
                stderr = f"Execution timed out after {timeout} seconds."
            return CodeExecutionResult(
                language="csharp", code=code, stdout=stdout, stderr=stderr,
                exit_code=-1 if timed_out else exit_code, duration_ms=duration_ms,
                success=(not timed_out and exit_code == 0), error=stderr if timed_out or exit_code != 0 else None,
            )
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            message = f"Could not run C# code: {exc}"
            return CodeExecutionResult(
                language="csharp", code=code, stdout="", stderr=message,
                exit_code=1, duration_ms=duration_ms, success=False, error=message,
            )


async def _execute_python(
    code: str,
    timeout: float,
    max_output_length: int,
    start_time: float,
) -> CodeExecutionResult:
    # Capture matplotlib figures so plots are returned to the browser instead
    # of trying to open a desktop window inside the code runner.
    with tempfile.TemporaryDirectory(prefix="deep-reverse-plots-") as plot_dir:
        wrapper_code = f'''# -*- coding: utf-8 -*-
import sys
import io
import math
import json
import statistics
import collections
import itertools
import re
import datetime
import os
from pathlib import Path

_plot_dir = Path(os.environ["DEEP_REVERSE_PLOT_DIR"])
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    def _deep_reverse_show(*args, **kwargs):
        for index, figure_number in enumerate(sorted(plt.get_fignums())[:4], start=1):
            figure = plt.figure(figure_number)
            figure.savefig(_plot_dir / f"plot-{{index}}.png", format="png", dpi=110, bbox_inches="tight")
        plt.close("all")

    plt.show = _deep_reverse_show
except ImportError:
    pass

{code}
'''
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as temp_file:
            temp_file.write(wrapper_code)
            temp_path = temp_file.name

        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                "-u",
                temp_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=_code_runner_env(plot_dir, {
                    "PYTHONUNBUFFERED": "1",
                    "PYTHONDONTWRITEBYTECODE": "1",
                    "MPLBACKEND": "Agg",
                    "MPLCONFIGDIR": plot_dir,
                    "DEEP_REVERSE_PLOT_DIR": plot_dir,
                }),
                cwd=plot_dir,
            )

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=timeout)
                duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
                stdout = stdout_bytes.decode("utf-8", errors="replace")[:max_output_length]
                stderr = stderr_bytes.decode("utf-8", errors="replace")[:max_output_length]
                exit_code = proc.returncode if proc.returncode is not None else 0
                images = []
                for image_path in sorted(Path(plot_dir).glob("plot-*.png"))[:4]:
                    image_bytes = image_path.read_bytes()
                    if len(image_bytes) <= 3 * 1024 * 1024:
                        images.append("data:image/png;base64," + base64.b64encode(image_bytes).decode("ascii"))

                return CodeExecutionResult(
                    language="python",
                    code=code,
                    stdout=stdout,
                    stderr=stderr,
                    exit_code=exit_code,
                    duration_ms=duration_ms,
                    success=(exit_code == 0),
                    error=stderr if exit_code != 0 else None,
                    images=images,
                )
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except Exception:
                    pass
                duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
                return CodeExecutionResult(
                    language="python",
                    code=code,
                    stdout="",
                    stderr=f"Execution timed out after {timeout} seconds.",
                    exit_code=-1,
                    duration_ms=duration_ms,
                    success=False,
                    error=f"TimeoutError: Execution exceeded {timeout}s limit.",
                )
        except Exception as e:
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return CodeExecutionResult(
                language="python",
                code=code,
                stdout="",
                stderr=str(e),
                exit_code=1,
                duration_ms=duration_ms,
                success=False,
                error=str(e),
            )
        finally:
            if os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except Exception:
                    pass


async def _execute_javascript(
    code: str,
    timeout: float,
    max_output_length: int,
    start_time: float,
) -> CodeExecutionResult:
    with tempfile.TemporaryDirectory(prefix="deep-reverse-node-") as temp_dir:
        temp_path = Path(temp_dir) / "run.js"
        temp_path.write_text(code, encoding="utf-8")

        try:
            stdout_bytes, stderr_bytes, exit_code, timed_out = await _run_command(
                ["node", str(temp_path)], timeout,
                env=_code_runner_env(temp_dir), cwd=temp_dir,
            )
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            stdout = stdout_bytes.decode("utf-8", errors="replace")[:max_output_length]
            stderr = stderr_bytes.decode("utf-8", errors="replace")[:max_output_length]
            if timed_out:
                stderr = f"Execution timed out after {timeout} seconds."

            return CodeExecutionResult(
                language="javascript",
                code=code,
                stdout=stdout,
                stderr=stderr,
                exit_code=-1 if timed_out else exit_code,
                duration_ms=duration_ms,
                success=(not timed_out and exit_code == 0),
                error=stderr if timed_out or exit_code != 0 else None,
            )
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return CodeExecutionResult(
                language="javascript", code=code, stdout="", stderr=str(exc),
                exit_code=1, duration_ms=duration_ms, success=False, error=str(exc),
            )
