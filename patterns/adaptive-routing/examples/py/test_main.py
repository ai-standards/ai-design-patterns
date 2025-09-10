import inspect
import os
from types import ModuleType
from typing import Callable, Dict, List, Tuple

import pytest

import main


# ----------------------------
# Helper utilities for introspection
# ----------------------------

def _public_names(module: ModuleType) -> List[str]:
    # Public API: everything not starting with underscore
    return [n for n in dir(module) if not n.startswith("_")]


def _public_functions(module: ModuleType) -> Dict[str, Callable]:
    funcs: Dict[str, Callable] = {}
    for name in _public_names(module):
        obj = getattr(module, name)
        if inspect.isfunction(obj):
            funcs[name] = obj
    return funcs


def _public_classes(module: ModuleType) -> Dict[str, type]:
    classes: Dict[str, type] = {}
    for name in _public_names(module):
        obj = getattr(module, name)
        if inspect.isclass(obj):
            classes[name] = obj
    return classes


def _callable_has_only_optional_params(func: Callable) -> bool:
    # True if all positional parameters have defaults; varargs/kwargs are fine
    sig = inspect.signature(func)
    for p in sig.parameters.values():
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            if p.default is inspect._empty:
                return False
    return True


def _callable_requires_params(func: Callable) -> bool:
    sig = inspect.signature(func)
    for p in sig.parameters.values():
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            if p.default is inspect._empty:
                return True
    return False


def _is_async_callable(func: Callable) -> bool:
    return inspect.iscoroutinefunction(func) or inspect.isasyncgenfunction(func)


# ----------------------------
# Fixtures for determinism and isolation
# ----------------------------

@pytest.fixture(autouse=True)
def deterministic_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Enforce deterministic behavior and safe defaults:
    - Freeze time.time and random.random
    - Provide dummy API keys if the SUT reads them
    """
    import time
    import random

    monkeypatch.setattr(time, "time", lambda: 1_726_000_000.0, raising=True)
    monkeypatch.setattr(random, "random", lambda: 0.123456789, raising=True)
    # Provide common LLM provider keys to avoid KeyError branches or network calls
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic-key")
    monkeypatch.setenv("GOOGLE_API_KEY", "test-google-key")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "test-azure-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost")


@pytest.fixture(autouse=True)
def block_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Prevent accidental real network usage by making common client calls fail fast.
    """
    # If requests is present, prevent outbound HTTP calls
    try:
        import requests.sessions  # type: ignore

        def _blocked_request(*args, **kwargs):
            raise RuntimeError("Network calls are blocked in tests")

        monkeypatch.setattr(requests.sessions.Session, "request", _blocked_request, raising=True)
    except Exception:
        pass


# ----------------------------
# Smoke tests for module import and public API presence
# ----------------------------

def test_module_imports() -> None:
    # Basic sanity check: module imported successfully (already imported at top).
    assert isinstance(main, ModuleType)
    # The module should expose at least one public symbol for this example.
    public = _public_names(main)
    assert len(public) > 0, "Expected the example module to expose a public API"


# ----------------------------
# Tests for public functions
# ----------------------------

def test_public_functions_with_optional_params_run_without_args(capsys: pytest.CaptureFixture[str]) -> None:
    """
    For each public function that does not require parameters, call it with no arguments.
    The intent is to ensure top-level helpers are callable and do not crash in default modes.
    """
    funcs = _public_functions(main)
    # If there are no public functions, the test is vacuously true.
    for name, func in funcs.items():
        if _is_async_callable(func):
            # Async functions require an event loop; skip here to avoid implicit concurrency in unit tests.
            continue
        if _callable_has_only_optional_params(func):
            # Call and ensure no exception; capture stdout to avoid polluting test output
            func()
            out = capsys.readouterr().out
            # No strict assertion on content; just ensure accessible as a string
            assert isinstance(out, str)


