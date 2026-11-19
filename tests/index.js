// Node 在 Windows 上会把目录参数当作入口模块解析；
// 该入口确保 `node --test tests/` 能发现并执行测试文件。
import './live-results-core.test.mjs';
