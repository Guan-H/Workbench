import { example } from './types';
export const requestFormat = 'POST JSON；请求头 Authorization: Bearer <凭证>，Content-Type: application/json。requestId 必填，1–128 个 ASCII 字母、数字、点、下划线、冒号或连字符，入口全局唯一。articles、words 数组均必填，可为空但合计至少一项。date 可省略，默认首次成功接收时的北京时间日期；显式日期为 YYYY-MM-DD。每次整批替换当天展示，不合并，旧批次保留；超时重试须保留原 requestId 与完全相同的字段，相同编号换内容返回 409，重复重试不提升旧批次为最新。';
export const requestFields = '文章 title、text 必填，translation 可省略；单词 word、meaning 必填，phonetic、example 可省略。sentences 可省略，提供时须为非空的逐句 text/translation 对照，每篇最多 2000 对、每句原文与译文各 4000 个 Java 字符；按顺序拼接须与全文及完整译文一致，比较忽略 Unicode 空白。不提供对照时不会自动切句或翻译。';
export const requestLimits = 'JSON 最大 1 MiB；每批最多 10 篇文章、400 个单词。文章标题 200、正文及译文各 100000、单词 100、音标 200、释义 2000、例句 4000 个 Java 字符。每分钟最多 60 次已认证提交，包含重试和格式错误。生产使用 HTTPS；接收方不抓取链接、不执行 HTML、不接收附件，不读写笔记或保险库。';
/** Copying documentation always uses a placeholder, never a live credential. */
export function webhookRequestGuide(url: string) {
    return ['每日文章 Webhook 接入说明', `接收地址：${url}`, '方法：POST', 'Content-Type: application/json',
        'Authorization: Bearer <凭证>', '', requestFormat, '', requestFields, '', 'JSON 示例：', example, '', '限制：', requestLimits].join('\n');
}
