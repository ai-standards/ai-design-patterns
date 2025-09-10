"""
Streaming + Tool-Callbacks demo (self-contained, no external APIs).

This single file spins up:
- A tiny HTTP server with an SSE endpoint that streams model events
  (start, delta, tool_call, tool_result, error, done) with seq numbers.
- POST endpoints for tool_result and cancel.
- A minimal Python-side SSE client that reacts with callbacks:
  - Renders text deltas, but only flushes complete sentences to reduce flicker.
  - Executes tools immediately when tool_call arrives and POSTs results back.
  - Cancels deterministically when a "prompt change" occurs.

Design notes:
- The server is a toy LLM that emits deltas and asks for tools early.
  It pauses at a natural boundary until tool results arrive, then continues.
- The client simulates the browser: observes the stream, runs tools, and cancels.
- Everything lives in-memory; sequence numbers and minimal payloads keep it robust.

Run with: python this_file.py

Requirements:
- Only Python standard library. No external dependencies needed.
"""

from __future__ import annotations

import http.client
import io
import json
import re
import socket
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Literal, Optional, TypedDict, Union
from urllib.parse import parse_qs, quote_plus, urlparse

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ----- Shared event schema -----

EventType = Literal["start", "delta", "tool_call", "tool_result", "error", "done"]


class StartData(TypedDict):
    requestId: str
    topic: str
    startedAt: int


class DeltaData(TypedDict):
    text: str


class ToolCallData(TypedDict):
    callId: str
    name: Literal["factCheck", "photoSearch", "fetchWire"]
    args: Dict[str, Any]


class ToolResultData(TypedDict):
    callId: str
    result: Any
    receivedAt: int


class ErrorData(TypedDict):
    message: str


class DoneData(TypedDict):
    reason: Literal["completed", "cancelled", "error"]
    totals: Dict[str, int]


# ----- Internal request state -----

@dataclass
class ToolWaiter:
    event: threading.Event
    result: Any = None
    called_at: float = field(default_factory=time.time)


@dataclass
class RequestState:
    id: str
    seq: int
    wfile: io.BufferedWriter
    conn: socket.socket
    topic: str
    cancelled: bool
    ended: bool
    delta_count: int
    tools_requested: int
    tools_completed: int
    tool_waiters: Dict[str, ToolWaiter]
    tool_latencies: Dict[str, float]
    created_at: float
    lock: threading.Lock = field(default_factory=threading.Lock)


requests_lock = threading.Lock()
requests: Dict[str, RequestState] = {}


# ----- Utilities -----

def now_ms() -> int:
    return int(time.time() * 1000)


def sleep(ms: int) -> None:
    time.sleep(ms / 1000.0)


def _json_dumps(data: Any) -> str:
    # Compact JSON for SSE efficiency
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def read_json(rfile: io.BufferedReader, headers: Dict[str, str]) -> Any:
    cl = headers.get("Content-Length")
    if not cl:
        raise ValueError("Missing Content-Length")
    try:
        length = int(cl)
    except ValueError:
        raise ValueError("Invalid Content-Length")
    raw = rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise ValueError("Invalid JSON") from e


class CancelledError(Exception):
    pass


def assert_not_cancelled(state: RequestState) -> None:
    if state.cancelled or state.ended:
        raise CancelledError("cancelled")


def send_event(state: RequestState, event_type: EventType, data: Union[
    StartData, DeltaData, ToolCallData, ToolResultData, ErrorData, DoneData
]) -> None:
    # Thread-safe send. All writers go through this function.
    with state.lock:
        if state.cancelled or state.ended:
            return
        state.seq += 1
        try:
            payload = f"event: {event_type}\nid: {state.seq}\ndata: {_json_dumps(data)}\n\n"
            state.wfile.write(payload.encode("utf-8"))
            state.wfile.flush()
            if event_type == "delta":
                state.delta_count += 1
        except Exception:
            # Connection went away; mark as cancelled/ended.
            state.cancelled = True
            state.ended = True


def close_connection(state: RequestState) -> None:
    # Best-effort: close the underlying socket to terminate the SSE stream.
    try:
        state.conn.shutdown(socket.SHUT_RDWR)
    except Exception:
        pass
    try:
        state.conn.close()
    except Exception:
        pass


def end_stream(state: RequestState, reason: Literal["completed", "cancelled", "error"]) -> None:
    with state.lock:
        if state.ended:
            return
        send_event(state, "done", {
            "reason": reason,
            "totals": {
                "deltas": state.delta_count,
                "toolsRequested": state.tools_requested,
                "toolsCompleted": state.tools_completed,
            },
        })
        state.ended = True
    close_connection(state)


# ----- Model runner -----

