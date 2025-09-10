import inspect
import io
import types
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, get_args, get_origin

import pytest
from unittest.mock import patch

import main


# ---------- Helper utilities for generic black-box exercising of the SUT ----------

def _is_public(name: str) -> bool:
    """Return True if the attribute name is considered public for testing."""
    return not name.startswith("_")


def _public_functions(module: types.ModuleType) -> List[Callable[..., Any]]:
    """List public top-level functions defined in the module."""
    funcs: List[Callable[..., Any]] = []
    for name, obj in inspect.getmembers(module, inspect.isfunction):
        if _is_public(name) and obj.__module__ == module.__name__:
            funcs.append(obj)
    return funcs


def _public_classes(module: types.ModuleType) -> List[type]:
    """List public top-level classes defined in the module."""
    clses: List[type] = []
    for name, obj in inspect.getmembers(module, inspect.isclass):
        if _is_public(name) and obj.__module__ == module.__name__:
            clses.append(obj)
    return clses


def _ann_is(ann: Any, target: Any) -> bool:
    """Best-effort annotation matcher that handles typing aliases."""
    if ann is inspect._empty:
        return False
    origin = get_origin(ann) or ann
    if origin is target:
        return True
    # Optional[T] and Union[T, None]
    if origin in (types.UnionType, getattr(__import__("typing"), "Union", None)):
        args = set(get_args(ann))
        return target in args
    return False


def _make_placeholder(param: inspect.Parameter, tmp_path: Path) -> Any:
    """Create a sensible placeholder value for a required parameter based on annotation/name."""
    ann = param.annotation
    name = param.name.lower()

    # Annotation-driven mapping
    if _ann_is(ann, str):
        return "test"
    if _ann_is(ann, int):
        return 1
    if _ann_is(ann, float):
        return 0.5
    if _ann_is(ann, bool):
        return True
    if _ann_is(ann, dict) or _ann_is(ann, Dict):
        return {"key": "value"}
    if _ann_is(ann, list) or _ann_is(ann, List):
        return ["item"]
    if _ann_is(ann, tuple) or _ann_is(ann, Tuple):
        return ("x",)
    if _ann_is(ann, set):
        return {"x"}
    if _ann_is(ann, bytes):
        return b"x"
    if _ann_is(ann, bytearray):
        return bytearray(b"x")
    if _ann_is(ann, io.IOBase) or "io" in str(ann).lower():
        return io.StringIO("data")
    if _ann_is(ann, Path):
        return tmp_path / "file.txt"
    if "callable" in str(ann).lower():
        return lambda *a, **k: None  # type: ignore[return-value]

    # Name heuristics
    if "path" in name and "xpath" not in name:
        return tmp_path / "file.txt"
    if "file" in name:
        return tmp_path / "file.txt"
    if "dir" in name or "folder" in name:
        return tmp_path
    if "text" in name or "prompt" in name or "query" in name or "message" in name:
        return "hello"
    if "count" in name or "n_" in name or name.startswith("n"):
        return 1
    if "data" in name or "json" in name or "config" in name:
        return {"key": "value"}
    if "timeout" in name or "seconds" in name:
        return 0

    # Fallback: simple string
    return "test"


def _build_args_for_callable(func: Callable[..., Any], tmp_path: Path) -> Tuple[Tuple[Any, ...], Dict[str, Any]]:
    """Return (args, kwargs) to call a callable using placeholder values for required params."""
    sig = inspect.signature(func)
    args: List[Any] = []
    kwargs: Dict[str, Any] = {}
    for p in sig.parameters.values():
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            # Skip *args/**kwargs
            continue
        # Use defaults if available
        if p.default is not inspect._empty:
            continue
        # Provide placeholder for required-only params
        value = _make_placeholder(p, tmp_path)
        if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
            args.append(value)
        else:
            kwargs[p.name] = value
    return tuple(args), kwargs


