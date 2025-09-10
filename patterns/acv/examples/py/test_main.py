import inspect
import socket
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union, get_args, get_origin

import pytest

import main


# -------------------------
# Helper fixtures and utils
# -------------------------

@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    # Avoid slowdowns or time-dependent behavior
    import time
    monkeypatch.setattr(time, "sleep", lambda *_a, **_k: None)


@pytest.fixture(autouse=True)
def deterministic_random(monkeypatch: pytest.MonkeyPatch) -> None:
    # Force deterministic randomness across the module
    import random

    monkeypatch.setattr(random, "random", lambda: 0.5)
    monkeypatch.setattr(random, "randint", lambda a, b: (a + b) // 2)
    monkeypatch.setattr(random, "choice", lambda seq: seq[0] if seq else None)

    def _no_shuffle(seq: List[Any]) -> None:
        # Do nothing to keep order stable
        return None

    monkeypatch.setattr(random, "shuffle", _no_shuffle)


@pytest.fixture(autouse=True)
def block_network(monkeypatch: pytest.MonkeyPatch) -> None:
    # Fail fast if anything tries to access network
    def _blocked(*_a, **_k):
        raise RuntimeError("Network access blocked in tests")

    # sockets
    monkeypatch.setattr(socket.socket, "connect", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("Network access blocked in tests")))
    monkeypatch.setattr(socket, "create_connection", _blocked)

    # urllib
    try:
        import urllib.request as _urllib_request  # type: ignore
        monkeypatch.setattr(_urllib_request, "urlopen", _blocked)
    except Exception:
        pass

    # requests
    try:
        import requests  # type: ignore
        monkeypatch.setattr(requests, "request", _blocked, raising=False)
        monkeypatch.setattr(requests.sessions.Session, "request", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("Network access blocked in tests")), raising=False)
    except Exception:
        pass


@pytest.fixture
def prepared_fs(tmp_path: Path) -> Dict[str, Path]:
    # Create some predictable files/directories for functions that expect filesystem input
    data_file = tmp_path / "file.txt"
    data_file.write_text("hello world\n")
    subdir = tmp_path / "subdir"
    subdir.mkdir()
    return {"file": data_file, "dir": subdir}


def _is_public(name: str) -> bool:
    return not name.startswith("_")


def _module_public_functions(mod) -> List[Tuple[str, Callable[..., Any]]]:
    funcs: List[Tuple[str, Callable[..., Any]]] = []
    for name in dir(mod):
        if not _is_public(name):
            continue
        obj = getattr(mod, name)
        # Only test functions defined in this module (avoid imported helpers)
        if inspect.isfunction(obj) and getattr(obj, "__module__", None) == mod.__name__:
            funcs.append((name, obj))
    return funcs


def _module_public_classes(mod) -> List[Tuple[str, type]]:
    classes: List[Tuple[str, type]] = []
    for name in dir(mod):
        if not _is_public(name):
            continue
        obj = getattr(mod, name)
        if inspect.isclass(obj) and getattr(obj, "__module__", None) == mod.__name__:
            classes.append((name, obj))
    return classes


def _name_hint_value(name: str, prepared: Dict[str, Path]) -> Any:
    lname = name.lower()
    if "path" in lname or "file" in lname:
        return prepared["file"]
    if "dir" in lname or "folder" in lname:
        return prepared["dir"]
    if "text" in lname or "prompt" in lname or "message" in lname or "query" in lname or "content" in lname:
        return "hello"
    if lname in {"n", "k"} or "count" in lname or "top_k" in lname or lname.endswith("_k"):
        return 1
    if "temperature" in lname or lname in {"p", "prob"}:
        return 0.0
    if "seed" in lname:
        return 42
    if "list" in lname or "items" in lname or "messages" in lname:
        return []
    if "map" in lname or "dict" in lname or "config" in lname or "kwargs" in lname or lname.endswith("_by"):
        return {}
    # Default fallback
    return "x"


