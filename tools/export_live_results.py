"""只读导出 V4 滚球推送归档 → data/live-results/*.json

约束：
- 只以 sqlite mode=ro 打开 V4 运行时库，绝不写入 V4 生产表。
- 只导出「后端 queued 回执 + 至少一条客户端 client_received 回执」的推送。
- 推送瞬间比分/分钟/盘口全部取自 alert_archive.snapshot_json，不做反推。
- 终场比分优先查 7M 同源 matchInfo（state=4 才算终场），结果落
  data/live-results/upstream_finals.json 并附响应哈希；查不到仍是 PENDING。
- 任何缺口保持 NULL，绝不把 NULL 当 0。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

TZ = timezone(timedelta(hours=8))
TZ_NAME = "Asia/Shanghai"
DAY_SCHEMA = "live-results-day-1"
INDEX_SCHEMA = "live-results-index-1"
FINAL_SCHEMA = "live-results-upstream-1"
NO_FINAL_SCORE = "NO_FINAL_SCORE_SOURCE"
UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE"
UPSTREAM_NOT_FINAL = "UPSTREAM_NOT_FINAL"
PUSH_SCORE_MISSING = "PUSH_SCORE_MISSING"
SCORE_REGRESSION = "SCORE_REGRESSION"
DEFAULT_SINCE = "2026-11-14"
REPO_ROOT = Path(__file__).resolve().parents[1]
SEVENM_MATCH_INFO = (
    "https://api-en-vpgl.7mdt.com/api/match/version/1_0/footballMatch/matchInfo"
    "?langNumber=3&platform=4&portType=1&sportType=1&matchId={}"
)
SEVENM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Referer": "https://live.7msport.com/",
}
FINISHED_STATE = 4


def _iso(value):
    return datetime.fromisoformat(value).astimezone(timezone.utc).isoformat() if value else None


def _local(value):
    return datetime.fromisoformat(value).astimezone(TZ)


def _line_text(value):
    if value is None:
        return None
    return f"{value:.4f}".rstrip("0").rstrip(".") if isinstance(value, float) else str(value)


def _market_type(signal_type: str):
    text = (signal_type or "").upper()
    if "OVER" in text or "UNDER" in text or "OU_" in text:
        return "OU"
    if "_AH" in text or text.endswith("AH"):
        return "AH"
    return None


def _varint(payload: bytes, index: int):
    shift = value = 0
    while True:
        byte = payload[index]
        index += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, index


def _proto_fields(payload: bytes):
    """最小 protobuf 解码器：返回 [(field_no, wire_type, value)]。"""
    index = 0
    out = []
    while index < len(payload):
        key, index = _varint(payload, index)
        field_no, wire_type = key >> 3, key & 7
        if wire_type == 0:
            value, index = _varint(payload, index)
        elif wire_type == 2:
            size, index = _varint(payload, index)
            value = payload[index:index + size]
            index += size
        elif wire_type == 5:
            value = payload[index:index + 4]
            index += 4
        elif wire_type == 1:
            value = payload[index:index + 8]
            index += 8
        else:
            raise ValueError(f"unsupported wire type {wire_type}")
        out.append((field_no, wire_type, value))
    return out


def _proto_first(payload: bytes, field_no: int):
    for number, wire_type, value in _proto_fields(payload):
        if number == field_no:
            return value
    return None


def _proto_text(payload: bytes, field_no: int):
    value = _proto_first(payload, field_no)
    return value.decode("utf-8", "replace") if isinstance(value, bytes) else None


def parse_match_info(payload: bytes):
    """解析 7M FootballMatchInfo；缺失的比分字段按 protobuf 语义视为 0。"""
    any_message = _proto_first(payload, 4)
    if not any_message:
        return None
    inner = _proto_first(any_message, 2)
    match = _proto_first(inner, 1) if inner else None
    if not match:
        return None
    home_score = _proto_first(_proto_first(match, 11), 4)
    away_score = _proto_first(_proto_first(match, 12), 4)
    half_home = _proto_first(_proto_first(match, 11), 5)
    half_away = _proto_first(_proto_first(match, 12), 5)
    return {
        "native_id": _proto_first(match, 1),
        "kickoff_epoch": _proto_first(match, 3),
        "state": _proto_first(match, 14),
        "home_team": _proto_text(_proto_first(match, 9), 2),
        "away_team": _proto_text(_proto_first(match, 10), 2),
        "full_home": int(home_score or 0),
        "full_away": int(away_score or 0),
        "half_home": int(half_home or 0),
        "half_away": int(half_away or 0),
        "has_full_score": home_score is not None or away_score is not None,
        "has_half_score": half_home is not None or half_away is not None,
    }


def fetch_upstream_final(match_id: str, cached: dict, session, now_iso: str):
    """查询同源终场比分；已在缓存中确认终场的记录不再重复请求。"""
    entry = cached.get(match_id)
    if entry and entry.get("final") is True:
        return entry
    native_id = str(match_id).split(":")[-1]
    try:
        response = session.get(SEVENM_MATCH_INFO.format(native_id), headers=SEVENM_HEADERS, timeout=20)
        response.raise_for_status()
        parsed = parse_match_info(response.content)
    except Exception as exc:  # 网络异常不得被当成 0 比分
        return {"match_id": match_id, "final": False, "error": type(exc).__name__,
                "note": UPSTREAM_UNAVAILABLE, "fetched_at_utc": now_iso}
    if parsed is None:
        return {"match_id": match_id, "final": False, "note": UPSTREAM_NOT_FINAL,
                "fetched_at_utc": now_iso}
    entry = {
        "match_id": match_id,
        "native_id": parsed["native_id"],
        "state": parsed["state"],
        # protobuf 省略的比分子字段即 0，因此终场判定只看 state=4。
        "final": parsed["state"] == FINISHED_STATE,
        "home_team": parsed["home_team"],
        "away_team": parsed["away_team"],
        "kickoff_utc": (datetime.fromtimestamp(parsed["kickoff_epoch"], timezone.utc).isoformat()
                        if parsed["kickoff_epoch"] else None),
        "final_home_score": parsed["full_home"],
        "final_away_score": parsed["full_away"],
        "half_time_home_score": parsed["half_home"] if parsed["has_half_score"] else None,
        "half_time_away_score": parsed["half_away"] if parsed["has_half_score"] else None,
        "fetched_at_utc": now_iso,
        "source_url": SEVENM_MATCH_INFO.format(native_id),
        "response_sha256": hashlib.sha256(response.content).hexdigest(),
        "response_bytes": len(response.content),
        "note": None if parsed["state"] == FINISHED_STATE else UPSTREAM_NOT_FINAL,
    }
    cached[match_id] = entry
    return entry


def apply_final_score(record: dict, upstream: dict | None) -> None:
    """把上游终场写回记录；缺口保持 NULL，异常转 REVIEW。"""
    if not upstream or not upstream.get("final"):
        record["result_note"] = (upstream or {}).get("note") or NO_FINAL_SCORE
        return
    home, away = upstream["final_home_score"], upstream["final_away_score"]
    record["match_status"] = "FT"
    record["final_home_score"] = home
    record["final_away_score"] = away
    record["half_time_home_score"] = upstream.get("half_time_home_score")
    record["half_time_away_score"] = upstream.get("half_time_away_score")
    record["source_updated_at_utc"] = upstream.get("fetched_at_utc")
    record["result_note"] = None
    record["full_time_goals"] = home + away
    push_home, push_away = record.get("push_home_score"), record.get("push_away_score")
    if not isinstance(push_home, int) or not isinstance(push_away, int):
        record["goals_after_push"] = None
        record["goal_result_status"] = "REVIEW"
        record["result_note"] = PUSH_SCORE_MISSING
        return
    delta = record["full_time_goals"] - (push_home + push_away)
    record["goals_after_push"] = delta
    if delta < 0:
        record["goal_result_status"] = "REVIEW"
        record["result_note"] = SCORE_REGRESSION
        return
    record["goal_result_status"] = "HIT" if delta >= 1 else "MISS"
    record["settled_at_utc"] = upstream.get("fetched_at_utc")



def load(db_path: Path):
    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    delivered = {}
    for row in cur.execute(
        """select archive_id,
                  max(case when stage='queued' then 1 else 0 end) as queued,
                  max(case when stage='client_received' then 1 else 0 end) as received
           from alert_delivery_receipts group by archive_id"""
    ):
        if row["queued"] and row["received"]:
            delivered[row["archive_id"]] = True
    archives = cur.execute("select * from alert_archive order by alert_created_at_utc desc").fetchall()
    halftime = {}
    for row in cur.execute(
        """select canonical_fixture_id, version, evidence_json from fixture_outcomes
           where json_extract(evidence_json,'$.period')='HT' order by version"""
    ):
        evidence = json.loads(row["evidence_json"])
        if evidence.get("verification_status") == "VERIFIED":
            halftime[row["canonical_fixture_id"]] = evidence
    con.close()
    return delivered, archives, halftime


def build_record(row, halftime):
    snapshot = json.loads(row["snapshot_json"])
    minute = snapshot.get("signal_minute")
    level = "formal" if row["source_notification_kind"] == "formal" else "soft"
    ht = halftime.get(row["canonical_fixture_id"]) or {}
    return {
        "push_id": row["archive_id"],
        "match_id": row["canonical_fixture_id"],
        "sport": "football",
        "league": row["league_name_at_alert"] or snapshot.get("league_name_at_alert"),
        "home_team": snapshot.get("home_name_at_alert"),
        "away_team": snapshot.get("away_name_at_alert"),
        "push_sent_at_utc": _iso(row["alert_created_at_utc"]),
        "push_sent_at_local": _local(row["alert_created_at_utc"]).isoformat(),
        "push_minute_display": f"{minute}′" if isinstance(minute, int) else None,
        "push_minute_value": minute if isinstance(minute, int) else None,
        "push_home_score": snapshot.get("score_home"),
        "push_away_score": snapshot.get("score_away"),
        "market_period": row["market_scope"],
        "market_type": _market_type(row["signal_type"]),
        "market_line": _line_text(snapshot.get("ou_line")),
        "market_odds_over": snapshot.get("over_decimal"),
        "market_odds_under": snapshot.get("under_decimal"),
        "alert_level": level,
        "record_class": "observation" if row["observation_only"] else "prediction",
        "signal_type": row["signal_type"],
        "model_score": snapshot.get("model_score"),
        "send_status": "DELIVERED",
        "match_status": None,
        "final_home_score": None,
        "final_away_score": None,
        "half_time_home_score": ht.get("score_home"),
        "half_time_away_score": ht.get("score_away"),
        "full_time_goals": None,
        "goals_after_push": None,
        "goal_result_status": "PENDING",
        "result_note": NO_FINAL_SCORE,
        "settled_at_utc": None,
        "source_updated_at_utc": ht.get("source_timestamp"),
    }


def summarize(records):
    def count(pred):
        return sum(1 for r in records if pred(r))

    hit = count(lambda r: r["goal_result_status"] == "HIT")
    miss = count(lambda r: r["goal_result_status"] == "MISS")
    denominator = hit + miss
    return {
        "push_total": len(records),
        "formal": count(lambda r: r["alert_level"] == "formal"),
        "soft": count(lambda r: r["alert_level"] == "soft"),
        "settled": denominator,
        "hit": hit,
        "miss": miss,
        "pending": count(lambda r: r["goal_result_status"] == "PENDING"),
        "review": count(lambda r: r["goal_result_status"] == "REVIEW"),
        "abnormal": count(lambda r: r["goal_result_status"] == "ABNORMAL"),
        "goal_after_push_count": hit,
        "hit_rate": round(hit / denominator, 4) if denominator else None,
        "hit_rate_denominator": denominator,
    }


def _dump(payload):
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def _write_if_changed(path: Path, payload: dict) -> bool:
    text = _dump(payload)
    if path.exists():
        old = json.loads(path.read_text(encoding="utf-8"))
        old["generated_at_utc"] = payload["generated_at_utc"]
        if old == payload:
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return True


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=r"E:\LiveOU\data\live_snapshots.db")
    parser.add_argument("--out", default=str(REPO_ROOT / "data" / "live-results"))
    parser.add_argument("--log-dir", default=str(REPO_ROOT.parent / "live-results-work" / "logs"))
    parser.add_argument("--date", help="只导出该北京时间日期 YYYY-MM-DD")
    parser.add_argument("--since", default=DEFAULT_SINCE, help="只导出该北京时间日期起的推送")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    started = datetime.now(timezone.utc)
    delivered, archives, halftime = load(Path(args.db))
    records = [build_record(row, halftime) for row in archives if row["archive_id"] in delivered]
    unconfirmed = [row["archive_id"] for row in archives if row["archive_id"] not in delivered]
    records = [r for r in records
               if _local(r["push_sent_at_utc"]).date().isoformat() >= (args.since or "0000-00-00")]

    # 统计口径：小球不统计；同一场比赛只保留最早触发的那一次提醒。
    under_excluded = [r for r in records
                      if "UNDER" in str(r.get("signal_type") or "").upper()]
    records = [r for r in records if r not in under_excluded]
    earliest = {}
    for record in sorted(records, key=lambda r: r["push_sent_at_utc"]):
        earliest.setdefault(record["match_id"], record)
    duplicate_excluded = len(records) - len(earliest)
    records = list(earliest.values())

    out = Path(args.out)
    cache_path = out / "upstream_finals.json"
    cache = {"schema_version": FINAL_SCHEMA, "generated_at_utc": None, "matches": {}}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        cache.setdefault("matches", {})
    cache["source"] = {
        "name": "7M native footballMatch/matchInfo",
        "url_template": SEVENM_MATCH_INFO,
        "finished_state": FINISHED_STATE,
        "field_map": {"state": "match.14", "full_score": "match.11.4 / match.12.4",
                      "half_score": "match.11.5 / match.12.5"},
        "zero_rule": "protobuf 省略的比分子字段按 0 计",
    }

    import requests  # 仅导出器使用，页面端不加载

    session = requests.Session()
    upstream_hits = 0
    for record in records:
        now_iso = datetime.now(timezone.utc).isoformat()
        upstream = fetch_upstream_final(record["match_id"], cache["matches"], session, now_iso)
        apply_final_score(record, upstream)
        upstream_hits += 1 if record["goal_result_status"] in {"HIT", "MISS"} else 0
    cache["generated_at_utc"] = datetime.now(timezone.utc).isoformat()

    by_day = {}
    for record in records:
        by_day.setdefault(_local(record["push_sent_at_utc"]).date().isoformat(), []).append(record)
    if args.date:
        by_day = {k: v for k, v in by_day.items() if k == args.date}

    written, summaries = [], []
    now = datetime.now(timezone.utc).isoformat()
    for date in sorted(by_day, reverse=True):
        day_records = sorted(by_day[date], key=lambda r: r["push_sent_at_utc"], reverse=True)
        summary = summarize(day_records)
        payload = {"schema_version": DAY_SCHEMA, "date": date, "timezone": TZ_NAME,
                   "generated_at_utc": now, "summary": summary, "records": day_records}
        if args.dry_run:
            changed = True
        else:
            changed = _write_if_changed(out / "days" / f"{date}.json", payload)
        if changed:
            written.append(f"days/{date}.json")
        summaries.append({"date": date, "file": f"days/{date}.json", **{k: summary[k] for k in (
            "push_total", "formal", "soft", "settled", "hit", "miss", "pending", "review", "abnormal")}})

    index = {"schema_version": INDEX_SCHEMA, "timezone": TZ_NAME, "generated_at_utc": now,
             "days": sorted(summaries, key=lambda d: d["date"], reverse=True)}
    if not args.dry_run:
        if _write_if_changed(cache_path, cache):
            written.append("upstream_finals.json")
        if _write_if_changed(out / "index.json", index):
            written.append("index.json")
    else:
        written.append("index.json")

    run = {
        "started_at_utc": started.isoformat(),
        "finished_at_utc": datetime.now(timezone.utc).isoformat(),
        "db": args.db, "out": str(out), "date_filter": args.date, "since": args.since,
        "archived_total": len(archives),
        "delivered_total": len(records),
        "under_excluded_total": len(under_excluded),
        "duplicate_excluded_total": duplicate_excluded,
        "unconfirmed_total": len(unconfirmed),
        "unconfirmed_archive_ids": unconfirmed,
        "days": {d: len(v) for d, v in sorted(by_day.items())},
        "files_written": written,
        "settled_total": upstream_hits,
        "result_status": {k: sum(1 for r in records if r["goal_result_status"] == k.upper())
                          for k in ("pending", "hit", "miss", "review", "abnormal")},
        "blocking": None if upstream_hits == len(records) else "SOME_RESULTS_PENDING_UPSTREAM",
    }
    if not args.dry_run:
        log_dir = Path(args.log_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / f"export-{started.strftime('%Y%m%dT%H%M%SZ')}.json").write_text(_dump(run), encoding="utf-8")
    print(json.dumps(run, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