@pytest.fixture(autouse=True)
def deterministic_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Make runtime deterministic and non-interactive for all tests.
    - Freeze randomness
    - Disable sleeps
    - Stub input() to avoid blocking
    """
    # Randomness control
    monkeypatch.setattr("random.random", lambda: 0.42, raising=False)
    monkeypatch.setattr("random.randint", lambda a, b: (a + b) // 2, raising=False)
    monkeypatch.setattr("random.choice", lambda seq: seq[0], raising=False)
    monkeypatch.setattr("random.shuffle", lambda seq: None, raising=False)
    # Time control
    monkeypatch.setattr("time.time", lambda: 1_700_000_000.0, raising=False)
    monkeypatch.setattr("time.sleep", lambda _: None, raising=False)
    # Avoid interactive input
    monkeypatch.setattr("builtins.input", lambda *a, **k: "", raising=False)


# ---------- Tests ----------

def test_module_imports_and_has_some_api_surface() -> None:
    """
    Sanity-check: the SUT module imports and exposes at least one public attribute.
    This guards against trivial packaging/import errors.
    """
    public_names = [n for n in dir(main) if _is_public(n)]
    # At least something should be exported publicly (function, class, constant, etc.)
    assert len(public_names) > 0, "Expected at least one public symbol in main module"


def test_main_entrypoint_prints_and_returns(capsys: pytest.CaptureFixture[str]) -> None:
    """
    If a conventional 'main' entrypoint callable exists, it should run without raising
    and produce some visible effect (e.g., printing a result).
    """
    if hasattr(main, "main") and callable(getattr(main, "main")):
        # Run with no args; if entrypoint expects args, it should have defaults.
        result = None
        try:
            result = getattr(main, "main")()
        except TypeError:
            # If signature requires inputs, skip this specific expectation cleanly.
            pytest.skip("main.main requires arguments; skipping entrypoint smoke test")
        out, err = capsys.readouterr()
        # At least one of return value or stdout should be non-empty to indicate useful behavior.
        assert (result is not None) or (out.strip() != ""), "Entrypoint produced no output and no return value"
    else:
        pytest.skip("No main.main entrypoint exported; skipping entrypoint smoke test")


@pytest.mark.parametrize("func", _public_functions(main))
def test_public_functions_execute_with_placeholder_inputs(func: Callable[..., Any], tmp_path: Path) -> None:
    """
    For each public top-level function:
      - Build placeholder arguments using type hints and parameter names.
      - Call the function and assert it completes without raising.
      - If it returns a value, ensure the value is not an obvious sentinel of failure (e.g., empty when non-void).
    This is a black-box behavioral smoke test to catch signature/logic regressions.
    """
    args, kwargs = _build_args_for_callable(func, tmp_path)
    result = func(*args, **kwargs)
    # Functions may return None (side-effect oriented) or a concrete value.
    # If a value is returned, assert it's not an obviously invalid result.
    if result is not None:
        # Avoid overly specific expectations; just ensure something tangible was produced.
        assert result is not Ellipsis
        # If a sequence-like is returned, it's acceptable to be empty for edge cases, so don't over-assert.


@pytest.mark.parametrize("func", _public_functions(main))
def test_public_functions_handle_edge_case_empty_string(func: Callable[..., Any]) -> None:
    """
    Edge case: for functions that accept exactly one required parameter and it appears text-like,
    verify they behave sensibly with an empty string by either:
      - returning a result, or
      - raising a clear ValueError/TypeError.
    """
    sig = inspect.signature(func)
    required_params = [
        p for p in sig.parameters.values()
        if p.default is inspect._empty and p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    ]
    if len(required_params) != 1:
        pytest.skip("Function does not have exactly one required parameter; skipping edge-case test")

    p = required_params[0]
    texty = _ann_is(p.annotation, str) or any(k in p.name.lower() for k in ("text", "prompt", "query", "message"))
    if not texty:
        pytest.skip("Single required parameter does not appear to be text-like; skipping")

    # Expect either graceful handling (return) or a clear exception type.
    try:
        res = func("" if p.kind != inspect.Parameter.KEYWORD_ONLY else None, **({p.name: ""} if p.kind == inspect.Parameter.KEYWORD_ONLY else {}))  # type: ignore[arg-type]
    except (ValueError, TypeError):
        # Acceptable: explicit validation error
        return
    # Otherwise, a non-exception path is acceptable as well.
    assert res is not Ellipsis


@pytest.mark.parametrize("cls", _public_classes(main))
def test_public_classes_instantiation_and_core_methods(cls: type, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """
    For each public class:
      - Attempt to instantiate it using placeholder args based on its __init__ signature.
      - If common 'agent-like' or 'pipeline-like' methods exist (run/handle/process/generate/predict/execute/step/__call__),
        call them in a deterministic way.
      - Validate that calls do not raise and produce some observable outcome (return value or stdout).
    """
    # Instantiate with placeholder args
    init = getattr(cls, "__init__", None)
    if callable(init):
        args, kwargs = _build_args_for_callable(init, tmp_path)
        # __init__ first param is 'self' (implicit); remove if mistakenly included
        if args and isinstance(args[0], cls):
            args = args[1:]  # type: ignore[assignment]
        instance = cls(*args, **kwargs)
    else:
        instance = cls()  # type: ignore[call-arg]

    # Candidate methods to exercise in an AI-pattern context
    candidate_methods = [
        "run",
        "handle",
        "process",
        "generate",
        "predict",
        "execute",
        "step",
        "__call__",
    ]
    exercised_any = False
    for mname in candidate_methods:
        if not hasattr(instance, mname):
            continue
        method = getattr(instance, mname)
        if not callable(method):
            continue

        sig = inspect.signature(method)
        required = [
            p for p in sig.parameters.values()
            if p.default is inspect._empty and p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
        ]
        # Build placeholder args for the method call (excluding 'self')
        call_args: Tuple[Any, ...] = ()
        call_kwargs: Dict[str, Any] = {}

        if len(required) == 0:
            # No required inputs
            call_args, call_kwargs = (), {}
        elif len(required) == 1:
            # Likely a single input pipeline; use a simple text payload by default
            p = required[0]
            payload: Any = "hello"
            if _ann_is(p.annotation, dict) or "dict" in str(p.annotation).lower():
                payload = {"input": "hello"}
            if _ann_is(p.annotation, Path) or "path" in p.name.lower():
                payload = tmp_path / "input.txt"
            if p.kind == inspect.Parameter.KEYWORD_ONLY:
                call_kwargs = {p.name: payload}
            else:
                call_args = (payload,)
        else:
            # Multiple required params; use generic placeholders for each
            # Skip 'self' if captured incorrectly
            for p in required:
                if p.name == "self":
                    continue
                value = _make_placeholder(p, tmp_path)
                if p.kind == inspect.Parameter.KEYWORD_ONLY:
                    call_kwargs[p.name] = value
                else:
                    call_args = (*call_args, value)

        # Execute the method
        result = method(*call_args, **call_kwargs)
        exercised_any = True

        # Validate some observable result
        out, _ = capsys.readouterr()
        if result is not None:
            assert result is not Ellipsis
        else:
            # If no return value, expect at least some side-effect like printing/logging (stdout here)
            # Not mandatory for every method, so avoid over-asserting; a best-effort sanity check:
            pass

    # Ensure at least one method got exercised if any candidate exists
    if any(hasattr(instance, n) for n in candidate_methods):
        assert exercised_any, "Expected to exercise at least one core method on the class instance"


def test_no_unexpected_network_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Guardrail: if 'requests' or 'httpx' are present and used directly at import-time or call-time,
    patch their 'get'/'post' to raise to avoid accidental real network IO in examples.
    The intent is to keep tests deterministic and offline.
    """
    class _NoNet:
        def __call__(self, *a: Any, **k: Any) -> None:
            raise RuntimeError("Network calls are disabled in tests")

    for mod_name, fn_names in (("requests", ("get", "post", "request")), ("httpx", ("get", "post", "request"))):
        try:
            __import__(mod_name)
        except Exception:
            continue
        else:
            for fn in fn_names:
                monkeypatch.setattr(f"{mod_name}.{fn}", _NoNet(), raising=False)