def _value_for_annotation(anno: Any, prepared: Dict[str, Path]) -> Any:
    if anno is inspect.Signature.empty:
        return None

    origin = get_origin(anno)
    args = get_args(anno)

    # Basic primitives
    if anno in (str,):
        return "hello"
    if anno in (int,):
        return 1
    if anno in (float,):
        return 0.0
    if anno in (bool,):
        return True
    if anno in (bytes, bytearray):
        return b"data"

    # Path-like
    try:
        from pathlib import Path as _Path
        if anno in (_Path,):
            return prepared["file"]
    except Exception:
        pass

    # Collections
    if origin in (list, List, Sequence, Iterable, tuple, Tuple, set, Set):
        inner = args[0] if args else Any
        val = _value_for_annotation(inner, prepared)
        if origin in (tuple, Tuple):
            return (val,)
        if origin in (set,):
            return {val}
        return [val]
    if origin in (dict, Dict, Mapping):
        k_anno = args[0] if args else str
        v_anno = args[1] if len(args) > 1 else Any
        return {_value_for_annotation(k_anno, prepared): _value_for_annotation(v_anno, prepared)}
    if origin is Union:
        # Prefer first option
        for opt in args:
            if opt is type(None):
                continue
            return _value_for_annotation(opt, prepared)
        return None
    if origin is Optional:
        return _value_for_annotation(args[0], prepared) if args else None
    if origin is Callable:
        def _fn(*_a, **_k):  # deterministic stub
            return "ok"
        return _fn

    # Fallback: try to instantiate annotation if it's a class with zero-arg ctor
    if isinstance(anno, type):
        try:
            return anno()  # type: ignore[call-arg]
        except Exception:
            return None

    return None


def _build_args_for_callable(func: Callable[..., Any], prepared: Dict[str, Path]) -> Tuple[Tuple[Any, ...], Dict[str, Any]]:
    sig = inspect.signature(func)
    args: List[Any] = []
    kwargs: Dict[str, Any] = {}
    for p in sig.parameters.values():
        if p.kind == inspect.Parameter.VAR_POSITIONAL:
            # Do not supply *args by default
            continue
        if p.kind == inspect.Parameter.VAR_KEYWORD:
            # No **kwargs by default
            continue

        # Prefer defaults when available to stay on "happy path"
        if p.default is not inspect._empty:
            continue

        value = _value_for_annotation(p.annotation, prepared)
        if value is None:
            # Use name hints if annotation didn't help
            value = _name_hint_value(p.name, prepared)

        if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
            args.append(value)
        elif p.kind == inspect.Parameter.KEYWORD_ONLY:
            kwargs[p.name] = value
        else:
            # Fallback, append positionally
            args.append(value)
    return tuple(args), kwargs


def _get_public_methods(instance: Any) -> List[Tuple[str, Callable[..., Any]]]:
    methods: List[Tuple[str, Callable[..., Any]]] = []
    for name in dir(instance):
        if not _is_public(name):
            continue
        try:
            attr = getattr(instance, name)
        except Exception:
            continue
        if callable(attr) and not isinstance(attr, type):
            # Exclude properties that are not callable or descriptors returning non-callables
            try:
                if inspect.ismethod(attr) or inspect.isfunction(attr) or callable(attr):
                    methods.append((name, attr))
            except Exception:
                continue
    return methods


# -------------------------
# Actual tests
# -------------------------

def test_module_imports() -> None:
    # Basic sanity: the module should import cleanly
    assert hasattr(main, "__name__")
    # There should be at least some public surface, but do not enforce count
    _ = [n for n in dir(main) if _is_public(n)]


def test_public_functions_happy_path(prepared_fs: Dict[str, Path], capsys: pytest.CaptureFixture[str]) -> None:
    # Execute all public functions with generated dummy arguments.
    # Intent: prove the examples' functions run without external side effects or nondeterminism.
    for name, func in _module_public_functions(main):
        args, kwargs = _build_args_for_callable(func, prepared_fs)
        try:
            result = func(*args, **kwargs)
        except Exception as exc:
            # Accept common exceptions when external resources are intentionally blocked
            acceptable = (RuntimeError, ValueError, TypeError, FileNotFoundError, PermissionError, TimeoutError, OSError)
            assert isinstance(exc, acceptable), f"Function {name} raised unexpected exception type: {type(exc).__name__}"
            continue

        # If a result is returned, ensure it's stable to repr (for determinism) and doesn't explode
        _ = repr(result)
        # Consume any stdout produced to avoid polluting output
        capsys.readouterr()


