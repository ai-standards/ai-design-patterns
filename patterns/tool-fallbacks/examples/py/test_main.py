import inspect
import sys
import types
from typing import Any, Callable, Dict, Iterable, List, Tuple

import pytest

import main  # SUT import


# ---------- Helpers (test-only utilities) ----------

def _is_public_name(name: str) -> bool:
    """Treat names not starting with underscore as public."""
    return not name.startswith("_")


def _exported_names(module: types.ModuleType) -> List[str]:
    """Prefer __all__ if present; otherwise list non-underscore attributes."""
    if hasattr(module, "__all__") and isinstance(module.__all__, (list, tuple)):
        return [str(n) for n in module.__all__]
    return [n for n in dir(module) if _is_public_name(n)]


def _get_public_functions(module: types.ModuleType) -> Dict[str, Callable[..., Any]]:
    functions: Dict[str, Callable[..., Any]] = {}
    for name in _exported_names(module):
        obj = getattr(module, name, None)
        if inspect.isfunction(obj) and obj.__module__ == module.__name__:
            functions[name] = obj
    return functions


def _get_public_classes(module: types.ModuleType) -> Dict[str, type]:
    classes: Dict[str, type] = {}
    for name in _exported_names(module):
        obj = getattr(module, name, None)
        if inspect.isclass(obj) and obj.__module__ == module.__name__:
            classes[name] = obj
    return classes


def _has_only_optional_params(sig: inspect.Signature) -> bool:
    """Return True if all parameters are optional (have defaults, VAR_POSITIONAL, or VAR_KEYWORD)."""
    for p in sig.parameters.values():
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        if p.default is inspect._empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            return False
    return True


def _callable_without_args(obj: Callable[..., Any]) -> bool:
    """Return True if callable can be invoked without arguments."""
    try:
        sig = inspect.signature(obj)
    except (TypeError, ValueError):
        # Builtins or callables without signature are treated as unsafe.
        return False
    return _has_only_optional_params(sig)


def _class_instantiable_without_args(cls: type) -> bool:
    """Return True if class can be instantiated without arguments."""
    init = getattr(cls, "__init__", None)
    if init is object.__init__:
        return True
    try:
        sig = inspect.signature(init)
    except (TypeError, ValueError):
        return False
    # Drop 'self' param
    params = list(sig.parameters.values())[1:]
    fake_sig = inspect.Signature(parameters=params)
    return _has_only_optional_params(fake_sig)


def _iter_public_methods(instance: Any) -> Iterable[Tuple[str, Callable[..., Any]]]:
    """Yield public bound methods of an instance."""
    for name in dir(instance):
        if not _is_public_name(name):
            continue
        try:
            attr = getattr(instance, name)
        except Exception:
            # Some descriptors may raise; skip them.
            continue
        if inspect.ismethod(attr) or inspect.isfunction(attr):
            # Only bound methods or functions on the instance
            if inspect.ismethod(attr) or getattr(attr, "__self__", None) is instance:
                yield name, attr


def _is_async_or_generator(func: Callable[..., Any]) -> bool:
    return any(
        [
            inspect.iscoroutinefunction(func),
            inspect.isasyncgenfunction(func),
            inspect.isgeneratorfunction(func),
        ]
    )


# ---------- Fixtures ----------

