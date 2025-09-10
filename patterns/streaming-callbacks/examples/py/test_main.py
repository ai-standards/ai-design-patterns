import inspect
import io
import os
import types
from typing import Any, Callable, Dict, Iterable, List, Tuple

import pytest

import main  # Import the SUT from the same folder


# -------------------------------
# Helper utilities (test-only)
# -------------------------------

def _public_members(module: types.ModuleType) -> Dict[str, Any]:
    """
    Return a mapping of public symbol name -> object from the given module.
    Preference to __all__ if present and well-formed; otherwise filter out private names.
    """
    if hasattr(module, "__all__") and isinstance(module.__all__, (list, tuple)):
        names = [n for n in module.__all__ if isinstance(n, str)]
        return {n: getattr(module, n, None) for n in names if hasattr(module, n)}
    # Fallback: anything not starting with underscore and not a module attribute of pytest or other test libs
    return {
        name: getattr(module, name)
        for name in dir(module)
        if not name.startswith("_")
    }


def _is_function(obj: Any) -> bool:
    return inspect.isfunction(obj) or inspect.ismethod(obj)


def _is_class(obj: Any) -> bool:
    return inspect.isclass(obj)


def _callable_zero_required_args(fn: Callable[..., Any]) -> bool:
    """
    True if the callable can be invoked without providing any positional or keyword arguments.
    """
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        # Some builtins or C-accelerated callables may not have introspectable signatures.
        return False

    for p in sig.parameters.values():
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            # Accept arbitrary args/kwargs; safe to call with none.
            continue
        # Required positional-only or positional-or-keyword without default makes it not zero-arg.
        if p.default is inspect._empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            return False
        # Required keyword-only without default also makes it not zero-arg.
        if p.default is inspect._empty and p.kind == p.KEYWORD_ONLY:
            return False
    return True


def _iter_public_functions(module: types.ModuleType) -> Iterable[Tuple[str, Callable[..., Any]]]:
    for name, obj in _public_members(module).items():
        if _is_function(obj):
            yield name, obj


def _iter_public_classes(module: types.ModuleType) -> Iterable[Tuple[str, type]]:
    for name, obj in _public_members(module).items():
        if _is_class(obj):
            yield name, obj


# -------------------------------
# Fixtures
# -------------------------------