def test_public_classes_and_methods_happy_path(prepared_fs: Dict[str, Path]) -> None:
    # Instantiate each public class and call its public methods with generated arguments.
    # Intent: cover object behavior along a straightforward path.
    for cls_name, cls in _module_public_classes(main):
        # Try easiest constructor path
        try:
            init_args, init_kwargs = _build_args_for_callable(cls, prepared_fs)
            instance = cls(*init_args, **init_kwargs)
        except Exception as exc:
            acceptable = (RuntimeError, ValueError, TypeError, FileNotFoundError, PermissionError, TimeoutError, OSError)
            # If instantiation itself depends on externalities, allow known failures
            assert isinstance(exc, acceptable), f"Class {cls_name} failed to instantiate with unexpected exception: {type(exc).__name__}"
            continue

        # Call methods
        for meth_name, meth in _get_public_methods(instance):
            # Skip dunder or standard representation/accessors already filtered by _is_public
            try:
                args, kwargs = _build_args_for_callable(meth, prepared_fs)
                res = meth(*args, **kwargs)
            except Exception as exc:
                acceptable = (RuntimeError, ValueError, TypeError, FileNotFoundError, PermissionError, TimeoutError, OSError)
                assert isinstance(exc, acceptable), f"Method {cls_name}.{meth_name} raised unexpected exception type: {type(exc).__name__}"
                continue
            _ = repr(res)


@pytest.mark.parametrize("edge_value_factory", [
    # Edge-case producer functions to stress input validation for common primitive types
    lambda p, prepared: "" if p.annotation in (str,) or "prompt" in p.name.lower() or "text" in p.name.lower() else None,
    lambda p, prepared: -1 if p.annotation in (int,) or p.name.lower() in {"n", "k"} or "count" in p.name.lower() else None,
    lambda p, prepared: 0.0 if p.annotation in (float,) or "temperature" in p.name.lower() else None,
])
def test_functions_edge_inputs_validation(prepared_fs: Dict[str, Path], edge_value_factory: Callable[[inspect.Parameter, Dict[str, Path]], Any]) -> None:
    # For each function, if an edge-case value applies to a parameter, attempt the call and
    # expect either a clean handling (no crash) or a clear validation exception.
    for name, func in _module_public_functions(main):
        sig = inspect.signature(func)
        # Build regular args first
        args, kwargs = _build_args_for_callable(func, prepared_fs)
        # Try to inject a single edge-case into the first compatible parameter
        injected = False
        new_args = list(args)
        new_kwargs = dict(kwargs)

        for idx, p in enumerate(sig.parameters.values()):
            if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                continue
            if p.default is not inspect._empty:
                continue
            edge_val = edge_value_factory(p, prepared_fs)
            if edge_val is None:
                continue
            # Place edge value
            if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
                # Ensure list has index
                while len(new_args) <= idx:
                    new_args.append(_name_hint_value(f"arg{len(new_args)}", prepared_fs))
                new_args[idx] = edge_val
                injected = True
                break
            if p.kind == inspect.Parameter.KEYWORD_ONLY:
                new_kwargs[p.name] = edge_val
                injected = True
                break

        if not injected:
            # No relevant parameter for this edge case; skip
            continue

        try:
            _ = func(*tuple(new_args), **new_kwargs)
        except Exception as exc:
            # Validation should surface as one of these
            assert isinstance(exc, (ValueError, TypeError)), f"Function {name} raised non-validation exception: {type(exc).__name__}"


def _result_for_callable(func: Callable[..., Any], prepared_fs: Dict[str, Path]) -> Any:
    args, kwargs = _build_args_for_callable(func, prepared_fs)
    return func(*args, **kwargs)


def test_determinism_repeated_calls(prepared_fs: Dict[str, Path]) -> None:
    # With randomness/time patched, calling the same function/method twice should yield a stable repr.
    for name, func in _module_public_functions(main):
        try:
            r1 = _result_for_callable(func, prepared_fs)
            r2 = _result_for_callable(func, prepared_fs)
        except Exception:
            # If function requires external deps and fails, skip determinism assertion for it
            continue
        assert repr(r1) == repr(r2), f"Non-deterministic function output detected for {name}"

    for cls_name, cls in _module_public_classes(main):
        try:
            init_args, init_kwargs = _build_args_for_callable(cls, prepared_fs)
            instance = cls(*init_args, **init_kwargs)
        except Exception:
            # Skip classes that cannot be instantiated in isolation
            continue
        for meth_name, meth in _get_public_methods(instance):
            try:
                args, kwargs = _build_args_for_callable(meth, prepared_fs)
                r1 = meth(*args, **kwargs)
                r2 = meth(*args, **kwargs)
            except Exception:
                continue
            assert repr(r1) == repr(r2), f"Non-deterministic method output detected for {cls_name}.{meth_name}"