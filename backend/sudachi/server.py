"""Sudachi sidecar for Nadeshiko's own parser (task 40).

A small HTTP service around SudachiPy, pinned (with its dictionary) to what Elasticsearch's analysis-sudachi
uses, so stored tokens and search tokens come from the same analysis. The parser asks for split
mode B and does its own grouping afterwards; every B morpheme carries its A-level pieces so grouped tokens can
keep their inner boundaries (SlimToken.parts).

    POST /tokenize  {"texts": ["..."], "mode": "B"}
      -> {"sentences": [[{"s", "b", "e", "pos": [6], "d", "n", "r", "a": [{"s", "b", "e"}]}]]}
    GET  /up        -> {"ok": true, "sudachipy": "...", "dictionary": "..."}

Standard library only besides SudachiPy. One tokenizer per thread: SudachiPy tokenizers are not thread-safe.
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import sudachipy
from sudachipy import Dictionary, SplitMode

DICTIONARY_PATH = os.environ.get("SUDACHI_DICTIONARY", "/sudachi/system_full.dic")
DICTIONARY_VERSION = os.environ.get("SUDACHI_DICTIONARY_VERSION", "unknown")
PORT = int(os.environ.get("PORT", "8090"))
MAX_TEXTS = 1000
MAX_CHARS = 200_000

MODES = {"A": SplitMode.A, "B": SplitMode.B, "C": SplitMode.C}

# Optional user dictionaries (comma-separated paths), compiled against the same system dictionary.
USER_DICTIONARIES = [path for path in os.environ.get("SUDACHI_USER_DICTIONARIES", "").split(",") if path]

_dictionary = (
    Dictionary(dict=DICTIONARY_PATH, config=json.dumps({"userDict": USER_DICTIONARIES}))
    if USER_DICTIONARIES
    else Dictionary(dict=DICTIONARY_PATH)
)
_local = threading.local()


def _tokenizer():
    tokenizer = getattr(_local, "tokenizer", None)
    if tokenizer is None:
        tokenizer = _dictionary.create()
        _local.tokenizer = tokenizer
    return tokenizer


def tokenize(text, mode):
    """Morphemes of one text; offsets are character offsets into the text as given."""
    out = []
    for morpheme in _tokenizer().tokenize(text, MODES[mode]):
        pieces = morpheme.split(SplitMode.A) if mode != "A" else []
        out.append(
            {
                "s": morpheme.surface(),
                "b": morpheme.begin(),
                "e": morpheme.end(),
                "pos": list(morpheme.part_of_speech()),
                "d": morpheme.dictionary_form(),
                "n": morpheme.normalized_form(),
                "r": morpheme.reading_form(),
                "a": [{"s": p.surface(), "b": p.begin(), "e": p.end()} for p in pieces] if len(pieces) > 1 else [],
            }
        )
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/up":
            self._send(200, {"ok": True, "sudachipy": sudachipy.__version__, "dictionary": DICTIONARY_VERSION})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/tokenize":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            texts = body.get("texts")
            mode = body.get("mode", "B")
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                raise ValueError("texts must be a list of strings")
            if len(texts) > MAX_TEXTS or sum(len(t) for t in texts) > MAX_CHARS:
                raise ValueError(f"at most {MAX_TEXTS} texts and {MAX_CHARS} characters per request")
            if mode not in MODES:
                raise ValueError("mode must be A, B or C")
        except (ValueError, json.JSONDecodeError) as error:
            self._send(400, {"error": str(error)})
            return
        self._send(200, {"sentences": [tokenize(text, mode) for text in texts]})

    def log_message(self, format, *args):  # noqa: A002 - quiet; the caller logs
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
