# V4 滚球推送源映射报告（Phase 0）

- 任务编号：`V4-LIVE-PUSH-RESULT-CENTER-001`
- 审计日期：2026-11-18（Asia/Shanghai）
- 审计模式：全程只读（SQLite `mode=ro` + 本地 HTTP GET）
- 总体结论：**BLOCKED（局部）** —— 推送成功记录与推送瞬间快照均真实存在且可追溯；**终场比分来源当前不存在**，无法计算 `goals_after_push` 与 `HIT/MISS`。

---

## 1. 仓库与发布基线

| 项目 | 实测结果 | 证据 |
|---|---|---|
| 工作副本 | `e:\V4\v4\sports-analytics`（干净克隆） | 本次审计新建 |
| 分支 / HEAD | `master` → 已切出 `feature/live-push-results-center` / `9f91bc00bf97cca46768611d7a434397d6a39cf9` | `git log -1` |
| 工作区 | 无未提交改动 | `git status --porcelain` 空 |
| 基线文件 SHA | `index.html` `0d958a38…`、`script.js` `dc7f43f8…`、`styles.css` `bbeb5e7d…`、`README.md` `c17bb0c9…`、`deploy.yml` `dfec4ee9…` | 与任务书第二节完全一致 |
| GitHub Pages | `build_type=legacy`，`source.branch=master`，`source.path=/`，`status=built`，URL `https://gaobaobao0916-cpu.github.io/sports-analytics/` | `gh api repos/…/pages` |
| 另一条发布链 | `.github/workflows/deploy.yml` 于 `master` push 时部署 EdgeOne Pages（`tcli teo DeployZoneConfigVersion`） | 工作流文件 + `gh api …/actions/workflows`（`pages-build-deployment` 与 EdgeOne 两条均 active） |

结论：目标 URL 的发布来源就是 Pages `master` 根目录，符合预期；但同时存在 EdgeOne 第二发布链。
**风险控制：本次全程在功能分支施工，不 push `master`，不会触发任何一条发布链。**

## 2. 现有 Supabase 用途（只确认，未改动）

`script.js` 使用 Supabase `analyses` 表（`select/insert/update`），并含前端硬编码管理口令 `PASSWORD`。
本次任务**不复用**该表，也不把口令当作任何上传链路凭据；新页面为纯静态只读页。

## 3. 推送数据源定位

V4 唯一的「推送成功记录 + 推送瞬间快照」来源：

```
E:\LiveOU\data\live_snapshots.db            （SQLite，80 MB）
  └─ 由 D:\LiveOU_V4\app.py:354 AlertArchiveRuntime(AlertArchiveStore(...)) 写入
  └─ 表结构/写入：D:\LiveOU_V4\live_engine\alert_archive.py（SCHEMA_VERSION = ALERT_ARCHIVE_V1）
  └─ 补偿日志：E:\LiveOU\data\alert_archive_compensation.jsonl
  └─ 只读 API：GET http://127.0.0.1:5050/api/alert-archive（仅 127.0.0.1/localhost）
     D:\LiveOU_V4\live_engine\alert_archive_api.py
```

实测数据量（2026-11-18 09:1x）：

| 表 | 行数 | 说明 |
|---|---|---|
| `alert_archive` | 61 | 推送事件主表，含冻结 `snapshot_json` |
| `alert_delivery_receipts` | 255 | 投递回执（后端排队 / 客户端接收 / 弹窗 / 声音） |
| `alert_notification_links` | 153 | 通知 ID ↔ archive_id 映射 |
| `fixture_outcomes` | 44 | 仅 `status=HT`、`period=HT` 的半场结果 |
| `alert_settlements` | 1 | 结算记录（`OBSERVATION_RESULT_ONLY`） |
| `snapshots` / `normalized_snapshots` | 1231 / 1231 | 另一条采集链路的分钟快照（**不是**推送快照来源） |
| `production_signals` / `alerts` / `soft_alerts` / `odds_ticks` | 0 / 0 / 0 / 0 | 空表，不作为来源 |

推送时间跨度（北京时间）：`2026-11-12` 3 条、`11-13` 6 条、`11-14` 7 条、`11-15` 15 条、`11-16` 4 条、`11-17` 21 条、`11-18` 5 条；共 44 场不同比赛。

## 4. 如何确认一次推送「发送成功」

`alert_delivery_receipts.stage` 实测取值：

| stage | client_kind | 记录数 | failure_reason |
|---|---|---|---|
| `queued` | BACKEND | 61 | 全部为空 |
| `client_received` | DESKTOP | 58 | 全部为空 |
| `popup_shown` | DESKTOP | 58 | 全部为空 |
| `sound_api_called` | DESKTOP | 56 | 全部为空 |
| `client_received` / `popup_shown` | WEB | 5 | 全部为空 |
| `popup_api_called` / `sound_api_called` | WEB | 3 / 3 | 全部为空 |
| `popup_disabled` / `sound_disabled` | WEB/DESKTOP | 2 / 2 / 2 | 全部为空 |

