# 滚球推送结果归档数据契约

- 版本：`live-results-index-1` / `live-results-day-1`
- 机器可读定义：[schema.json](../data/live-results/schema.json)
- 时区：所有日期归属按 `Asia/Shanghai`；文件内同时保留 UTC 原始时间与本地时间。

## 文件布局

```
data/live-results/
├── schema.json            # JSON Schema（index + day 两种形态）
├── index.json             # 日期索引 + 每日汇总，按日期倒序
└── days/YYYY-MM-DD.json   # 单日明细，最多约 20 条/日
```

## index.json

```json
{
  "schema_version": "live-results-index-1",
  "timezone": "Asia/Shanghai",
  "generated_at_utc": "2026-11-18T01:26:56+00:00",
  "days": [
    {"date": "2026-11-18", "file": "days/2026-11-18.json",
     "push_total": 5, "formal": 1, "soft": 4, "settled": 0,
     "hit": 0, "miss": 0, "pending": 5, "review": 0, "abnormal": 0}
  ]
}
```

- 没有推送的日期不写入 `days`，前端也不会渲染空窗口。
- 前端首屏只读 `index.json` 即可展示统计与日期列表，展开某日时才拉取该日文件。

## days/YYYY-MM-DD.json

```json
{
  "schema_version": "live-results-day-1",
  "date": "2026-11-18",
  "timezone": "Asia/Shanghai",
  "generated_at_utc": "2026-11-18T01:26:56+00:00",
  "summary": { "...": "同 index 中该日字段，另含 goal_after_push_count / hit_rate / hit_rate_denominator" },
  "records": [ { "...": "见下表" } ]
}
```

## 记录字段

| 字段 | 类型 | 含义 | 缺失语义 |
|---|---|---|---|
| `push_id` | string | 推送唯一标识（= V4 `archive_id`），同场多次推送各自独立 | 无此字段的记录不入库 |
| `match_id` | string | 比赛标识（`7m:<id>`） | —— |
| `sport` | string | 固定 `football` | —— |
| `league` | string/null | 联赛 | `null` |
| `home_team` / `away_team` | string/null | 队名 | `null` |
| `push_sent_at_utc` | string | 推送时间（UTC ISO-8601） | 必需 |
| `push_sent_at_local` | string | 推送时间（+08:00） | 必需 |
| `push_minute_display` / `push_minute_value` | string/int/null | 推送时比赛分钟，只输出整数分钟，不编造补时 | `null` |
| `push_home_score` / `push_away_score` | int/null | 推送瞬间比分 | `null`，**不得当 0** |
| `market_period` | string | `FT` / `HT` | `null` |
| `market_type` | `OU` / `AH` / null | 当前数据源只有 `OU` | `null` |
| `market_line` | string/null | 盘口线，保留原始精度（如 `"2.25"`） | `null` |
| `market_odds_over` / `market_odds_under` | number/null | 推送时欧赔 | `null` |
| `alert_level` | `formal` / `soft` | 强提醒 / 软提醒 | —— |
| `record_class` | `prediction` / `observation` | 正式预测 / 观察记录 | —— |
| `signal_type` | string | V4 原始信号类型，供审计 | —— |
| `model_score` | number/null | 推送时模型分 | `null` |
| `send_status` | `DELIVERED` / `UNCONFIRMED` | 是否确认送达（仅 `DELIVERED` 进入公开归档） | —— |
| `match_status` | `FT`/`LIVE`/`POSTPONED`/`ABANDONED`/null | 终场状态 | `null` = 未知 |
| `final_home_score` / `final_away_score` | int/null | 终场比分 | `null` |
| `half_time_home_score` / `half_time_away_score` | int/null | 半场比分 | `null` |
| `full_time_goals` / `goals_after_push` | int/null | 全场总进球 / 推送后新增进球 | `null` |
| `goal_result_status` | `HIT`/`MISS`/`PENDING`/`REVIEW`/`ABNORMAL` | 进球结果 | —— |
| `result_note` | string/null | 未结算原因（如 `NO_FINAL_SCORE_SOURCE`） | `null` |
| `settled_at_utc` / `source_updated_at_utc` | string/null | 结算时间 / 结果源更新时间 | `null` |

## 结果状态机

```
推送成功(DELIVERED)
  ├─ 终场比分缺失            → PENDING（待完场）
  ├─ 完场但终场比分缺失/矛盾  → REVIEW（待核验）
  ├─ 腰斩/取消/延期           → ABNORMAL（比赛异常）
  ├─ goals_after_push >= 1   → HIT（命中）
  └─ goals_after_push == 0   → MISS（未命中）
```

`goals_after_push = 终场总进球 − 推送时总进球`，不得为负；为负一律 `REVIEW`，不得截断为 0。

## 不进入公开归档的字段

推送渠道 ID、客户端标识、接收人、完整内部通知对象、投递回执原文、任何密钥或口令。公开端为纯静态只读，不含任何凭据。
