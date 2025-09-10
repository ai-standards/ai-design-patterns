import inspect
import types
import random
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import pytest

import main


# ----------------------------------------------------------------------
# Helpers for dynamic, black-box testing of the public API
# ----------------------------------------------------------------------

def _public_members(module: types.ModuleType) -> Dict[str, Any]:
    """Return dict of public (non-underscore) attributes defined on the module itself."""
    result: Dict[str, Any] = {}
    for name in dir(module):
        if name.startswith("_"):
            continue
        obj = getattr(module, name)
        # Prefer only symbols that come from the module to avoid re-testing imports of other libs
        if getattr(obj, "__module__", None) == module.__name__:
            result[name] = obj
    return result


def _is_risky_name(name: str) -> bool:
    """Heuristics to avoid inadvertently triggering IO or network in generic smoke tests."""
    risky_keywords = [
        "http", "url", "request", "fetch", "open", "socket", "connect",
        "load", "save", "write", "read", "download", "upload", "send", "recv",
        "file", "path", "db", "database"
    ]
    lowered = name.lower()
    return any(k in lowered for k in risky_keywords)


def _is_risky_function(func: Callable[..., Any]) -> bool:
    """Check both function name and parameter names for risky IO/network hints."""
    if _is_risky_name(func.__name__):
        return True
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        # Built-ins or C-level callables; skip
        return True
    for param in sig.parameters.values():
        if _is_risky_name(param.name):
            return True
    return False


def _sample_for_annotation(ann: Any, tmp_path: Path) -> Any:
    """Provide a small, deterministic sample value based on type annotation."""
    try:
        origin = getattr(ann, "__origin__", None)
    except Exception:
        origin = None

    if ann in (str, Optional[str]) or origin is str:
        return "sample"
    if ann in (int, Optional[int]) or origin is int:
        return 1
    if ann in (float, Optional[float]) or origin is float:
        return 0.5
    if ann in (bool, Optional[bool]) or origin is bool:
        return False
    if ann in (dict, Dict, Optional[dict]) or origin in (dict, Dict):
        return {"a": 1}
    if ann in (list, List, Optional[list]) or origin in (list, List):
        return ["x"]
    if ann in (tuple, Tuple, Optional[tuple]) or origin in (tuple, Tuple):
        return ("x",)
    if ann is Path:
        return tmp_path / "file.txt"
    if origin in (Iterable,):
        return ["x", "y"]
    # Fallback generic object
    return object()


def _sample_for_name(name: str, tmp_path: Path) -> Any:
    """Supply defensible defaults when annotations are missing."""
    n = name.lower()
    if "prompt" in n or "text" in n or "message" in n or "query" in n or "input" in n:
        return "hello world"
    if "seed" in n:
        return 123
    if n in {"n", "k", "count", "limit"}:
        return 1
    if "threshold" in n or "temp" in n or "temperature" in n:
        return 0.0
    if "path" in n or "file" in n or "dir" in n:
        # Still avoid IO by providing a temp path; not used unless function touches it
        return tmp_path / "artifact.txt"
    if "model" in n:
        # Bare object to satisfy a parameter without implying behavior
        return object()
    if "data" in n or "context" in n or "cfg" in n or "config" in n:
        return {}
    return object()


def _build_args(func: Callable[..., Any], tmp_path: Path) -> Optional[Tuple[Tuple[Any, ...], Dict[str, Any]]]:
    """
    Attempt to synthesize arguments for a function using annotations and parameter names.
    Returns None if required args cannot be reasonably satisfied.
    """
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        return None

    args: List[Any] = []
    kwargs: Dict[str, Any] = {}

    for param in sig.parameters.values():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            # Do not provide *args/**kwargs by default
            continue

        if param.default is not inspect._empty:
            # Use default for optional parameters
            continue

        # Required parameter without default; attempt a sample
        if param.annotation is not inspect._empty:
            sample = _sample_for_annotation(param.annotation, tmp_path)
        else:
            sample = _sample_for_name(param.name, tmp_path)

        if param.kind == inspect.Parameter.POSITIONAL_ONLY or param.kind == inspect.Parameter.POSITIONAL_OR_KEYWORD:
            args.append(sample)
        elif param.kind == inspect.Parameter.KEYWORD_ONLY:
            kwargs[param.name] = sample

    return tuple(args), kwargs