判定口径（本次采用）：

> **成功推送 = 后端 `queued` 回执存在，且至少一条客户端 `client_received` 回执存在。**

结果：**61 条中 58 条成功**；3 条仅有 `queued`、无任何客户端接收回执，判为「未确认送达」，不计入推送总数，单独审计：

| archive_id | signal_type | 北京时间 |
|---|---|---|
| `37d50194-e180-5d80-8eca-9339d30fca60` | HT_SOFT_OVER | 2026-11-15 20:04:03 |
| `1ce2117a-f628-587e-8a2a-c5ac2463fbe7` | FT_SOFT_OVER | 2026-11-17 10:21:45 |
| `25d1829e-0c1b-58c0-ba27-4e6c44f85297` | FT_FORMAL_OVER | 2026-11-17 10:31:14 |

`popup_disabled` / `sound_disabled` 属于客户端偏好，不影响「已送达」。

## 5. `push_id` 唯一性

- `push_id` = `alert_archive.archive_id`（UUID4 文本，主键）。
- 表级唯一约束 `UNIQUE(backend_instance_id, source_notification_kind, source_notification_id)` 保证同一通知不会重复归档。
- 同一场比赛多次推送 → 多个 `archive_id`：实测 44 场对应 61 条推送，最多一场 3 条，符合任务书 §4.3「不得按 match_id 合并」。

## 6. 推送瞬间快照：真实冻结，无需反推

`alert_archive.snapshot_json` 在**推送当时**写入，之后不再变更；本次不读取 `snapshots` 表反推历史。字段覆盖实测（61 条）：

| 快照字段 | 有值 | 缺失 |
|---|---|---|
| `signal_minute` | 61 | 0 |
| `score_home` / `score_away` | 61 / 61 | 0 |
| `period`（1H/2H/HT 等） | 61 | 0 |
| `ou_line` / `over_decimal` / `under_decimal` | 47 | 14（全部为 `FT_PRESSURE_OBSERVATION`，无有效 FT 盘口） |
| `model_score` | 35 | 26 |
| `field_pressure` | 55 | 6 |
| `market_pressure` | 44 | 17 |
| `company_name` | 47 | 14 |
| `kickoff_utc` / `league_name_at_alert` / 队名 | 61 | 0 |

**空值保持为空，不补 0。**

## 7. 字段映射表

源路径统一记作 `alert_archive.snapshot_json.*` 或 `alert_archive.*` / `alert_delivery_receipts.*`。

| 标准字段 | 源表 / 源字段 | 解析规则 | 缺失行为 | 验证证据 |
|---|---|---|---|---|
| `push_id` | `alert_archive.archive_id` | 原样 | 缺失则整条丢弃并告警 | 主键，61 条无重复 |
| `match_id` | `alert_archive.canonical_fixture_id` | 原样（形如 `7m:5198621`） | 缺失则丢弃 | 61/61 有值 |
| `sport` | 常量 | 固定 `football` | —— | 全部为 7M 足球赛事 |
| `league` | `alert_archive.league_name_at_alert`（列，61/61 有值）；`snapshot_json.league_name_at_alert` 全部为 null | 列优先，快照兜底 | `—` | 61/61 有值 |
| `home_team` / `away_team` | `snapshot_json.home_name_at_alert` / `away_name_at_alert` | 原样 | `—` | 61/61 有值 |
| `push_sent_at_utc` | `alert_archive.alert_created_at_utc`（与 `queued` 回执相差 0.003–0.063 秒） | ISO-8601 UTC 原样 | 缺失则丢弃 | 61/61 有值 |
| `push_minute_display` | `snapshot_json.signal_minute` | `f"{n}′"`；无补时字段，不编造 `45+2′` | `—` | 61/61 有值 |
| `push_minute_value` | 同上 | 整数 | `null` | 同上 |
| `push_home_score` / `push_away_score` | `snapshot_json.score_home` / `score_away` | 整数原样，**NULL ≠ 0** | `null` → `REVIEW` | 61/61 有值 |
| `market_period` | `alert_archive.market_scope`（`FT` / `HT`） | 原样 | `—` | 61/61 有值 |
| `market_type` | 由 `signal_type` 后缀 `_OVER` 判定为 `OU` | 本数据源只有 OU，无 AH 记录 | `—` | 61/61 均为 `*_OVER` |
| `market_line` | `snapshot_json.ou_line` | 以字符串保存，保留 `2.0` / `2.25` 原精度 | `null`（14 条压力观察） | 47/61 有值 |
| `alert_level` | `alert_archive.source_notification_kind`（`formal` / `soft`） | `formal`→强提醒，`soft`→软提醒 | `—` | formal 10 / soft 51 |
| `record_class` | `alert_archive.observation_only` + `signal_type` | `1`→观察记录；`0`→正式预测（`FT_SOFT_OVER` 为通过质量门的软预测，非观察） | `—` | 观察 29 / 正式 32 |
| `model_score` | `snapshot_json.model_score` | 原样，不重算 | `null` → `—` | 35/61 有值 |
| `send_status` | 回执聚合 | 见第 4 节 | —— | 58 成功 / 3 未确认 |
| `match_status` | `fixture_outcomes`（仅 HT） | 当前**无法取得** `FT/FINISHED` | 全部 `PENDING` | 见第 8 节 |
| `final_home_score` / `final_away_score` | **无来源** | —— | `null` | **BLOCKED** |
| `half_time_home_score` / `half_time_away_score` | `fixture_outcomes.evidence_json.score_home/away`（`period=HT`） | 原样 | `null` → `—` | 覆盖 7 场 / 13 条推送 |
| `full_time_goals` / `goals_after_push` / `goal_result_status` | 依赖终场比分 | —— | 一律 `PENDING` | **BLOCKED** |
| `settled_at_utc` | `alert_settlements.settled_at_utc` | 原样 | `null` | 仅 1 条历史结算 |
| `source_updated_at_utc` | `fixture_outcomes.evidence_json.source_timestamp` | 原样 | `null` | HT 有值 |

