# Canvas Flow · 外部团队使用说明 / For External Teams

**Project**: [arkstudio-ai/arkstudio-canvas](https://github.com/arkstudio-ai/arkstudio-canvas)  
**Owner**: 吴潇洋 (Wu Xiaoyang)  
**Contact**: bbdwxh@gmail.com

---

## 项目定位 / Overview

Canvas Flow 是一款**节点式 AI 创作画布** —— 把文本 / 图片 / 视频 / 音频生成做成可拖拽节点 pipeline 的本地优先工具。**桌面端 (Electron) + Docker 自部署**两种形态。

Canvas Flow is a **node-based AI creation canvas** — text / image / video / audio generation as a draggable pipeline. Available as a **desktop app (Electron)** and a **self-hostable Docker stack**.

---

## License 模式（关键，请先读）

本项目采用 **双协议（dual-license）** 模式：

| 协议 | 适用场景 | 限制 |
|---|---|---|
| **[AGPL-3.0](../LICENSE)**（默认） | 内部使用 / 学习研究 / 二次开发后**完整开源回馈** | 任何对外提供的服务（包括 SaaS）必须开源全部源码（§13 网络条款） |
| **[商业许可](../LICENSE-COMMERCIAL.md)** | 闭源商用 / SaaS / 私有化交付 / 去除开源标识等 | 一对一签合同，按使用规模定价 |

This project is **dual-licensed**: AGPL-3.0 by default, with a separate **Commercial License** available for use cases that can't comply with AGPL's reciprocity (closed-source SaaS, proprietary embedding, on-premise delivery without source, removal of attribution).

---

## 决策树 · 你想做什么？

### 🅐 我只是想试用 / 学习这个项目

直接 clone 即可，遵守 [AGPL-3.0](../LICENSE)。运行 `docker compose up -d` 或下载桌面端安装包，5 分钟跑起来。**无需联系我们。**

### 🅑 我想自己部署，公司内部用（员工内网访问）

可以，**走 AGPL-3.0 即可**。AGPL 不限制内部使用。详见 [docs/deployment.md](./deployment.md)。

### 🅒 我想对外提供 SaaS / Web 服务（让公司外用户访问）

⚠️ 如果你**对外提供的服务基于本项目**（包括修改版），AGPL §13 要求你**对所有用户开源完整修改后的源码**。

两种合规路径：
- **维持 AGPL** → 把你的修改 fork 公开 + 在你的服务里给用户提供源码下载入口
- **购买商业许可** → 闭源运营，无需对外开放源码。**邮件 bbdwxh@gmail.com 询价**

### 🅓 我想集成进自己的闭源产品对外销售

⚠️ AGPL 在这种场景下**不允许**。**必须购买商业许可。** 邮件 bbdwxh@gmail.com，注明：
- 你的产品名 + 目标客户群
- 集成形态（SDK / 私有部署 / SaaS embedded 等）
- 预计年部署量

### 🅔 我想私有化交付给企业客户（无源码交付）

⚠️ 同 🅓，**必须商业许可**。AGPL 不允许移除源码 / 移除 attribution。

### 🅕 我想做二次开发 + 对外卖（"二开"）

参考 🅓 / 🅔。**强烈建议**先评估你的商业模式跟 AGPL 是否兼容：
- 兼容（你 OK 把改动也开源）→ 走 AGPL 即可，无需许可证
- 不兼容（你要闭源 / 卖闭源版本）→ 必须商业许可

### 🅖 我个人想给项目贡献代码

走 [CONTRIBUTING.md](../CONTRIBUTING.md)：fork → 改 → PR → 签 [CLA.md](../CLA.md)（PR 下评论一句签字语，bot 自动记录）→ owner review → merge。

### 🅗 我们公司想派员工给项目贡献代码

走 [CONTRIBUTING.md](../CONTRIBUTING.md) 的 **公司版 CCLA** 路径：

1. 下载 [CLA-CORPORATE.md](../CLA-CORPORATE.md) 填写公司信息 + 附件 A 授权员工名单
2. 法人 / 授权签字人签字盖章后扫描
3. 邮件 bbdwxh@gmail.com，主题 `[CCLA] 公司名`
4. 我方书面确认后，附件 A 中的 GitHub 账号会加入 CLA bot allowlist
5. 之后 PR 自动免签

### 🅘 我们公司想跟项目方深度合作（联合产品 / 商业代理 / 战略合作）

邮件 bbdwxh@gmail.com，主题 `[合作] 公司名 + 一句话说明意图`。我们会安排电话或当面沟通。

---

## 商业许可询价 / Commercial License Inquiry

发邮件到 **bbdwxh@gmail.com**，主题加 `[Commercial]` 前缀。请说明：

- 公司名 + 简介
- 使用场景（参考决策树 🅒 ~ 🅖）
- 预计部署规模（用户数 / 服务器数 / 客户数）
- 是否需要技术支持 / 升级订阅 / 品牌定制等增值服务
- 预算区间（可选）

7 个工作日内回复。

---

## 安全漏洞报告 / Reporting Vulnerabilities

**不要公开提交 Issue。** 邮件 bbdwxh@gmail.com，主题 `[SECURITY]`。详见 [SECURITY.md](../SECURITY.md)。

---

## 常见问答 / FAQ

**Q1：我们公司在私有网络内部署，没人能从外面访问，需要商业许可吗？**  
A：不需要。AGPL 只在你"对外提供服务"时触发开源义务。纯内网使用走 AGPL 即可。

**Q2：我能拿这个 fork 一份改名后卖给我的客户吗？**  
A：AGPL 允许 fork 和重新分发，但你的 fork 必须**也是 AGPL**，且必须保留原始版权信息。如果你想闭源版本 / 移除原始 attribution，需商业许可。

**Q3：我们已经 fork 了一段时间，现在想合规怎么办？**  
A：邮件告诉我们当前部署形态，我们会评估是按"既往不咎+签后约定"还是"补缴许可费"处理。**主动联系比被发现后处理友好得多。**

**Q4：商业许可大概多少钱？**  
A：没有公开标价，按你的使用规模一对一定价。最小起价覆盖小型团队场景，到大型企业 SaaS 不等。邮件详谈。

**Q5：CLA 是不是要交出版权？**  
A：不是。CLA 只是**许可**，你保留贡献的版权，只是允许项目方按任何协议（包括商业协议）再分发。详见 [CLA.md](../CLA.md) §2-§4。
