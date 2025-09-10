import inspect
import types
from typing import Any, Dict, List, Tuple, Optional

import pytest

import main  # Import the SUT module from the same directory


# ----------------------------
# Helper utilities (test-only)
# ----------------------------

def _is_public(name: str) -> bool:
    """Public attribute convention: not starting with underscore."""
    return not name.startswith("_")


def _get_public_functions(mod: types.ModuleType) -> Dict[str, types.FunctionType]:
    """Collect public functions defined in the module (exclude imports)."""
    funcs: Dict[str, types.FunctionType] = {}
    for name, obj in vars(mod).items():
        if _is_public(name) and inspect.isfunction(obj) and obj.__module__ == mod.__name__:
            funcs[name] = obj
    return funcs


def _get_public_classes(mod: types.ModuleType) -> Dict[str, type]:
    """Collect public classes defined in the module (exclude imports)."""
    classes: Dict[str, type] = {}
    for name, obj in vars(mod).items():
        if _is_public(name) and isinstance(obj, type) and obj.__module__ == mod.__name__:
            classes[name] = obj
    return classes


def _dummy_value_for_annotation(annotation: Any, tmp_path) -> Tuple[bool, Any]:
    """Produce a deterministic dummy value given a type annotation."""
    try:
        from pathlib import Path
    except Exception:
        Path = None  # type: ignore

    ann = annotation
    if ann is inspect._empty:
        return False, None

    try:
        # Handle typing module generics by reducing to origin
        from typing import get_origin
        origin = get_origin(ann)
        if origin is list:
            return True, []
        if origin is dict:
            return True, {}
        if origin is tuple:
            return True, ()
        if origin is set:
            return True, set()
    except Exception:
        pass

    if ann in (str, "str"):
        return True, "hello"
    if ann in (int, "int"):
        return True, 1
    if ann in (float, "float"):
        return True, 0.5
    if ann in (bool, "bool"):
        return True, True
    if ann in (dict, "dict"):
        return True, {}
    if ann in (list, "list"):
        return True, []
    if ann in (tuple, "tuple"):
        return True, ()
    if ann in (set, "set"):
        return True, set()
    if Path is not None and ann is Path:
        return True, tmp_path

    # Fallback failed
    return False, None


def _dummy_value_for_param_name(name: str, tmp_path) -> Tuple[bool, Any]:
    """Heuristic dummy value by parameter name semantic."""
    lname = name.lower()
    if any(k in lname for k in ("text", "prompt", "message", "query", "content", "name", "id")):
        return True, "hello"
    if any(k in lname for k in ("count", "n", "num", "size", "length", "limit", "max")):
        return True, 1
    if any(k in lname for k in ("ratio", "temperature", "prob", "alpha", "beta", "score")):
        return True, 0.5
    if any(k in lname for k in ("enabled", "flag", "debug", "verbose")):
        return True, True
    if any(k in lname for k in ("data", "payload", "mapping", "dict", "config", "options", "kwargs")):
        return True, {}
    if any(k in lname for k in ("items", "list", "sequence", "seq", "records", "rows")):
        return True, []
    if any(k in lname for k in ("path", "file", "fname", "filename", "filepath")):
        p = tmp_path / "file.txt"
        p.write_text("dummy")
        return True, str(p)
    if any(k in lname for k in ("dir", "folder")):
        return True, str(tmp_path)
    if any(k in lname for k in ("url", "uri", "endpoint", "host")):
        return True, "https://example.com"
    if "seed" in lname:
        return True, 123
    return False, None


def _build_callable_args(
    func: Any, tmp_path
) -> Tuple[bool, Tuple[Any, ...], Dict[str, Any], str]:
    """
    Attempt to build deterministic args/kwargs to call a function or bound method.

    Returns:
      (can_call, args, kwargs, reason_if_cannot)
    """
    try:
        sig = inspect.signature(func)
    except (ValueError, TypeError):
        # Builtins or C-implemented callables without signatures
        return False, (), {}, "no_inspectable_signature"

    args: List[Any] = []
    kwargs: Dict[str, Any] = {}

    for name, param in sig.parameters.items():
        # Skip implicit 'self'/'cls' for bound methods
        if name in ("self", "cls"):
            continue

        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            # Provide nothing for *args/**kwargs by default
            continue

        if param.default is not inspect._empty:
            # Use default; nothing to pass
            continue

        # Try to synthesize a value via annotation, then name heuristic
        ok, value = _dummy_value_for_annotation(param.annotation, tmp_path)
        if not ok:
            ok, value = _dummy_value_for_param_name(name, tmp_path)
        if not ok:
            return False, (), {}, f"cannot_satisfy_required_param:{name}"

        if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
            args.append(value)
        else:
            kwargs[name] = value

    return True, tuple(args), kwargs, ""


# ----------------------------
# Tests
# ----------------------------

def test_module_importable_and_has_public_api() -> None:
    """
    Basic smoke test:
    - The module should import successfully.
    - It should expose at least one public attribute (function or class).
    """
    public_funcs = _get_public_functions(main)
    public_classes = _get_public_classes(main)

    # The module should have at least some public surface area to test.
    assert public_funcs or public_classes, (
        "Expected main.py to define at least one public function or class for testing."
    )