## 8. 终场比分来源核验（阻塞项）

| 候选来源 | 实测 | 结论 |
|---|---|---|
| `fixture_outcomes` | 44 行，**全部** `period=HT`、`status=HT`、`regular_time=false`；FT/FINISHED 行数 = **0** | 无终场比分 |
| `snapshots` 表 | 968 LIVE / 256 HALF_TIME / **7 FINISHED**；7 条 FINISHED 的 `match_id` 与 61 条推送的比赛**交集为 0**，且均采集于 2026-11-14 的一次旧会话 | 不能用于推送比赛 |
| `SEVENM_NATIVE_COLLECTOR.previous`（运行时内存） | 采集器只处理 `status in {LIVE, HALF_TIME}`（`sevenm_native_collector.py:983`），轮次级字典，进程重启即丢 | 无持久化终场数据 |
| `reconcile_existing_results()` | 仅在 `row["regular_time_verified"] is True` 时写 FT outcome；全仓库检索该键**只出现在该判断和测试中，没有任何生产写入方** | FT outcome 永远不会生成 |
| `alert_settlements` | 1 行，`OBSERVATION_RESULT_ONLY`，无比分 | 不可用 |

因此：**61 条推送当前全部只能落到 `PENDING`（待完场）**，`HIT/MISS` 一条也无法计算。这不是抓取延迟，而是 V4 目前不存在持久化的终场比分来源。

按任务书 §14 停止条件「终场比分来源不明确或无法确认比赛身份」，Phase 3（完场核对 / 日归档结算）与 Phase 4 真实数据验收标记 **BLOCKED**，等待所有者决策。

## 9. 缺失字段汇总

| 标准字段 | 状态 |
|---|---|
| `final_home_score` / `final_away_score` | **完全缺失** |
| `match_status`（FT / ABANDONED 等终态） | **完全缺失** |
| `full_time_goals` / `goals_after_push` / `goal_result_status` | 因上两项无法产出，全部 `PENDING` |
| `half_time_*_score` | 部分缺失（7 场 / 13 条有证据） |
| `market_type=AH` | 数据源无 AH 推送，仅 OU |
| `push_minute_display` 的补时（`45+2′`） | 快照无补时字段，只输出整数分钟 |
| `company_id` | 列有 47/61，仅作内部审计，不进入公开归档 |
| `model_score` | 26 条为 NULL（观察类） |

## 10. 历史可追溯性与只读性

- 追溯证据：`snapshot_json` + `snapshot_hash`（SHA-256）在推送瞬间冻结；`alert_delivery_receipts` 记录各阶段真实时刻；`alert_notification_links` 提供通知 ID 反查。
- 读取路径：`sqlite3.connect("file:E:/LiveOU/data/live_snapshots.db?mode=ro", uri=True)` 或本地 API `GET /api/alert-archive`。
- 写操作：**0**。未对 V4 任何表执行 INSERT / UPDATE / DELETE，未修改模型、阈值、推送逻辑，未重启后端进程。

## 11. 需所有者决策

1. 是否提供可追溯的终场比分来源（V4 内部已有且可证明比赛身份的来源），以解除 Phase 3 阻塞；
2. 是否接受「先用真实推送快照上线页面，所有结果列显示待完场，待终场来源就绪后自动补算」的交付方式；
3. 施工样板 `滚球推送结果统计中心_样板.html` 本机缺失，页面视觉暂按任务书第五节文字规范实现，样板到位后再做像素级对齐。
