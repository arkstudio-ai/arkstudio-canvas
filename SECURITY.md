# 安全策略 / Security Policy

## 报告漏洞 / Reporting a Vulnerability

发现安全漏洞请**不要公开提交 Issue / Pull Request**。请通过邮件发送至 **bbdwxh@gmail.com**，主题加 `[SECURITY]` 前缀。

邮件中请说明：

- 漏洞类型与影响范围
- 复现步骤（如果可能附上 PoC）
- 受影响的版本 / commit
- 你期望的披露时间窗口（默认协调披露：修复后 30 天，或漏洞被公开利用时立即公开）

我们会在 **72 小时**内确认收到，评估严重性后告知预计修复时间。修复发布后，会在 [GitHub Security Advisories](https://github.com/arkstudio-ai/arkstudio-canvas/security/advisories) 公开致谢报告者（如你愿意署名）。

---

Please **do not file public Issues or Pull Requests** for security vulnerabilities. Email **bbdwxh@gmail.com** with the subject prefix `[SECURITY]` instead.

Include in your report:

- Vulnerability type and scope of impact
- Reproduction steps (PoC welcome)
- Affected version / commit
- Your preferred disclosure window (default coordinated disclosure: 30 days post-fix, or immediate if actively exploited)

We aim to acknowledge within **72 hours**, assess severity, and share an estimated fix timeline. Once patched, we will credit you on [GitHub Security Advisories](https://github.com/arkstudio-ai/arkstudio-canvas/security/advisories) (with your permission).

## 适用范围 / Scope

- ✅ Canvas Flow 主仓库代码（backend / web / desktop / packages/core）
- ✅ 默认 Docker 部署配置（`docker-compose.yml` / `apps/backend/Dockerfile`）
- ❌ 第三方依赖（请直接向上游报告，但 CVSS ≥ 7.0 的关键依赖问题欢迎转报）
- ❌ 用户自行修改后的衍生部署