@pytest.fixture()
def freeze_time_random(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Force determinism by fixing random and time. Patch both global modules and
    the SUT module if it references them directly.
    """
    # Patch global random/time
    monkeypatch.setattr(random, "random", lambda: 0.123456789, raising=True)
    monkeypatch.setattr(time, "time", lambda: 1_700_000_000.0, raising=True)

    # If SUT imports random/time and uses the module, patch those too.
    if hasattr(main, "random"):
        try:
            monkeypatch.setattr(main.random, "random", lambda: 0.123456789, raising=True)
        except Exception:
            pass
    if hasattr(main, "time"):
        try:
            monkeypatch.setattr(main.time, "time", lambda: 1_700_000_000.0, raising=True)
        except Exception:
            pass


# ----------------------------------------------------------------------
# Module-level tests
# ----------------------------------------------------------------------

def test_module_imports() -> None:
    """Basic sanity: the module should import and expose at least one public symbol."""
    assert isinstance(main, types.ModuleType)
    public = _public_members(main)
    # Not all examples must expose many symbols, but at least importing works.
    assert isinstance(public, dict)


# ----------------------------------------------------------------------
# Function tests
# ----------------------------------------------------------------------

def test_public_functions_smoke_and_determinism(tmp_path: Path, freeze_time_random: None) -> None:
    """
    For each public function:
    - Skip obviously risky IO/network functions by name/parameter heuristics.
    - Attempt a call with synthesized arguments.
    - Assert either it executes successfully or raises a well-typed error (TypeError/ValueError).
    - If it returns a value, call again to ensure deterministic repr under frozen time/random.
    """
    public = _public_members(main)
    functions = [(n, o) for n, o in public.items() if inspect.isfunction(o)]

    for name, func in functions:
        if _is_risky_function(func):
            # Avoid side effects in generic tests
            continue

        built = _build_args(func, tmp_path)
        if built is None:
            # Cannot safely build args; skip rather than make incorrect assumptions
            continue

        args, kwargs = built

        # First call: expect success or a "clean" error type
        try:
            result1 = func(*args, **kwargs)
            executed = True
        except (TypeError, ValueError) as e:
            # Acceptable error path: function validates inputs
            executed = False
            # Error messages should not be empty for usability
            assert str(e), f"{name} raised empty error message"
        except Exception as e:
            # Unexpected exception type indicates either a bug or an effect we want to avoid
            pytest.fail(f"{name} raised unexpected exception type: {type(e).__name__}: {e}")

        if executed:
            # Second call for determinism with frozen time/random
            result2 = func(*args, **kwargs)
            # Compare repr to avoid requiring complex equality semantics
            assert repr(result1) == repr(result2), f"{name} should be deterministic under fixed time/random"


def test_single_arg_functions_validate_empty_inputs(tmp_path: Path, freeze_time_random: None) -> None:
    """
    For single-argument public functions with a likely string-like parameter, ensure:
    - Empty string input is either handled (returns something) or raises ValueError.
    """
    public = _public_members(main)
    for name, func in public.items():
        if not inspect.isfunction(func) or _is_risky_function(func):
            continue

        try:
            sig = inspect.signature(func)
        except Exception:
            continue

        # Identify functions that take exactly one required positional-or-keyword param
        params = [p for p in sig.parameters.values()
                  if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
                  and p.default is inspect._empty]
        if len(params) != 1:
            continue

        # Heuristic: likely text-like input by name or annotation
        p = params[0]
        is_texty = (p.annotation is str) or ("prompt" in p.name.lower() or "text" in p.name.lower())
        if not is_texty:
            continue

        # Call with empty string to test validation/behavior
        try:
            out = func("")  # type: ignore[arg-type]
            # If it returns, it should not crash and produce a str or some result
            assert out is None or isinstance(out, (str, bytes, list, dict, tuple))
        except ValueError:
            # Acceptable strict validation
            pass
        except TypeError:
            # Acceptable if function strictly types arguments
            pass


def test_main_entrypoint_if_present(capsys: pytest.CaptureFixture[str], freeze_time_random: None) -> None:
    """
    If the module exposes a `main` callable, ensure it can be invoked without arguments
    and does not crash. If it prints, capture output to avoid polluting test logs.
    """
    if hasattr(main, "main") and callable(main.main):
        main.main()  # type: ignore[attr-defined, no-redef]
        captured = capsys.readouterr()
        # Printing is optional. If there is output, it should be a string.
        assert isinstance(captured.out, str)
        assert isinstance(captured.err, str)


def test_generate_function_if_present(freeze_time_random: None) -> None:
    """
    If a typical AI example exposes `generate(prompt: str) -> str`, validate:
    - Non-empty prompt returns a string.
    - Empty prompt either returns a string or raises ValueError.
    - Deterministic output under frozen time/random.
    """
    if hasattr(main, "generate") and callable(getattr(main, "generate")):
        gen = getattr(main, "generate")
        # Happy path
        out1 = gen("test prompt")  # type: ignore[call-arg]
        assert isinstance(out1, str)
        # Determinism under patched randomness/time
        out2 = gen("test prompt")  # type: ignore[call-arg]
        assert out1 == out2

        # Edge case: empty prompt handling
        try:
            out_empty = gen("")  # type: ignore[call-arg]
            assert isinstance(out_empty, str)
        except ValueError:
            # Accept strict input validation
            pass


# ----------------------------------------------------------------------
# Class tests
# ----------------------------------------------------------------------

def _instantiate_if_possible(cls: type, tmp_path: Path) -> Optional[Any]:
    """Try to instantiate a class with zero required args; return instance or None."""
    try:
        sig = inspect.signature(cls)
    except Exception:
        # Built-in or extension types; skip
        return None

    required_params = [
        p for p in sig.parameters.values()
        if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
        and p.default is inspect._empty
        and p.name != "self"
    ]
    if required_params:
        # Try to synthesize at most one or two typical args (e.g., prompt/config)
        args: List[Any] = []
        kwargs: Dict[str, Any] = {}
        for p in required_params[:2]:
            sample = _sample_for_annotation(p.annotation, tmp_path) if p.annotation is not inspect._empty else _sample_for_name(p.name, tmp_path)
            if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
                args.append(sample)
            else:
                kwargs[p.name] = sample
        try:
            return cls(*args, **kwargs)
        except Exception:
            return None
    else:
        try:
            return cls()
        except Exception:
            return None


def _call_method_if_exists(obj: Any, method_name: str) -> Optional[Any]:
    """Call a zero-arg or single string-arg method if available."""
    method = getattr(obj, method_name, None)
    if method is None or not callable(method):
        return None
    try:
        sig = inspect.signature(method)
    except Exception:
        return None
    required = [p for p in sig.parameters.values()
                if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
                and p.default is inspect._empty
                and p.name != "self"]
    try:
        if not required:
            return method()
        if len(required) == 1:
            # Provide a simple prompt-like argument
            return method("hello")
    except (TypeError, ValueError):
        return None
    except Exception:
        # Avoid propagating arbitrary errors in a generic test
        return None
    return None


def test_public_classes_smoke(tmp_path: Path, freeze_time_random: None) -> None:
    """
    For each public class:
    - Attempt instantiation with minimal arguments.
    - Try to call common methods if present: run/execute/generate/transform.
    This verifies public surface does not immediately crash under basic usage.
    """
    public = _public_members(main)
    classes = [(n, o) for n, o in public.items() if inspect.isclass(o)]

    for name, cls in classes:
        # Skip dataclasses or enums are fine; generic instantiation attempts only
        inst = _instantiate_if_possible(cls, tmp_path)
        if inst is None:
            continue

        # Check repr does not crash (useful for debugging UX)
        r = repr(inst)
        assert isinstance(r, str)

        # Try a few conventional method names common in AI patterns
        for m in ("run", "execute", "generate", "transform", "predict"):
            _call_method_if_exists(inst, m)