def test_public_functions_execute_with_dummy_inputs(monkeypatch: pytest.MonkeyPatch, tmp_path, capsys) -> None:
    """
    For each public function, attempt to call it with deterministic dummy arguments.
    - Patches time.sleep and random to ensure determinism and avoid delays.
    - Captures stdout to avoid noisy test output.
    - The goal is to check happy-path execution doesn't raise for well-formed inputs.
    """
    # Make calls deterministic and fast
    monkeypatch.setattr("time.sleep", lambda *_args, **_kwargs: None, raising=False)
    monkeypatch.setattr("random.random", lambda: 0.42, raising=False)
    monkeypatch.setattr("random.randint", lambda a, b: a, raising=False)

    funcs = _get_public_functions(main)
    for name, func in funcs.items():
        can_call, args, kwargs, reason = _build_callable_args(func, tmp_path)
        if not can_call:
            # Skip functions requiring complex inputs that cannot be constructed generically.
            pytest.skip(f"Skipping function {name}: {reason}")
        # Call and assert no exception is raised
        try:
            func(*args, **kwargs)
        except Exception as exc:
            pytest.fail(f"Public function {name} raised unexpectedly: {exc!r}")
        # Drain any print output to keep test logs clean
        capsys.readouterr()


def test_public_classes_can_instantiate_and_methods_run(monkeypatch: pytest.MonkeyPatch, tmp_path, capsys) -> None:
    """
    For each public class:
    - Instantiate it if a zero-arg (or fully defaulted) constructor is available.
    - Invoke public parameterless or fully-defaulted methods on the instance.
    Ensures happy-path behavior for common entry points.
    """
    monkeypatch.setattr("time.sleep", lambda *_args, **_kwargs: None, raising=False)
    monkeypatch.setattr("random.random", lambda: 0.42, raising=False)
    monkeypatch.setattr("random.randint", lambda a, b: a, raising=False)

    classes = _get_public_classes(main)
    for cname, cls in classes.items():
        # Attempt to instantiate the class by constructing args for __init__
        init = getattr(cls, "__init__", None)
        if init is object.__init__:
            instance = cls()  # Trivial case
        else:
            can_call, args, kwargs, reason = _build_callable_args(init, tmp_path)
            if not can_call:
                pytest.skip(f"Skipping class {cname} instantiation: {reason}")
            try:
                instance = cls(*args, **kwargs)
            except Exception as exc:
                pytest.fail(f"Class {cname} failed to instantiate: {exc!r}")

        # For each public method, try to call if it requires no additional args
        for attr_name, attr in vars(cls).items():
            if not _is_public(attr_name):
                continue
            # Skip special methods
            if attr_name.startswith("__") and attr_name.endswith("__"):
                continue
            # Retrieve the bound attribute from the instance
            bound = getattr(instance, attr_name, None)
            if not callable(bound):
                continue
            can_call, args, kwargs, reason = _build_callable_args(bound, tmp_path)
            if not can_call:
                # Skip methods requiring complex inputs
                continue
            try:
                bound(*args, **kwargs)
            except Exception as exc:
                pytest.fail(f"Method {cname}.{attr_name} raised unexpectedly: {exc!r}")
        capsys.readouterr()


@pytest.mark.parametrize(
    "param_name_candidates",
    [
        ("text", "prompt", "message", "query", "content"),
    ],
)
def test_text_like_functions_handle_empty_and_none_gracefully(
    param_name_candidates: Tuple[str, ...]
) -> None:
    """
    For functions that look like they accept text/prompt inputs, probe basic error handling:
    - Calling with empty string should not crash; it may return empty output or raise ValueError/TypeError.
    - Calling with None should raise a clear exception (TypeError/ValueError) or be handled explicitly.
    This exercises edge cases around empty/None inputs if the API is designed for LLM prompts.
    """
    funcs = _get_public_functions(main)
    for fname, func in funcs.items():
        try:
            sig = inspect.signature(func)
        except (ValueError, TypeError):
            continue

        # Identify a single-parameter "text-like" function
        params = [p for p in sig.parameters.values() if p.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        ) and p.default is inspect._empty and p.name not in ("self", "cls")]

        if len(params) != 1:
            continue

        param = params[0]
        lname = param.name.lower()
        if not any(cand in lname for cand in param_name_candidates):
            continue

        # Empty string case
        try:
            if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
                func("")
            else:
                func(**{param.name: ""})
        except Exception as exc:
            # Acceptable: raising a clear exception type
            assert isinstance(exc, (TypeError, ValueError)), (
                f"{fname} with empty string raised unexpected exception type: {type(exc).__name__}"
            )

        # None case
        with pytest.raises((TypeError, ValueError)):
            if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
                func(None)  # type: ignore[arg-type]
            else:
                func(**{param.name: None})  # type: ignore[arg-type]


def test_cli_entrypoints_if_present(capsys, monkeypatch: pytest.MonkeyPatch) -> None:
    """
    If the module exposes conventional CLI-like entry points (main/run/example) with zero arguments,
    execute them and assert they produce some output or complete without error.
    """
    monkeypatch.setattr("time.sleep", lambda *_args, **_kwargs: None, raising=False)
    possible_names = ("main", "run", "example")
    for name in possible_names:
        obj = getattr(main, name, None)
        if callable(obj):
            # Attempt to call only if zero-argument callable (or fully defaulted)
            can_call, args, kwargs, reason = _build_callable_args(obj, tmp_path=None if False else "/tmp")  # type: ignore[arg-type]
            if not can_call or args or kwargs:
                # Skip callables that require complex inputs
                continue
            try:
                obj()
            except Exception as exc:
                pytest.fail(f"CLI-like entry point {name}() raised unexpectedly: {exc!r}")
            out = capsys.readouterr().out
            # Not all CLIs print, but many do; at least ensure call succeeded
            assert out is None or isinstance(out, str)  # sanity check on captured output type