def run_brief_stream(state: RequestState) -> None:
    try:
        # Emit "start" promptly.
        send_event(state, "start", {
            "requestId": state.id,
            "topic": state.topic,
            "startedAt": now_ms(),
        })

        sleep(80)
        assert_not_cancelled(state)
        send_event(state, "delta", {"text": f"Flash brief: {state.topic}\n"})

        # Issue factCheck tool call
        fact_call_id = f"call-{uuid.uuid4().hex[:8]}"
        state.tool_waiters[fact_call_id] = ToolWaiter(event=threading.Event(), called_at=time.time())
        state.tools_requested += 1
        send_event(state, "tool_call", {
            "callId": fact_call_id,
            "name": "factCheck",
            "args": {"claim": "At least 3 injuries reported by local EMS."},
        })

        # Issue photoSearch tool call
        photo_call_id = f"call-{uuid.uuid4().hex[:8]}"
        state.tool_waiters[photo_call_id] = ToolWaiter(event=threading.Event(), called_at=time.time())
        state.tools_requested += 1
        send_event(state, "tool_call", {
            "callId": photo_call_id,
            "name": "photoSearch",
            "args": {"query": f"{state.topic} scene", "license": "editorial"},
        })

        # Stream some deltas meanwhile
        chunks = [
            "• Officials are responding; traffic reroutes in effect. ",
            "• Live updates pending verification. ",
            "• One verified fact will follow once confirmed. ",
        ]
        for c in chunks:
            sleep(120)
            assert_not_cancelled(state)
            send_event(state, "delta", {"text": c})

        # Wait for fact result
        fact_waiter = state.tool_waiters[fact_call_id]
        while not fact_waiter.event.wait(timeout=0.05):
            assert_not_cancelled(state)
        fact = fact_waiter.result  # type: ignore[assignment]
        assert_not_cancelled(state)
        verdict = "true" if isinstance(fact, dict) and fact.get("verdict") == "true" else "false"
        note = fact.get("note") if isinstance(fact, dict) else ""
        text = f"• Verified: {note if verdict == 'true' else 'pending official confirmation'} "
        send_event(state, "delta", {"text": text})

        # Wait for photo result
        photo_waiter = state.tool_waiters[photo_call_id]
        while not photo_waiter.event.wait(timeout=0.05):
            assert_not_cancelled(state)
        photo = photo_waiter.result  # type: ignore[assignment]
        assert_not_cancelled(state)
        caption = photo.get("caption") if isinstance(photo, dict) else ""
        url = photo.get("url") if isinstance(photo, dict) else ""
        send_event(state, "delta", {"text": f"• Photo suggestion: {caption} ({url})\n"})

        sleep(60)
        assert_not_cancelled(state)
        end_stream(state, "completed")
    except CancelledError:
        # Another handler (cancel/timeout) sends 'done' and closes the connection.
        pass
    except Exception as e:
        with state.lock:
            if state.cancelled or state.ended:
                return
            send_event(state, "error", {"message": str(e)})
        end_stream(state, "error")


# ----- HTTP Server -----

class APIServerHandler(BaseHTTPRequestHandler):
    server_version = "SSEDemo/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if self.command == "GET" and parsed.path == "/api/brief/stream":
            qs = parse_qs(parsed.query or "")
            topic = qs.get("topic", ["breaking news"])[0]
            request_id = str(uuid.uuid4())

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            state = RequestState(
                id=request_id,
                seq=0,
                wfile=self.wfile,  # type: ignore[assignment]
                conn=self.connection,  # type: ignore[assignment]
                topic=topic,
                cancelled=False,
                ended=False,
                delta_count=0,
                tools_requested=0,
                tools_completed=0,
                tool_waiters={},
                tool_latencies={},
                created_at=time.time(),
            )
            with requests_lock:
                requests[request_id] = state

            # Safety timeout
            def on_timeout() -> None:
                with state.lock:
                    if state.ended:
                        return
                    state.cancelled = True
                end_stream(state, "cancelled")
                with requests_lock:
                    requests.pop(request_id, None)

            timeout_timer = threading.Timer(12.0, on_timeout)
            timeout_timer.daemon = True
            timeout_timer.start()

            try:
                run_brief_stream(state)
            finally:
                timeout_timer.cancel()
                with requests_lock:
                    requests.pop(request_id, None)
            return

        self.send_error(404, "not found")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        # Tool result: /api/brief/:id/tool_result
        tool_match = re.match(r"^/api/brief/([^/]+)/tool_result$", parsed.path or "")
        if self.command == "POST" and tool_match:
            request_id = tool_match.group(1)
            with requests_lock:
                state = requests.get(request_id)
            if not state:
                self.send_error(404, "unknown requestId")
                return
            try:
                body = read_json(self.rfile, {k: v for k, v in self.headers.items()})
            except Exception:
                self.send_error(400, "invalid json")
                return
            call_id = body.get("callId") if isinstance(body, dict) else None
            result = body.get("result") if isinstance(body, dict) else None
            if not isinstance(call_id, str) or call_id not in state.tool_waiters:
                self.send_error(404, "unknown callId")
                return

            waiter = state.tool_waiters[call_id]
            with state.lock:
                send_event(state, "tool_result", {
                    "callId": call_id,
                    "result": result,
                    "receivedAt": now_ms(),
                })
                state.tools_completed += 1
                state.tool_latencies[call_id] = time.time() - waiter.called_at
                waiter.result = result
                waiter.event.set()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return

        # Cancel: /api/brief/:id/cancel
        cancel_match = re.match(r"^/api/brief/([^/]+)/cancel$", parsed.path or "")
        if self.command == "POST" and cancel_match:
            request_id = cancel_match.group(1)
            with requests_lock:
                state = requests.get(request_id)
            if not state:
                self.send_error(404, "unknown requestId")
                return
            with state.lock:
                if not state.ended:
                    state.cancelled = True
            end_stream(state, "cancelled")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
            return

        self.send_error(404, "not found")

    # Keep the server quiet
    def log_message(self, format: str, *args: Any) -> None:
        return


