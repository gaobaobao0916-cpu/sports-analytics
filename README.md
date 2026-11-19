# 滚球推送结果统计中心

V4 滚球推送的公开归档页：按北京时间日期归档每一次已确认送达的推送，并跟踪推送后至终场的进球结果。

**访问地址**：https://gaobaobao0916-cpu.github.io/sports-analytics/

## 页面能力

- 顶部统计：推送总次数、强提醒、软提醒、推送后进球数、推送后进球率、待完场
- 日期折叠：单窗口展开，默认展开最新有记录的日期
- 每日明细表：推送时间、级别、类型、比赛、联赛、推送时分/比分、盘口、终场比分、半场比分、模型分、内容性质、全场总进球、推送后新增进球、进球结果
- 红/绿 45° 印章显示「命中 / 未命中」，灰签显示「待完场 / 待核验 / 比赛异常」
- 筛选与搜索：强提醒、软提醒、正式预测、观察记录、命中、未命中、待完场·待核验；支持比赛名/联赛/日期搜索
- 纯静态只读，无后端、无凭据

## 数据

页面数据位于 `data/live-results/`，由只读导出器生成：

```powershell
python tools\export_live_results.py
```

- 数据契约：[docs/LIVE_RESULTS_DATA_CONTRACT.md](docs/LIVE_RESULTS_DATA_CONTRACT.md)
- 运维说明：[docs/LIVE_RESULTS_OPERATIONS.md](docs/LIVE_RESULTS_OPERATIONS.md)
- 源字段映射：[docs/LIVE_PUSH_SOURCE_MAPPING.md](docs/LIVE_PUSH_SOURCE_MAPPING.md)
- 测试报告：[docs/LIVE_RESULTS_TEST_REPORT.md](docs/LIVE_RESULTS_TEST_REPORT.md)

## 本地预览

```powershell
python -m http.server 8123 --bind 127.0.0.1
# http://127.0.0.1:8123/
```

需通过 HTTP 访问，直接打开 `index.html` 不可用（ES module + fetch 限制）。

## 技术栈

- 原生 HTML / CSS / ES Module，无构建步骤
- 数据为静态 JSON，按日懒加载
- GitHub Pages（`master` 根目录）发布

## 说明

- 旧版页面的赛前分析录入、Supabase `analyses` 表与管理员口令入口已从前端移除；`analyses` 表本身及其历史数据未做任何清理。
- 当前 V4 尚无持久化终场比分来源，因此页面所有记录结果均为「待完场」，不展示任何命中率。终场来源补齐后只需重跑导出器。