def test_public_functions_error_on_missing_required_args() -> None:
    """
    For each public function that requires at least one positional argument,
    verify that calling it without arguments raises a TypeError.
    This validates Python’s argument checking and guards accidental API misuse.
    """
    funcs = _public_functions(main)
    for name, func in funcs.items():
        if _is_async_callable(func):
            continue
        if _callable_requires_params(func):
            with pytest.raises(TypeError):
                func()  # Missing required positional arguments should error


# ----------------------------
# Tests for public classes and their methods
# ----------------------------

def _instantiate_if_possible(cls: type):
    """
    Try to instantiate a class with a no-arg constructor.
    Return instance or None if instantiation requires args.
    """
    try:
        sig = inspect.signature(cls)
    except (TypeError, ValueError):
        # Builtins or extension types may not have signatures
        try:
            return cls()  # Best effort
        except Exception:
            return None
    # If all positional parameters have defaults, can call with no args
    for p in sig.parameters.values():
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) and p.default is inspect._empty:
            # Required constructor parameter found; cannot instantiate safely
            return None
    try:
        return cls()
    except Exception:
        return None


def _public_bound_methods(obj: object) -> List[Tuple[str, Callable]]:
    """
    Return a list of (name, bound_method) for public callables on an instance.
    Properties and non-callables are ignored.
    """
    methods: List[Tuple[str, Callable]] = []
    for name in dir(obj):
        if name.startswith("_"):
            continue
        try:
            attr = getattr(obj, name)
        except Exception:
            continue
        if callable(attr):
            methods.append((name, attr))
    return methods


def _method_has_only_optional_params(method: Callable) -> bool:
    # For bound methods, 'self' is already bound; check remaining params
    try:
        return _callable_has_only_optional_params(method)
    except (ValueError, TypeError):
        # Some builtins or C-implemented methods may not expose a signature; attempt conservative skip
        return False


def test_public_classes_can_instantiate_and_call_simple_methods(capsys: pytest.CaptureFixture[str]) -> None:
    """
    For each public class:
      - Instantiate it if it supports a no-argument constructor.
      - Call each public bound method that requires no arguments.
    This provides broad smoke coverage without relying on private details.
    """
    classes = _public_classes(main)
    for cls_name, cls in classes.items():
        instance = _instantiate_if_possible(cls)
        if instance is None:
            # If the class requires constructor args, skip invocation testing for it.
            continue

        for meth_name, bound in _public_bound_methods(instance):
            # Skip coroutine methods to avoid managing event loops here
            if _is_async_callable(bound):
                continue
            if _method_has_only_optional_params(bound):
                # Call with no args and ensure no exception
                bound()
                # Ensure any print output is capturable
                _ = capsys.readouterr().out


def test_public_classes_init_raises_when_required_args_missing() -> None:
    """
    For classes that require constructor arguments, verify that calling with no args raises TypeError.
    This checks the expected Python constructor semantics and documents API requirements.
    """
    classes = _public_classes(main)
    for cls_name, cls in classes.items():
        try:
            sig = inspect.signature(cls)
        except (TypeError, ValueError):
            # If signature not available, cannot judge; skip
            continue
        requires_args = any(
            p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) and p.default is inspect._empty
            for p in sig.parameters.values()
        )
        if requires_args:
            with pytest.raises(TypeError):
                cls()  # Missing required args should error


# ----------------------------
# Optional common entrypoint checks
# ----------------------------

def test_entrypoint_run_or_main_if_present(capsys: pytest.CaptureFixture[str]) -> None:
    """
    Many examples expose a module-level 'run()' or 'main()' entrypoint.
    If present and zero-arg callable, run it and assert it completes without errors.
    """
    for entry in ("run", "main"):
        if hasattr(main, entry):
            func = getattr(main, entry)
            if callable(func) and not _is_async_callable(func) and _callable_has_only_optional_params(func):
                func()
                output = capsys.readouterr().out
                assert isinstance(output, str)  # len may be zero; content is not constrained here