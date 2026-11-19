# 滚球推送结果归档运维说明

## 1. 角色与边界

- `tools/export_live_results.py`：唯一的数据生成器，**只读**打开 V4 运行时库，产出 `data/live-results/`。
- 站点：纯静态，无后端、无凭据、无写入能力。
- 本流程不修改 V4 模型、阈值、推送逻辑，不写 V4 生产表。

## 2. 手动导出

```powershell
cd e:\V4\v4\sports-analytics
python tools\export_live_results.py
```

可选参数：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--db` | `E:\LiveOU\data\live_snapshots.db` | V4 归档库 |
| `--out` | `<repo>\data\live-results` | 输出目录 |
| `--log-dir` | `<repo>\..\live-results-work\logs` | 运行摘要日志（不进仓库） |
| `--date` | 全部 | 只导出某个北京时间日期 |
| `--dry-run` | 关 | 只计算不落盘 |

运行摘要为一行 JSON（同时落盘 `export-<UTC>.json`），包含 `archived_total`、`delivered_total`、`unconfirmed_archive_ids`、`days`、`files_written`、`result_status`、`blocking`。

## 3. 幂等与提交策略

- 内容无变化时**不重写文件**（比较时忽略 `generated_at_utc`），避免产生空提交。
- 有变化时只重写受影响的 `days/*.json` 和 `index.json`。
- 建议的做法：导出后 `git diff --stat`，只有真实新增/结算才提交到功能分支。

## 4. 只读保证

```python
sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
```

- 未开启 WAL 写连接，不会产生 `-wal`/`-shm` 写入。
- 不访问 `/api/alert-archive` 的写接口；页面只读静态 JSON。
- 已验证连续两次导出第二次 `files_written` 为空。

## 5. 「成功推送」口径

一条推送进入公开归档需同时满足：

1. `alert_delivery_receipts` 中存在 `stage='queued'`（后端已发出）；
2. 至少一条 `stage='client_received'`（客户端确认收到）。

仅 `queued` 而无客户端回执的推送记为 `UNCONFIRMED`，写入运行摘要的 `unconfirmed_archive_ids`，**不进入公开页面**，需人工审计。

## 6. 当前阻塞状态

`result_status` 中所有记录为 `PENDING`，`blocking = NO_FINAL_SCORE_SOURCE`：

- V4 当前没有可追溯的终场比分来源（`fixture_outcomes` 仅有半场记录）。
- 因此不会安装定时任务、不会推送「命中」或「未命中」结论。
- 终场来源补齐后，只需在导出器中接入该来源并重算 `full_time_goals / goals_after_push / goal_result_status`，页面无需改动即可展示印章。

## 7. 本地预览

```powershell
cd e:\V4\v4\sports-analytics
python -m http.server 8123 --bind 127.0.0.1
# 打开 http://127.0.0.1:8123/
```

直接双击 `index.html` 不可用（ES module + fetch 受 `file://` 限制）。

## 8. 发布

- 目标站点：`https://gaobaobao0916-cpu.github.io/sports-analytics/`，来源为 Pages `master` 根目录。
- 仓库另有 EdgeOne 工作流，`master` push 会同时触发。
- 本次改动仅在 `feature/live-push-results-center` 分支，未推 `master`，不会触发任何发布链。
- 合并前需人工确认页面与数据后再决定发布时机。

## 9. 故障处理

| 现象 | 处理 |
|---|---|
| 页面顶部出现红色「数据加载失败」 | 检查 `index.json` 是否可访问；修复后刷新，页面不会把失败渲染成 0 条 |
| 某日展开报错 | 点击该日「重新加载」；确认 `days/日期.json` 存在且为合法 JSON |
| 统计与表格不一致 | 确认是否正在加载其余日期（提示条会显示「正在加载其余日期…」） |
| 导出报 `database is locked` | V4 正在写库；等待后重试，只读连接不会阻塞 V4 |
