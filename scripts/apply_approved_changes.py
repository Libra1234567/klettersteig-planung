#!/usr/bin/env python3
"""Apply explicitly approved, source-linked field edits to a PR working tree."""
import datetime as dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCATIONS = ROOT / "data/locations.json"
APPROVALS = ROOT / "data/approved-changes.json"
HISTORY = ROOT / "data/research-history.json"
ALLOWED = {"entry.latitude","entry.longitude","entry.elevation","summit.latitude","summit.longitude","summit.elevation","difficulty","description","approachMinutes","climbMinutes","descentMinutes","durationMinutes","range","country","closure.status","closure.reason","closure.source","closure.validFrom","closure.validTo"}
GPS = {"entry.latitude","entry.longitude","summit.latitude","summit.longitude"}
NOW = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def fail(message):
    raise ValueError(message)


def main():
    if not APPROVALS.exists():
        fail("data/approved-changes.json is missing")
    routes = json.loads(LOCATIONS.read_text(encoding="utf-8"))
    package = json.loads(APPROVALS.read_text(encoding="utf-8"))
    changes = package.get("changes")
    if not isinstance(changes, list) or not changes:
        fail("approved changes list is empty or invalid")
    by_id = {route.get("id"): route for route in routes}
    seen, history = set(), []
    for change in changes:
        route_id, path = change.get("routeId"), change.get("path")
        key = f"{route_id}:{path}"
        if key in seen:
            fail(f"duplicate field approval: {key}")
        seen.add(key)
        if route_id not in by_id:
            fail(f"unknown route id: {route_id}")
        if path not in ALLOWED:
            fail(f"field is not allowed: {path}")
        if not change.get("source", "").startswith("https://"):
            fail(f"source URL required for {key}")
        if change.get("confidence", 0) < 0.9 or change.get("verificationStatus") not in {"source-confirmed","verified","official","manuell geprüft"}:
            fail(f"verification threshold not met for {key}")
        current = by_id[route_id]
        if path in GPS:
            value = change.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                fail(f"GPS value must be a number: {key}")
            lower, upper = (-90, 90) if path.endswith("latitude") else (-180, 180)
            if not lower <= value <= upper:
                fail(f"GPS value out of range: {key}")
        parts = path.split(".")
        target = current
        for part in parts[:-1]:
            target = target.setdefault(part, {})
        old = target.get(parts[-1])
        if old == change.get("value"):
            print(f"Already applied; skipping {key}")
            continue
        if old != change.get("expectedValue"):
            fail(f"current value changed since approval for {key}; refresh and re-review before applying")
        target[parts[-1]] = change.get("value")
        point_key = parts[0] if parts[0] in ("entry", "summit") else None
        if point_key and path.endswith(("latitude", "longitude")):
            coords = by_id[route_id][point_key]
            if coords.get("latitude") is not None and coords.get("longitude") is not None:
                coords["verified"] = change.get("verificationStatus") in {"source-confirmed","verified","official"}
                coords["source"] = change["source"]
        history.append({"at":NOW,"routeId":route_id,"name":by_id[route_id].get("name"),"field":path,"oldValue":old,"newValue":change.get("value"),"source":change["source"],"approvalStatus":"approved","action":"Included in review PR"})
    ids = [route.get("id") for route in routes]
    if len(ids) != len(set(ids)):
        fail("locations.json contains duplicate IDs")
    for route in routes:
        for key in ("entry", "summit"):
            point = route.get(key) or {}
            lat, lon = point.get("latitude"), point.get("longitude")
            if (lat is None) != (lon is None):
                fail(f"{route.get('id')} {key}: latitude and longitude must both be present or null")
            if lat is not None and not (-90 <= lat <= 90 and -180 <= lon <= 180):
                fail(f"{route.get('id')} {key}: GPS out of range")
    LOCATIONS.write_text(json.dumps(routes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    state = json.loads(HISTORY.read_text(encoding="utf-8")) if HISTORY.exists() else {"schemaVersion":1,"entries":[]}
    state.setdefault("entries", []).extend(history)
    state["updatedAt"] = NOW
    HISTORY.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = ROOT / "reports/approved-changes.md"
    report.parent.mkdir(exist_ok=True)
    report.write_text("# Freigegebene Änderungen\n\n"+f"Zeitpunkt: {NOW}\n\n"+"\n".join(f"- **{entry['name']}** `{entry['field']}`: `{json.dumps(entry['oldValue'],ensure_ascii=False)}` → `{json.dumps(entry['newValue'],ensure_ascii=False)}` · Quelle: {entry['source']}" for entry in history)+"\n", encoding="utf-8")
    print(f"Validated and applied {len(history)} explicitly approved field changes; this workflow only prepares a Pull Request.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
