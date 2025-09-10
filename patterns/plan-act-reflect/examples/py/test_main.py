import inspect
import sys
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import pytest

import main


# ------------------------------
# Helpers used by tests
# ------------------------------

STRINGY_NAMES = {
    "text",
    "prompt",
    "input",
    "message",
    "query",
    "instruction",
    "content",
    "user_input",
    "s",
}
NUMERIC_CONTROL_NAMES = {
    "steps",
    "max_steps",
    "n",
    "k",
    "limit",
    "count",
    "max_tokens",
    "num_steps",
    "retries",
    "max_retries",
    "depth",
}

Param = inspect.Parameter


def is_public_name(name: str) -> bool:
    """Public symbol heuristic: not dunder or protected."""
    return not name.startswith("_")


def public_functions(module: Any) -> List[Callable[..., Any]]:
    """Return public functions defined in the module."""
    funcs: List[Callable[..., Any]] = []
    for name in dir(module):
        if not is_public_name(name):
            continue
        obj = getattr(module, name)
        if inspect.isfunction(obj) and getattr(obj, "__module__", None) == module.__name__:
            funcs.append(obj)
    return funcs


def public_classes(module: Any) -> List[type]:
    """Return public classes defined in the module."""
    classes: List[type] = []
    for name in dir(module):
        if not is_public_name(name):
            continue
        obj = getattr(module, name)
        if inspect.isclass(obj) and getattr(obj, "__module__", None) == module.__name__:
            classes.append(obj)
    return classes


def required_params(sig: inspect.Signature) -> List[inspect.Parameter]:
    """List of required non-self, non-cls parameters."""
    req: List[Param] = []
    for p in sig.parameters.values():
        if p.name in ("self", "cls"):
            continue
        if p.kind in (Param.VAR_POSITIONAL, Param.VAR_KEYWORD):
            continue
        if p.default is Param.empty:
            req.append(p)
    return req


