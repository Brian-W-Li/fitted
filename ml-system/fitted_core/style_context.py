"""Validated declared style inputs. These steer generation, never override exact controls."""
from __future__ import annotations

import json
import re
from typing import Any

_ID = re.compile(r"[a-f0-9]{24}\Z")
_FIELDS = {"boardId", "profileId", "profileVersion", "boardLabel", "routineId", "routineVersion",
           "routineLabel", "learningEnabled", "compiled", "memoryRevision", "weather"}

def normalize_style_context(value: Any) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != _FIELDS:
        raise ValueError("styleContext has an invalid field set")
    for key in ("boardId", "profileId"):
        if not isinstance(value[key], str) or not _ID.fullmatch(value[key]):
            raise ValueError(f"styleContext.{key} must be a canonical id")
    for key, minimum in (("profileVersion", 1), ("memoryRevision", 0)):
        if type(value[key]) is not int or not minimum <= value[key] <= 2**53 - 1:
            raise ValueError(f"styleContext.{key} is invalid")
    for key in ("boardLabel", "routineLabel"):
        text = value[key]
        if key == "routineLabel" and text is None:
            continue
        if not isinstance(text, str) or not text.strip() or len(text) > 60:
            raise ValueError(f"styleContext.{key} is invalid")
        text.encode("utf-8")
    if value["routineId"] is None:
        if value["routineVersion"] is not None or value["routineLabel"] is not None:
            raise ValueError("styleContext routine fields disagree")
    elif (not isinstance(value["routineId"], str) or not _ID.fullmatch(value["routineId"]) or
          type(value["routineVersion"]) is not int or value["routineVersion"] < 1 or value["routineLabel"] is None):
        raise ValueError("styleContext routine fields are invalid")
    if type(value["learningEnabled"]) is not bool or (value["learningEnabled"] and value["routineId"] is None):
        raise ValueError("styleContext learning setting is invalid")
    if value["weather"] not in ("cold", "mild", "hot", "unspecified"):
        raise ValueError("styleContext weather scope is invalid")
    compiled = value["compiled"]
    if not isinstance(compiled, dict) or set(compiled) != {"aestheticKeywords", "palette", "patterns", "fits"}:
        raise ValueError("styleContext compiled profile is invalid")
    for key, terms in compiled.items():
        if not isinstance(terms, list) or len(terms) > 12:
            raise ValueError(f"styleContext.compiled.{key} is invalid")
        for term in terms:
            if not isinstance(term, str) or not term.strip() or len(term) > 60:
                raise ValueError(f"styleContext.compiled.{key} contains invalid text")
            term.encode("utf-8")
    return json.loads(json.dumps(value, ensure_ascii=False))

def style_context_key(value: dict | None) -> str | None:
    if value is None:
        return None
    return json.dumps(["style-context.v2", value["boardId"], value["profileId"], value["profileVersion"],
                       value["routineId"], value["routineVersion"], value["weather"]], separators=(",", ":"))

def style_prompt_lines(value: dict | None) -> list[str]:
    if value is None:
        return []
    return ["Declared style direction (preferences, never a waiver of the exact garment controls):",
            json.dumps(value["compiled"], ensure_ascii=False, sort_keys=True),
            *(["Saved situation: " + json.dumps(value["routineLabel"], ensure_ascii=False)] if value["routineLabel"] else [])]
