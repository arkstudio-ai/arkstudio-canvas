# 贡献指南 / Contributing Guide

感谢你有兴趣为 **Canvas Flow** 贡献代码！

Thanks for your interest in contributing to **Canvas Flow**!

---

## 1. 签署 CLA（必读）/ Sign the CLA (required)

Canvas Flow 采用 **AGPL-3.0 + 商业许可**双协议模式。为保证项目持续运营与商业授权能力，**所有外部贡献者**在其第一个 Pull Request 被合并前，必须签署贡献者许可协议（CLA）。

Canvas Flow uses a **dual-license model (AGPL-3.0 + Commercial)**. To sustain the project and preserve commercial licensing capability, **all external contributors** must sign a Contributor License Agreement (CLA) before their first PR is merged.

### 个人贡献者 / Individual contributors

阅读 [`CLA.md`](./CLA.md)，然后在你的 PR 下评论：

Read [`CLA.md`](./CLA.md), then comment on your PR:

> `I have read the CLA Document and I hereby sign the CLA`

CLA bot 会自动记录你的签名，今后所有 PR 都无需重复签署。

The CLA bot will record your signature; future PRs from the same GitHub account need not re-sign.

### 公司贡献者 / Corporate contributors

如果你是**以公司名义**或**在职务范围内**为本项目贡献代码，请走 [`CLA-CORPORATE.md`](./CLA-CORPORATE.md) 公司版流程：

If you are contributing **on behalf of a company** or **within the scope of your employment**, please follow the corporate process in [`CLA-CORPORATE.md`](./CLA-CORPORATE.md):

1. 填写公司信息与附件 A 中的授权贡献者名单
2. 由公司法人/授权签字人签字盖章后扫描
3. 发送至本项目商业邮箱（见 README）
4. 经确认后，附件 A 中的 GitHub 账号将加入 CLA bot allowlist，无需再每个 PR 签 ICLA

⚠️ **如果你是某公司员工但提交的是个人项目（非职务作品）**，请确认你已获得雇主允许，再签个人版 ICLA。否则签 CCLA。

⚠️ **If you are employed but contributing on personal time (not work-for-hire)**, please confirm you have employer authorization before signing the ICLA. Otherwise, use the CCLA.

---

## 2. 提交规范 / Commit Convention

请使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

Please use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat(scope): short description
fix(scope): short description
docs: ...
chore: ...
```

---

## 3. 代码规范 / Code Style

- TypeScript / JavaScript 文件单文件 ≤ 400 行非注释代码；超过 300 行考虑拆分
- 提交前请运行 `pnpm typecheck` 与 `pnpm --filter canvas-flow-backend test`
- UI / 文案变更优先复用现有 i18n 命名空间（`apps/web/src/i18n/locales/{zh,en}`）

---

## 4. 报告问题 / Reporting Issues

- 使用 GitHub Issues
- 安全漏洞**不要公开提交**，请发送至项目商业邮箱（见 README）

---

## 5. 联系 / Contact

- 一般问题：GitHub Issues
- 商业合作 / CCLA / 安全报告：邮件 **bbdwxh@gmail.com**，详见 [外部团队指南](./docs/external-teams.md)
