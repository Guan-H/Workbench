# 内置平台头像来源

SVG 来自 [Simple Icons](https://github.com/simple-icons/simple-icons/tree/e451c581fccb01b56f47e1a77292bdd1fd95b1a4/icons)，主要固定提交为 `e451c581fccb01b56f47e1a77292bdd1fd95b1a4`。该快照不含 OpenAI 图标，因此 ChatGPT 使用 [v14.0.0 的 OpenAI 图标](https://github.com/simple-icons/simple-icons/blob/6dcfdc2f58f6150d7b097b5cab158d27413f6366/icons/openai.svg)，对应提交 `6dcfdc2f58f6150d7b097b5cab158d27413f6366`。两版 CC0 声明分别保存在 `LICENSE.simple-icons.md`、`LICENSE.simple-icons-v14.md`；每个文件的固定提交及 SHA-256 见 `sources.json`。OpenAI 标志属于 OpenAI，使用场景仅为其服务的条目识别，[品牌说明](https://openai.com/brand/)另行适用；不表示平台授权或关联。

25 个平台选项使用 24 个 SVG；抖音与 TikTok 使用同一音乐符号图形，但保留不同的选项名称和加密标识。显示颜色是本应用的预设，未声明为各平台官方完整视觉规范；OpenAI 图形保持黑色。

应用构建时将全部 SVG 嵌入本地包，显示时使用 data URL，不根据所选平台或条目网址请求远程图标、CDN 或网站 favicon。用户不能在 icon 字段提供远程 URL 或 SVG；自定义图片由浏览器生成有界 PNG 小头像，同样进入加密载荷。选中的标识或自定义内容和其他条目字段一起加密，不增加后端字段或明文接口。

如需明确更新资源，在仓库根目录手动执行 `./frontend/scripts/vendor-vault-icons.ps1`。脚本只从固定来源下载这些 SVG 和许可证，拒绝主动内容，再写入本目录及校验清单；构建、启动和用户选择头像不会执行该脚本。
