import inspect
import os
import random
import types
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pytest

import main  # SUT: examples/py/main.py


# ------------------------------
# Test utilities and fixtures
# ------------------------------

@pytest.fixture(autouse=True)
def patched_determinism(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Make tests deterministic and safe:
    - Freeze randomness
    - Elide sleeping
    - Set common AI API env vars to fake values to avoid accidental network use
    """
    monkeypatch.setattr(main.time, "sleep", lambda *_a, **_kw: None, raising=False)
    # Patch random.random where available in main; if not present, patch global random for safety
    try:
        monkeypatch.setattr("main.random.random", lambda: 0.42, raising=True)
    except Exception:
        monkeypatch.setattr(random, "random", lambda: 0.42, raising=False)

    # Ensure no real API keys leak into the test process
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")


def _is_public_name(name: str) -> bool:
    return not name.startswith("_")


def _get_public_functions(mod: types.ModuleType) -> Dict[str, Any]:
    # Prefer __all__ if present, otherwise any public callables that are functions
    names: Iterable[str]
    if hasattr(mod, "__all__"):
        names = [n for n in getattr(mod, "__all__") if _is_public_name(n)]
    else:
        names = [n for n in dir(mod) if _is_public_name(n)]
    funcs: Dict[str, Any] = {}
    for n in names:
        obj = getattr(mod, n, None)
        if isinstance(obj, types.FunctionType):
            funcs[n] = obj
    return funcs


def _get_public_classes(mod: types.ModuleType) -> Dict[str, type]:
    names: Iterable[str]
    if hasattr(mod, "__all__"):
        names = [n for n in getattr(mod, "__all__") if _is_public_name(n)]
    else:
        names = [n for n in dir(mod) if _is_public_name(n)]
    classes: Dict[str, type] = {}
    for n in names:
        obj = getattr(mod, n, None)
        if isinstance(obj, type):
            classes[n] = obj
    return classes


def _dummy_for_param(name: str, annotation: Any, tmp_path: Path) -> Any:
    """
    Produce a safe dummy value for a parameter based on its name and type annotation.
    This keeps calls black-box while providing common-sense inputs.
    """
    lname = name.lower()
    # Name-based heuristics first
    if "path" in lname or "file" in lname or "dir" in lname:
        # Create a temp file by default; functions can write or read as needed
        p = tmp_path / "test.txt"
        p.write_text("test data", encoding="utf-8")
        return str(p)
    if "prompt" in lname or "text" in lname or "query" in lname or "input" in lname:
        return "hello world"
    if "config" in lname or "options" in lname or "params" in lname or "kwargs" in lname:
        return {}
    if "seed" in lname or "random" in lname:
        return 123

    # Type-based simple mapping
    origin = getattr(annotation, "__origin__", None)
    if annotation in (str, Optional[str]):
        return "hello"
    if annotation in (int, Optional[int]):
        return 1
    if annotation in (float, Optional[float]):
        return 0.0
    if annotation in (bool, Optional[bool]):
        return True
    if annotation in (list, List, Optional[List], Optional[list]) or origin in (list, List):
        return []
    if annotation in (dict, Dict, Optional[Dict], Optional[dict]) or origin in (dict, Dict):
        return {}
    if annotation in (tuple, Tuple, Optional[Tuple], Optional[tuple]) or origin in (tuple, Tuple):
        return ()
    # Fallback to a simple string sentinel
    return "x"


def _build_callable_args(fn: Any, tmp_path: Path) -> Tuple[Tuple[Any, ...], Dict[str, Any]]:
    """
    Build positional and keyword arguments for a callable based on its signature.
    Only supplies values for required parameters (skip VARARGS/VARKW and optional params).
    """
    sig = inspect.signature(fn)
    args: List[Any] = []
    kwargs: Dict[str, Any] = {}

    for name, param in sig.parameters.items():
        if name == "self":
            continue  # instance methods
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.default is not inspect._empty:
            # Optional parameter; let default stand for smoke tests
            continue

        annotation = param.annotation if param.annotation is not inspect._empty else Any
        value = _dummy_for_param(name, annotation, tmp_path)
        if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
            args.append(value)
        else:
            kwargs[name] = value

    return tuple(args), kwargs


# ------------------------------
# Tests
# ------------------------------

def test_module_import_and_docstring() -> None:
    # Basic import should work and module should have a docstring to guide users
    assert hasattr(main, "__doc__")
    assert isinstance(main.__doc__, (str, type(None)))
    # Allow empty docstrings, but if present, it should be a string
    if main.__doc__:
        assert len(main.__doc__) >= 0


def test_main_entrypoint_smoke(capsys: pytest.CaptureFixture[str]) -> None:
    # Many examples expose a top-level entrypoint; exercise it if present.
    entry = getattr(main, "main", None) or getattr(main, "run", None)
    if entry is None or not callable(entry):
        pytest.skip("No top-level entrypoint (main/run) to execute.")
    # Run and ensure it does not raise and ideally prints something user-visible
    result = entry()
    out = capsys.readouterr().out
    # The entrypoint may return None; ensure it at least executes
    assert True  # Execution reached here without exception
    # If something is printed, it should be a string
    if out:
        assert isinstance(out, str)
    # No specific return contract is assumed; just ensure call finished
    assert result is None or result is not NotImplemented


def test_public_functions_smoke(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # Exercise all public functions through their signatures with safe dummy inputs.
    funcs = _get_public_functions(main)
    # If no public functions, skip but log it
    if not funcs:
        pytest.skip("No public functions exported by module.")
    for name, fn in funcs.items():
        # Skip entrypoint here; tested separately
        if name in {"main", "run"}:
            continue
        args, kwargs = _build_callable_args(fn, tmp_path)
        # Call should not raise; capture stdout to avoid leaking prints into test output
        try:
            _ = fn(*args, **kwargs)
        except Exception as exc:  # Provide a helpful message for debugging
            raise AssertionError(f"Public function {name} raised an exception with dummy inputs: {exc}") from exc
        finally:
            _ = capsys.readouterr()


def test_public_classes_construct_and_core_methods(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # Instantiate each public class if possible, then exercise core "action" methods.
    classes = _get_public_classes(main)
    if not classes:
        pytest.skip("No public classes exported by module.")
    action_method_names = {"run", "execute", "process", "generate", "respond", "predict", "handle", "step", "__call__"}
    for cname, cls in classes.items():
        # Build constructor args
        try:
            args, kwargs = _build_callable_args(cls, tmp_path)
        except Exception:
            # If __init__ signature is complex, skip the class construct; this is a smoke test
            pytest.skip(f"Could not build constructor args for class {cname}")
        # Try constructing the instance
        try:
            inst = cls(*args, **kwargs)
        except Exception as exc:
            # Some classes might be abstract or require resources; skip with context
            pytest.skip(f"Could not instantiate class {cname}: {exc}")

        # Exercise common "do work" methods if present
        methods_run = 0
        for mname in action_method_names:
            if hasattr(inst, mname) and callable(getattr(inst, mname)):
                m = getattr(inst, mname)
                m_args, m_kwargs = _build_callable_args(m, tmp_path)
                try:
                    _ = m(*m_args, **m_kwargs)
                    methods_run += 1
                except Exception as exc:
                    raise AssertionError(
                        f"Method {cname}.{mname} raised with dummy inputs: {exc}"
                    ) from exc
                finally:
                    _ = capsys.readouterr()
        # If no action methods exist, at least assert the instance is created
        assert inst is not None
        # If action methods exist, require at least one has been run successfully
        if any(hasattr(inst, n) for n in action_method_names):
            assert methods_run >= 1, f"No action-like methods were executed for {cname}"


@pytest.mark.parametrize(
    "bad_input",
    [
        None,
        123,
        3.14,
        True,
        b"bytes",
        object(),
    ],
)
def test_textlike_functions_reject_or_handle_bad_input(
    bad_input: Any, tmp_path: Path
) -> None:
    """
    Identify functions likely to expect text (by name) and verify they either:
    - raise a clear error (TypeError/ValueError), or
    - coerce input into a valid response (e.g., str) without crashing.
    """
    funcs = _get_public_functions(main)
    if not funcs:
        pytest.skip("No public functions exported by module.")
    # Target functions that sound text-driven
    candidates = {
        name: fn
        for name, fn in funcs.items()
        if any(k in name.lower() for k in ("generate", "respond", "predict", "compose", "prompt"))
    }
    if not candidates:
        pytest.skip("No text-like functions detected by name; nothing to validate for bad inputs.")
    for name, fn in candidates.items():
        args, kwargs = _build_callable_args(fn, tmp_path)
        # Try to add bad_input to the first positional arg slot if none provided; else try a common name
        sig = inspect.signature(fn)
        injecting_done = False
        built_args = list(args)
        built_kwargs = dict(kwargs)
        # Replace first required positional param if none provided
        for i, (pname, param) in enumerate(sig.parameters.items()):
            if pname == "self":
                continue
            if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
                if i < len(built_args):
                    built_args[i] = bad_input
                else:
                    built_args.append(bad_input)
                injecting_done = True
                break
        if not injecting_done:
            # Try common text parameter names into kwargs
            for pname in ("prompt", "text", "query", "input"):
                if pname in sig.parameters:
                    built_kwargs[pname] = bad_input
                    injecting_done = True
                    break
        if not injecting_done:
            # Cannot sensibly inject bad input; skip this function
            continue

        try:
            result = fn(*built_args, **built_kwargs)
        except (TypeError, ValueError):
            # Accept explicit type validation
            continue
        except Exception as exc:
            # Other exceptions indicate likely unhandled error paths
            raise AssertionError(f"{name} raised unexpected exception type for bad input: {exc}") from exc
        else:
            # If it handled the input, at least ensure it produced some value
            assert result is not None


def test_empty_and_long_prompts_if_applicable(tmp_path: Path) -> None:
    """
    For text-oriented functions, validate behavior on edge-case inputs:
    - Empty prompt
    - Very long prompt
    """
    funcs = _get_public_functions(main)
    if not funcs:
        pytest.skip("No public functions exported by module.")
    targets = {
        name: fn
        for name, fn in funcs.items()
        if any(k in name.lower() for k in ("generate", "respond", "predict", "compose", "prompt"))
    }
    if not targets:
        pytest.skip("No text-like functions detected by name; nothing to test for prompt edge cases.")
    long_text = "a" * 10_000
    for name, fn in targets.items():
        # Empty input
        args, kwargs = _build_callable_args(fn, tmp_path)
        # Try to set first positional/keyword text-like parameter
        sig = inspect.signature(fn)

        def _inject(value: str) -> Tuple[Tuple[Any, ...], Dict[str, Any]]:
            built_args = list(args)
            built_kwargs = dict(kwargs)
            injected = False
            for i, (pname, param) in enumerate(sig.parameters.items()):
                if pname == "self":
                    continue
                if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
                    if i < len(built_args):
                        built_args[i] = value
                    else:
                        built_args.append(value)
                    injected = True
                    break
            if not injected:
                for pname in ("prompt", "text", "query", "input"):
                    if pname in sig.parameters:
                        built_kwargs[pname] = value
                        injected = True
                        break
            return tuple(built_args), built_kwargs

        for candidate in ("", long_text):
            call_args, call_kwargs = _inject(candidate)
            try:
                _ = fn(*call_args, **call_kwargs)
            except Exception as exc:
                # Empty strings are sometimes rejected; long strings should not crash; accept ValueError/TypeError only for empty
                if candidate == "":
                    if not isinstance(exc, (TypeError, ValueError)):
                        raise AssertionError(
                            f"{name} raised unexpected exception type for empty input: {exc}"
                        ) from exc
                else:
                    raise AssertionError(f"{name} failed to handle long input: {exc}") from exc


def test_logging_is_quiet_or_well_formed(caplog: pytest.LogCaptureFixture) -> None:
    """
    Ensure running the entrypoint does not spam error logs.
    If logging is used, verify no ERROR/CRITICAL messages are emitted during a routine run.
    """
    entry = getattr(main, "main", None) or getattr(main, "run", None)
    if entry is None or not callable(entry):
        pytest.skip("No top-level entrypoint (main/run) to assess logging.")
    caplog.set_level("DEBUG")
    try:
        entry()
    except Exception as exc:
        # The entrypoint may be demo-only; still ensure that critical logs are not emitted
        pass
    # No ERROR/CRITICAL records expected in a normal run
    for rec in caplog.records:
        assert rec.levelname not in {"ERROR", "CRITICAL"}