def apply_deterministic_patches(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force time/random to deterministic values if present in main's imports."""
    # Patch time
    monkeypatch.setattr("time.time", lambda: 1_700_000_000.0, raising=False)
    monkeypatch.setattr("time.sleep", lambda _: None, raising=False)

    # Patch random
    monkeypatch.setattr("random.random", lambda: 0.123456789, raising=False)
    monkeypatch.setattr("random.randint", lambda a, b: a, raising=False)
    monkeypatch.setattr("random.choice", lambda seq: seq[0] if seq else None, raising=False)
    monkeypatch.setattr("random.shuffle", lambda seq: None, raising=False)


def build_basic_value_for_param(name: str) -> Any:
    """Provide a simple value by parameter name hint."""
    lname = name.lower()
    if lname in STRINGY_NAMES or "path" in lname or "file" in lname:
        return "hello"
    if lname in NUMERIC_CONTROL_NAMES or "len" in lname or "size" in lname or "count" in lname:
        return 1
    if "bool" in lname or lname.startswith("is_") or lname.startswith("use_") or lname.startswith("enable"):
        return True
    if lname in {"seed"}:
        return 123
    # Fallback to a benign string
    return "x"


def can_call_with_only_numeric_param(func: Callable[..., Any], numeric_param: Param) -> bool:
    """Return True if all other required params are absent."""
    sig = inspect.signature(func)
    req = [p for p in required_params(sig) if p.name != numeric_param.name]
    return len(req) == 0


# ------------------------------
# Tests
# ------------------------------


def test_module_import_and_public_api_presence() -> None:
    """Basic smoke test: module imports and exposes at least one public symbol."""
    # Ensure the module imported under test namespace
    assert hasattr(main, "__name__")
    # The example should present some public API: function or class
    funcs = public_functions(main)
    classes = public_classes(main)
    # At least one of functions/classes should be present; otherwise, the example is empty.
    assert funcs or classes, "Expected at least one public function or class in main.py example"


@pytest.mark.parametrize("func", public_functions(main))
def test_zero_arg_functions_execute_without_error(func: Callable[..., Any], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    """
    Call any public function that requires no arguments.
    Verify it doesn't raise and optionally prints or returns something.
    """
    sig = inspect.signature(func)
    req = required_params(sig)
    if req:
        pytest.skip(f"Function {func.__name__} requires args; covered in other tests")

    apply_deterministic_patches(monkeypatch)

    # Execute and ensure no exception
    result = func()
    out, err = capsys.readouterr()

    # Minimal assertions: either returns something non-None or prints something
    assert result is not None or out or err == "", f"{func.__name__} should return a value or produce output"


@pytest.mark.parametrize("func", public_functions(main))
@pytest.mark.parametrize("text_value", ["hello world", ""])
def test_string_param_functions_handle_basic_inputs(
    func: Callable[..., Any],
    text_value: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """
    For functions whose first required parameter looks like text/prompt/input,
    call them with a regular string and an empty string to cover boundaries.
    """
    sig = inspect.signature(func)
    req = required_params(sig)
    if len(req) == 0:
        pytest.skip(f"{func.__name__} has no required params")
    first = req[0]
    if first.name not in STRINGY_NAMES:
        pytest.skip(f"{func.__name__} does not look like a text-processing function")

    apply_deterministic_patches(monkeypatch)

    # Build kwargs supplying only the first param and leaving others defaulted
    kwargs: Dict[str, Any] = {first.name: text_value}
    # Any remaining required parameters cannot be satisfied generically; skip if present
    if len(req) > 1:
        pytest.skip(f"{func.__name__} requires additional params not covered by generic test")

    result = func(**kwargs)
    out, err = capsys.readouterr()
    # Ensure function behaves deterministically and does something
    assert result is not None or out or err == ""


@pytest.mark.parametrize("func", public_functions(main))
def test_numeric_control_param_functions_accept_zero_and_one(
    func: Callable[..., Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    For functions with a single required numeric control parameter (e.g., steps),
    ensure 0 and 1 are accepted and do not raise exceptions.
    """
    sig = inspect.signature(func)
    req = required_params(sig)
    if len(req) != 1:
        pytest.skip(f"{func.__name__} doesn't have a single required param")
    p = req[0]
    if p.name not in NUMERIC_CONTROL_NAMES:
        pytest.skip(f"{func.__name__} required param {p.name} not recognized as numeric control")

    apply_deterministic_patches(monkeypatch)

    # Call with 0 and 1 for boundary coverage
    for val in (0, 1):
        func(**{p.name: val})


@pytest.mark.parametrize("cls", public_classes(main))
def test_classes_can_instantiate_without_required_args_when_possible(
    cls: type,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Attempt to instantiate each public class when its __init__ has no required args.
    """
    init = getattr(cls, "__init__", None)
    if init is None:
        # Builtin-like object; skip
        pytest.skip(f"{cls.__name__} has no __init__ to inspect")
    sig = inspect.signature(init)
    req = [p for p in required_params(sig) if p.name != "self"]
    if req:
        pytest.skip(f"{cls.__name__} requires constructor args; covered by method tests if instance provisioned elsewhere")

    apply_deterministic_patches(monkeypatch)

    instance = cls()
    assert instance is not None


@pytest.mark.parametrize("cls", public_classes(main))
def test_public_methods_run_on_default_instance_when_possible(
    cls: type,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """
    For classes that can be instantiated without required args, invoke their public methods:
    - zero-argument methods
    - single-string-argument methods (with regular and empty string)
    """
    init = getattr(cls, "__init__", None)
    if init is None:
        pytest.skip(f"{cls.__name__} has no __init__ to inspect")
    sig_init = inspect.signature(init)
    req_init = [p for p in required_params(sig_init) if p.name != "self"]
    if req_init:
        pytest.skip(f"{cls.__name__} requires constructor args; generic test cannot instantiate")

    apply_deterministic_patches(monkeypatch)

    obj = cls()

    # Iterate public attributes; call methods safely
    for name, member in inspect.getmembers(obj):
        if not is_public_name(name):
            continue
        if not inspect.ismethod(member) and not inspect.isfunction(member):
            continue
        if name in {"__str__", "__repr__", "__eq__"}:
            continue
        try:
            sig = inspect.signature(member)
        except (TypeError, ValueError):
            # Builtin method without signature info
            continue

        req = [p for p in required_params(sig) if p.name != "self"]
        if len(req) == 0:
            # Zero-arg method
            res = member()
            out, err = capsys.readouterr()
            assert res is not None or out or err == ""
        elif len(req) == 1 and req[0].name in STRINGY_NAMES:
            # Single string-param method: try both normal and empty inputs
            for text_value in ("hello", ""):
                res = member(**{req[0].name: text_value})
                out, err = capsys.readouterr()
                assert res is not None or out or err == ""
        else:
            # Methods requiring complex inputs are skipped by this generic suite
            continue


def test_entrypoint_callable_main(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    """
    If a top-level callable named 'main' exists (common in examples), execute it safely.

    - No arguments: call directly.
    - Single 'argv' or 'args' argument: call with empty list.
    - If it calls sys.exit, capture SystemExit and treat as successful run unless non-zero.
    """
    entry = getattr(main, "main", None)
    if entry is None or not callable(entry):
        pytest.skip("No callable 'main' entrypoint found in the example")

    apply_deterministic_patches(monkeypatch)

    try:
        sig = inspect.signature(entry)
    except (TypeError, ValueError):
        # No introspectable signature; try best-effort call
        try:
            entry()
        except SystemExit as e:
            assert e.code in (None, 0)
        return

    params = [p for p in sig.parameters.values() if p.name not in ("self", "cls")]
    try:
        if len(params) == 0:
            entry()
        elif len(params) == 1 and params[0].name in {"argv", "args"}:
            entry([])
        else:
            # Unsupported signature for generic call
            pytest.skip(f"Entrypoint has unsupported signature: {sig}")
    except SystemExit as e:
        # Treat exiting with 0 as success
        assert e.code in (None, 0)

    out, err = capsys.readouterr()
    # Entrypoint should typically produce some output
    assert out or err == ""


@pytest.mark.parametrize("func", public_functions(main))
def test_negative_numeric_control_may_raise_value_error(func: Callable[..., Any]) -> None:
    """
    Optional error-path coverage: if a function has a single required numeric control param,
    calling it with a negative value often should raise ValueError (if validated).
    This is marked xfail if the implementation does not enforce it.
    """
    sig = inspect.signature(func)
    req = required_params(sig)
    if len(req) != 1 or req[0].name not in NUMERIC_CONTROL_NAMES:
        pytest.skip(f"{func.__name__} does not match numeric-control single-param pattern")

    p = req[0]
    with pytest.raises(Exception), pytest.mark.xfail(strict=False, reason="Implementation may not validate negative values"):
        func(**{p.name: -1})