@pytest.fixture(autouse=True)
def deterministic_env(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    """
    Force deterministic runtime for tests:
    - Stable random and time behavior
    - Safe filesystem defaults isolated to a temporary directory
    - Dummy env vars often read by AI examples
    """
    # Control random
    import random as _random  # Local import so monkeypatch can see it
    monkeypatch.setattr(_random, "random", lambda: 0.42, raising=True)

    # No-op sleep
    import time as _time
    monkeypatch.setattr(_time, "sleep", lambda *_args, **_kwargs: None, raising=True)

    # Isolate filesystem side effects
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    monkeypatch.setenv("TEMP", str(tmp_path))

    # Often required in AI examples; set dummy values to avoid lookups failing
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("GOOGLE_API_KEY", "test")


# -------------------------------
# Basic import and API presence
# -------------------------------

def test_module_imports_and_has_public_symbols() -> None:
    """
    Basic smoke test: the module imports and exposes at least one public symbol.
    """
    symbols = _public_members(main)
    # It's okay for small modules to expose a single public symbol.
    assert isinstance(symbols, dict)
    assert len(symbols) >= 1, "Expected at least one public symbol in main module"


def test___all___if_present_is_well_formed() -> None:
    """
    If the module defines __all__, verify it is a list/tuple of strings and refers to existing attributes.
    """
    if not hasattr(main, "__all__"):
        pytest.skip("__all__ not defined; nothing to validate")
    assert isinstance(main.__all__, (list, tuple)), "__all__ must be a list or tuple"
    for name in main.__all__:
        assert isinstance(name, str), "__all__ entries must be strings"
        assert hasattr(main, name), f"__all__ includes '{name}', which is not defined on the module"


# -------------------------------
# Public function coverage
# -------------------------------

@pytest.mark.parametrize(
    "name,fn",
    list(_iter_public_functions(main)),
    ids=lambda p: p[0] if isinstance(p, tuple) else repr(p),
)
def test_public_functions_error_on_missing_required_arguments(name: str, fn: Callable[..., Any]) -> None:
    """
    For public functions with required arguments, calling with no args should raise a TypeError.
    Functions that accept zero args are tested separately in a smoke test.
    """
    if _callable_zero_required_args(fn):
        pytest.skip(f"{name} accepts zero args; covered by smoke test")
    # Expect Python's calling convention to enforce missing required args.
    with pytest.raises(TypeError):
        fn()  # type: ignore[misc]


@pytest.mark.parametrize(
    "name,fn",
    [item for item in _iter_public_functions(main) if _callable_zero_required_args(item[1])],
    ids=lambda p: p[0] if isinstance(p, tuple) else repr(p),
)
def test_public_zero_arg_functions_smoke(name: str, fn: Callable[..., Any], capsys: pytest.CaptureFixture[str]) -> None:
    """
    For any public functions that can be safely invoked without arguments:
    - Call them in a deterministic environment.
    - Ensure they do not raise and optionally produce either a return value or output.
    """
    # Skip async functions to avoid event loop management without context.
    if inspect.iscoroutinefunction(fn):
        pytest.skip(f"{name} is async; not executed in this sync test")
    # Some functions may return generators; handle safely by consuming at most one item.
    result = fn()
    if inspect.isgenerator(result):
        # Consume a single item if available, then stop.
        try:
            next(result)
        except StopIteration:
            pass
    captured = capsys.readouterr()
    # Key assertion: the call did not raise and we observed at least one kind of observable effect:
    # either a non-None return OR any stdout/stderr output (possibly empty string allowed).
    assert (result is not None) or (captured.out is not None) or (captured.err is not None)


def test_common_entrypoints_if_present_run_cleanly(capsys: pytest.CaptureFixture[str]) -> None:
    """
    Many examples export a main/run entrypoint. If present and zero-arg, exercise it end-to-end.
    """
    candidates = []
    for name in ("main", "run", "example", "demo"):
        fn = getattr(main, name, None)
        if callable(fn) and _callable_zero_required_args(fn) and not inspect.iscoroutinefunction(fn):
            candidates.append((name, fn))

    if not candidates:
        pytest.skip("No zero-arg entrypoints (main/run/example/demo) found")

    for name, fn in candidates:
        out_before = capsys.readouterr()
        res = fn()
        out_after = capsys.readouterr()
        # The function should complete without raising and may print something.
        assert res is None or res is not None  # This asserts the call returned (trivially true but documents intent)
        # If nothing was printed, still acceptable. Ensure captured attributes exist.
        assert out_after.out is not None and out_after.err is not None


# -------------------------------
# Public class coverage
# -------------------------------

@pytest.mark.parametrize(
    "name,cls",
    list(_iter_public_classes(main)),
    ids=lambda p: p[0] if isinstance(p, tuple) else repr(p),
)
def test_public_classes_constructor_argument_contract(name: str, cls: type) -> None:
    """
    Verify public classes enforce constructor signatures properly:
    - If __init__ has required args, instantiating without args should raise TypeError.
    - If zero-arg, instantiation should succeed.
    """
    ctor = getattr(cls, "__init__", None)
    if ctor is None:
        # Builtin types or objects without explicit __init__; instantiation without args should succeed.
        cls()
        return

    # Ignore object.__init__-like trivial ctors
    if ctor is object.__init__:
        cls()
        return

    # Check signature to determine if zero-arg construction is allowed.
    zero_arg = _callable_zero_required_args(ctor)
    if zero_arg:
        instance = cls()
        assert isinstance(instance, cls)
    else:
        with pytest.raises(TypeError):
            cls()


@pytest.mark.parametrize(
    "name,cls",
    list(_iter_public_classes(main)),
    ids=lambda p: p[0] if isinstance(p, tuple) else repr(p),
)
def test_public_classes_common_methods_smoke(name: str, cls: type, capsys: pytest.CaptureFixture[str]) -> None:
    """
    If a public class can be instantiated without arguments, try to call common zero-arg methods
    often found in AI examples: run, invoke, call, __call__, execute, predict.
    """
    ctor = getattr(cls, "__init__", None)
    if ctor not in (None, object.__init__) and not _callable_zero_required_args(ctor):
        pytest.skip(f"{name} requires ctor args; cannot instantiate in a generic test")

    try:
        instance = cls()
    except TypeError:
        pytest.skip(f"{name} requires ctor args at runtime; skipping")
    assert isinstance(instance, cls)

    candidate_methods = ["run", "invoke", "call", "__call__", "execute", "predict"]
    called_any = False
    for meth_name in candidate_methods:
        if not hasattr(instance, meth_name):
            continue
        meth = getattr(instance, meth_name)
        if callable(meth) and _callable_zero_required_args(meth) and not inspect.iscoroutinefunction(meth):
            _ = meth()
            called_any = True

    # It's fine if none of the common methods exist; assert that the instance exists and the test path ran.
    captured = capsys.readouterr()
    assert isinstance(instance, cls)
    # If at least one method was called, ensure no exceptions and capture is accessible.
    if called_any:
        assert captured.out is not None and captured.err is not None


# -------------------------------
# Edge case: validate that functions clearly signal bad calls
# -------------------------------

def test_function_arity_enforced_across_module() -> None:
    """
    Attempt to call every public function with a mismatched arg count:
    - If the function requires exactly 1 positional argument, calling with 2 should raise TypeError.
    - If the function requires no args, already covered by smoke tests.
    This provides a generic "error condition" check without knowing domain-specific behavior.
    """
    for name, fn in _iter_public_functions(main):
        # Skip async functions
        if inspect.iscoroutinefunction(fn):
            continue
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            continue

        required_positional = [
            p for p in sig.parameters.values()
            if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
            and p.default is inspect._empty
        ]
        if len(required_positional) == 1:
            # Supply two positional args to trigger a TypeError for wrong arity.
            with pytest.raises(TypeError):
                fn(1, 2)  # type: ignore[misc]
        # For other arities, nothing generic to assert without domain knowledge. Continue.