@pytest.fixture(autouse=True)
def stable_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Provide a stable environment:
    - Set common AI provider API keys to dummy values.
    - Patch time and random functions to deterministic values.
    """
    # Common provider keys
    for var in (
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GROQ_API_KEY",
        "MISTRAL_API_KEY",
        "GOOGLE_API_KEY",
        "AZURE_OPENAI_API_KEY",
    ):
        monkeypatch.setenv(var, "test-key")

    # Deterministic random/time
    import random as _random
    import time as _time

    monkeypatch.setattr(_random, "random", lambda: 0.123456789, raising=True)
    monkeypatch.setattr(_random, "randint", lambda a, b: a, raising=True)
    monkeypatch.setattr(_random, "choice", lambda seq: seq[0], raising=True)
    monkeypatch.setattr(_time, "time", lambda: 1_600_000_000.0, raising=True)

    # If the SUT imported random/time as module attributes, patch those too.
    if hasattr(main, "random"):
        try:
            monkeypatch.setattr(main.random, "random", lambda: 0.123456789, raising=True)
            monkeypatch.setattr(main.random, "randint", lambda a, b: a, raising=True)
            monkeypatch.setattr(main.random, "choice", lambda seq: seq[0], raising=True)
        except Exception:
            pass
    if hasattr(main, "time"):
        try:
            monkeypatch.setattr(main.time, "time", lambda: 1_600_000_000.0, raising=True)
        except Exception:
            pass


# ---------- Tests ----------

def test_module_imports() -> None:
    """
    Basic sanity check: importing the SUT module should succeed and expose at least one public symbol.
    """
    assert hasattr(main, "__doc__")
    names = _exported_names(main)
    assert isinstance(names, list)
    # The module should define some public API to test; if not, flag it.
    assert any(_is_public_name(n) for n in names), "Expected at least one public symbol in main module."


def test_public_functions_are_discoverable() -> None:
    """
    Ensure public functions can be discovered via __all__ or dir and are actual callables.
    """
    funcs = _get_public_functions(main)
    for name, fn in funcs.items():
        assert callable(fn), f"Public function {name} must be callable."
        assert fn.__module__ == main.__name__


@pytest.mark.parametrize("func_name, func", list(_get_public_functions(main).items()))
def test_public_function_invocation_when_safe(func_name: str, func: Callable[..., Any], capsys: pytest.CaptureFixture[str]) -> None:
    """
    For each public function:
    - If it is synchronous and can be called without arguments (all params optional), call it.
    - Assert it doesn't raise and returns any value (including None).
    - Capture prints to ensure no excessive output to stderr.
    Functions that require mandatory arguments or are async/generator are skipped with a clear reason.
    """
    if _is_async_or_generator(func):
        pytest.skip(f"Function {func_name} is async or generator; invocation is out of scope for this generic test.")
    if not _callable_without_args(func):
        pytest.skip(f"Function {func_name} has required parameters and cannot be called safely without arguments.")
    # Invoke and ensure no exceptions propagate.
    result = func()
    out, err = capsys.readouterr()
    # No assertions on result content; the contract is that call returns without error.
    assert err == "", f"Function {func_name} should not print to stderr during default invocation."


def test_public_classes_are_discoverable() -> None:
    """
    Ensure public classes can be discovered and are real types.
    """
    classes = _get_public_classes(main)
    for name, cls in classes.items():
        assert isinstance(cls, type), f"Public class {name} must be a type."
        assert cls.__module__ == main.__name__


@pytest.mark.parametrize("cls_name, cls", list(_get_public_classes(main).items()))
def test_public_class_instantiation_when_safe(cls_name: str, cls: type) -> None:
    """
    For each public class:
    - Instantiate if the constructor has only optional parameters.
    - Assert that __repr__ and __str__ are accessible and do not raise.
    Classes that require mandatory constructor args are skipped with a clear reason.
    """
    if not _class_instantiable_without_args(cls):
        pytest.skip(f"Class {cls_name} requires constructor arguments; skipping generic instantiation.")
    instance = cls()  # type: ignore[call-arg]
    # Access repr/str to catch obvious issues in dunder methods.
    assert isinstance(repr(instance), str)
    assert isinstance(str(instance), str)


@pytest.mark.parametrize("cls_name, cls", list(_get_public_classes(main).items()))
def test_public_instance_methods_invocation_when_safe(cls_name: str, cls: type, capsys: pytest.CaptureFixture[str]) -> None:
    """
    For each public class that is instantiable without args:
    - Find public bound methods on the instance.
    - For each method that can be called without args and is synchronous, call it.
    - Assert no exceptions and that stderr remains empty.
    """
    if not _class_instantiable_without_args(cls):
        pytest.skip(f"Class {cls_name} requires constructor args; cannot test instance methods generically.")
    instance = cls()  # type: ignore[call-arg]

    any_methods_tested = False
    for method_name, method in _iter_public_methods(instance):
        # Skip dunder/private ensured by helper. Skip async/generators.
        if _is_async_or_generator(method):
            continue
        if not _callable_without_args(method):
            continue
        any_methods_tested = True
        result = method()
        out, err = capsys.readouterr()
        assert err == "", f"Method {cls_name}.{method_name} should not print to stderr during default invocation."

    # It's acceptable for a class to have no zero-arg public methods.
    if not any_methods_tested:
        pytest.skip(f"No zero-arg public instance methods found for class {cls_name}.")


def test_no_network_calls_during_default_invocations(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Guardrail test:
    - Stub common HTTP client libraries to ensure accidental network calls raise.
    - Re-import the module in an isolated context to ensure import-time code does not attempt network access.
    This test is defensive and will fail fast if the SUT performs network I/O at import time.
    """
    # Create stub modules that raise on attribute access
    class _Raiser:
        def __getattr__(self, name: str) -> Any:
            raise RuntimeError("Network access is not allowed during tests.")

        def __call__(self, *args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("Network access is not allowed during tests.")

    for mod_name in ("requests", "httpx", "urllib3", "aiohttp"):
        monkeypatch.setitem(sys.modules, mod_name, _Raiser())

    # Force a fresh import of main in a separate module namespace.
    # The real SUT is already imported; this ensures that a clean import path is also safe.
    import importlib
    spec = importlib.util.find_spec("main")
    assert spec is not None, "SUT spec must be findable."
    # Reloading to catch import-time behavior with stubbed clients
    importlib.reload(main)  # type: ignore[call-arg]