def start_server(port: int = 0) -> tuple[ThreadingHTTPServer, int]:
    server = ThreadingHTTPServer(("127.0.0.1", port), APIServerHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    _, bound_port = server.server_address
    return server, bound_port


# ----- Minimal SSE client and tool runner -----

class SSEClient:
    def __init__(self, url: str, handlers: Dict[EventType, Callable[[Dict[str, Any]], None]]) -> None:
        self.url = url
        self.handlers = handlers
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._conn: Optional[http.client.HTTPConnection] = None

    def open(self) -> None:
        def run() -> None:
            try:
                parsed = urlparse(self.url)
                host = parsed.hostname or "127.0.0.1"
                port = parsed.port or (443 if parsed.scheme == "https" else 80)
                path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
                conn = http.client.HTTPConnection(host, port, timeout=15)
                self._conn = conn
                conn.request("GET", path, headers={"Accept": "text/event-stream"})
                resp = conn.getresponse()
                if resp.status != 200:
                    h = self.handlers.get("error")
                    if h:
                        h({"type": "error", "seq": 0, "data": {"message": f"http {resp.status}"}})
                    return

                resp_fp = resp
                curr_type: Optional[EventType] = None
                curr_id: Optional[int] = None
                curr_data = ""

                def dispatch() -> None:
                    nonlocal curr_type, curr_id, curr_data
                    if curr_type:
                        try:
                            data = json.loads(curr_data) if curr_data else {}
                        except Exception:
                            data = {}
                        h = self.handlers.get(curr_type)
                        if h:
                            h({"type": curr_type, "seq": curr_id or 0, "data": data})
                    curr_type = None
                    curr_id = None
                    curr_data = ""

                while not self._stop.is_set():
                    line_bytes = resp_fp.readline()
                    if not line_bytes:
                        break
                    line = line_bytes.decode("utf-8", errors="ignore").rstrip("\n")
                    # SSE allows CRLF; strip trailing CR
                    if line.endswith("\r"):
                        line = line[:-1]
                    if line.startswith("event:"):
                        curr_type = line.split(":", 1)[1].strip() or None  # type: ignore[assignment]
                    elif line.startswith("id:"):
                        try:
                            curr_id = int(line.split(":", 1)[1].strip())
                        except Exception:
                            curr_id = 0
                    elif line.startswith("data:"):
                        curr_data += line.split(":", 1)[1].strip()
                    elif line == "":
                        dispatch()
            except Exception:
                h = self.handlers.get("error")
                if h:
                    h({"type": "error", "seq": 0, "data": {"message": "connection error"}})

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        try:
            if self._conn:
                self._conn.close()
        except Exception:
            pass


# Mock tools: fast, deterministic, side-effect free.
def tool_fact_check(args: Dict[str, Any]) -> Dict[str, str]:
    sleep(180)
    claim = args.get("claim", "")
    return {"verdict": "true", "note": f"EMS confirms: {claim}"}


def tool_photo_search(args: Dict[str, Any]) -> Dict[str, str]:
    sleep(140)
    query = args.get("query", "")
    license_ = args.get("license", "editorial")
    return {
        "url": f"photo://{quote_plus(str(query))}",
        "caption": f"{query}, {license_} license",
    }


def post_json(url: str, body: Any) -> bool:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        path = parsed.path
        conn = http.client.HTTPConnection(host, port, timeout=10)
        payload = _json_dumps(body)
        conn.request("POST", path, body=payload, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        # Drain data to allow connection close cleanly
        try:
            resp.read()
        except Exception:
            pass
        conn.close()
        return resp.status == 200
    except Exception:
        return False


def start_client(base_url: str, topic: str):
    url = f"{base_url}/api/brief/stream?topic={quote_plus(topic)}"
    request_id: str = ""
    buffer: str = ""
    ttfb_start = time.time()
    first_delta_at: Optional[float] = None

    sentence_boundary = re.compile(r"([.!?]\s)")

    def flush_at_sentence() -> None:
        nonlocal buffer
        parts = sentence_boundary.split(buffer)
        if len(parts) < 3:
            return
        flush = "".join(parts[:2])
        buffer = "".join(parts[2:])
        print("RENDER:", flush)

    def on_start(e: Dict[str, Any]) -> None:
        nonlocal request_id, ttfb_start
        data: Dict[str, Any] = e.get("data", {})
        request_id = data.get("requestId", "")
        ttfb_start = time.time()
        print("START:", {"requestId": request_id, "topic": data.get("topic", "")})

    def on_delta(e: Dict[str, Any]) -> None:
        nonlocal buffer, first_delta_at
        if first_delta_at is None:
            first_delta_at = time.time()
        data: Dict[str, Any] = e.get("data", {})
        buffer += data.get("text", "")
        flush_at_sentence()

    def on_tool_call(e: Dict[str, Any]) -> None:
        data: Dict[str, Any] = e.get("data", {})
        call_id = data.get("callId", "")
        name = data.get("name", "")
        args = data.get("args", {})
        print("TOOL_CALL:", name, "args:", args)

        def run_tool() -> None:
            try:
                if name == "factCheck":
                    result = tool_fact_check(args)
                elif name == "photoSearch":
                    result = tool_photo_search(args)
                else:
                    raise ValueError(f"Unknown tool: {name}")
                post_json(f"{base_url}/api/brief/{request_id}/tool_result", {"callId": call_id, "result": result})
            except Exception as err:
                print("Tool error:", str(err))

        threading.Thread(target=run_tool, daemon=True).start()

    def on_tool_result(e: Dict[str, Any]) -> None:
        data: Dict[str, Any] = e.get("data", {})
        print("TOOL_RESULT:", data.get("callId", ""))

    def on_done(e: Dict[str, Any]) -> None:
        nonlocal buffer
        data: Dict[str, Any] = e.get("data", {})
        if buffer.strip():
            print("RENDER:", buffer.strip())
        if first_delta_at is not None:
            print("TELEMETRY:", {
                "TTFB_ms": int((first_delta_at - ttfb_start) * 1000),
                "tokensSeen": f"approx {data.get('totals', {}).get('deltas', 0)}",
                "tools": f"{data.get('totals', {}).get('toolsCompleted', 0)}/{data.get('totals', {}).get('toolsRequested', 0)}",
                "reason": data.get("reason", ""),
            })
        es.close()

    def on_error(e: Dict[str, Any]) -> None:
        data: Dict[str, Any] = e.get("data", {})
        print("STREAM_ERROR:", data.get("message", "unknown error"))

    handlers: Dict[EventType, Callable[[Dict[str, Any]], None]] = {
        "start": on_start,
        "delta": on_delta,
        "tool_call": on_tool_call,
        "tool_result": on_tool_result,
        "done": on_done,
        "error": on_error,
    }
    es = SSEClient(url, handlers)
    es.open()

    def cancel() -> None:
        es.close()
        post_json(f"{base_url}/api/brief/{request_id}/cancel", {})
        print("CANCELLED:", request_id)

    return {"requestId": lambda: request_id, "cancel": cancel}


# ----- Usage example: bring it together -----

if __name__ == "__main__":
    # Boot server, then run two client sessions: the first gets cancelled mid-flight.
    server, port = start_server(0)
    base = f"http://127.0.0.1:{port}"

    # Session 1: user asks for a brief, then quickly pivots.
    s1 = start_client(base, "Bridge collapse on 5th Ave")
    threading.Timer(1.1, s1["cancel"]).start()  # Simulate prompt edit ~1.1s in.

    # Session 2: new topic proceeds to completion.
    def start_second() -> None:
        start_client(base, "Severe storm warning in Riverton")

    threading.Timer(1.2, start_second).start()

    # Shut down after a short demo window.
    def stop_server() -> None:
        try:
            server.shutdown()
        except Exception:
            pass

    threading.Timer(5.0, stop_server).start()

    # Keep main thread alive long enough for the demo
    time.sleep(5.5)