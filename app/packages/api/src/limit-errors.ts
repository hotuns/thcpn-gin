// Public field identifiers are deliberately mapped here; raw server/database text
// and arbitrary labels from the response are never rendered as limit messages.
const fields: Record<string, {
    zh: string;
    en: string;
    action: string;
    actionEn: string;
}> = {
    tag_count: {zh:"自定义标签数量",en:"Custom tags",action:"请删除不需要的标签。",actionEn:"Remove unneeded tags."},
    tag_length: {zh:"单个标签长度",en:"Tag length",action:"请缩短标签。",actionEn:"Shorten the tag."},
    device_description: {zh:"设备描述长度",en:"Device description length",action:"请缩短描述。",actionEn:"Shorten the description."},
    processing_name: { zh: "数据处理任务名称长度", en: "Processing task name length", action: "请缩短名称。", actionEn: "Shorten the name." },
    node_name: { zh: "节点名称长度", en: "Node name length", action: "请缩短名称。", actionEn: "Shorten the name." },
    alert_name: { zh: "预警名称长度", en: "Alert name length", action: "请缩短名称。", actionEn: "Shorten the name." },
    api_key_name: { zh: "API 密钥名称长度", en: "API key name length", action: "请缩短名称。", actionEn: "Shorten the name." },
    atlas_devices: { zh: "一张图选择的设备数量", en: "Devices in an atlas", action: "请减少设备数量。", actionEn: "Select fewer devices." },
    query_days: { zh: "单次数据查询时间范围", en: "A data query", action: "请缩短时间范围，或使用数据导出分段获取。", actionEn: "Select a shorter range or use data export." },
    media_days: { zh: "单次图片查询时间范围", en: "An image query", action: "请缩短时间范围，或分批导出图片。", actionEn: "Select a shorter range or export images in batches." },
    dataset_query_days: { zh: "单次数据集预览时间范围", en: "A dataset preview", action: "请缩短预览时间范围，完整数据可通过数据集导出获取。", actionEn: "Preview a shorter range or export the dataset." },
    query_points: { zh: "单次请求每个指标的数据条数", en: "Records per metric in one request", action: "请减少条数或缩短时间范围；完整数据可使用导出。", actionEn: "Request fewer records, a shorter range, or use export." },
    target_points: { zh: "图表目标点数", en: "Chart target points", action: "请降低目标点数。", actionEn: "Select fewer target points." },
    media_page_size: { zh: "每页图片数量", en: "Images per page", action: "请减少每页数量，翻页查看更多。", actionEn: "Select a smaller page size and browse additional pages." },
    profile_images: { zh: "每台设备的安装照片数量", en: "Installation photos per device", action: "请先删除不需要的照片，再上传新照片。", actionEn: "Remove unneeded photos before uploading more." },
    image_bytes: { zh: "单张安装照片大小", en: "Each installation photo", action: "请压缩图片后重新上传。", actionEn: "Compress the image before uploading." },
    user_name: { zh: "姓名长度", en: "Name length", action: "请缩短姓名。", actionEn: "Shorten the name." },
    workspace_name: { zh: "组织名称长度", en: "Workspace name length", action: "请缩短组织名称。", actionEn: "Shorten the workspace name." },
    atlas_name: { zh: "一张图名称长度", en: "Atlas name length", action: "请缩短名称。", actionEn: "Shorten the name." },
    atlas_description: { zh: "一张图描述长度", en: "Atlas description length", action: "请缩短描述。", actionEn: "Shorten the description." },
    atlas_trend_hours: { zh: "一张图趋势时间范围", en: "Atlas trend range", action: "请选择更短的趋势时间范围。", actionEn: "Select a shorter trend range." },
};
export function formatLimitError(value: unknown, english = false): string | undefined {
    if (!value || typeof value !== "object")
        return;
    const detail = value as Record<string, unknown>;
    if (detail.reason === "PUBLIC_REQUEST_RATE") {
        const { maximum, window_seconds } = detail;
        if (typeof maximum !== "number" || typeof window_seconds !== "number") return;
        return english
            ? `Public device access: maximum ${maximum} requests per ${window_seconds} seconds to this endpoint for the same device and IP. Try again later.`
            : `公开设备访问过于频繁：同一设备、同一出口 IP 对此接口每 ${window_seconds} 秒最多请求 ${maximum} 次，请稍后重试。`;
    }
    if (detail.reason === "DATASET_TIME_WINDOW") {
        const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(english ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value)) : undefined;
        const start = time(detail.start_at), end = time(detail.end_at);
        if (!start && !end)
            return;
        return english ? `Query outside the dataset window (${start ?? "unbounded"} – ${end ?? "unbounded"}, Beijing time). Select a range within this window.` : `查询时间超出数据集范围：${start ?? "不限开始时间"} 至 ${end ?? "不限结束时间"}（北京时间）。请在此范围内查询。`;
    }
    if (detail.reason === "PASSWORD_LENGTH") {
        const { minimum, maximum } = detail;
        if (typeof minimum !== "number" || typeof maximum !== "number" || minimum <= 0 || maximum < minimum)
            return;
        return english ? `Password must be ${minimum}–${maximum} bytes. ASCII letters, digits and symbols use 1 byte each; Chinese characters usually use 3 bytes.` : `密码长度须为 ${minimum}–${maximum} 字节；英文字母、数字和英文符号各占 1 字节，中文通常各占 3 字节。`;
    }
    if (detail.reason === "VERIFICATION_LIMIT") {
        const { channel, period, maximum } = detail;
        if (!["sms", "email"].includes(String(channel)) || typeof maximum !== "number" || maximum <= 0)
            return;
        const name = channel === "sms" ? (english ? "SMS" : "短信") : (english ? "Email" : "邮箱");
        if (period === "daily")
            return english ? `${name} verification: maximum ${maximum} requests per account per day. Try again tomorrow.` : `同一${name}每天最多申请 ${maximum} 次验证码，请明天重试。`;
        if (period === "cooldown")
            return english ? `Wait at least ${maximum} seconds between ${name} verification code requests.` : `同一${name}两次申请验证码至少间隔 ${maximum} 秒，请稍后重试。`;
        return;
    }
    if (detail.reason === "DOWNLOAD_ALLOWANCE") {
        const { remaining_bytes, required_bytes } = detail;
        if (typeof remaining_bytes !== "number" || typeof required_bytes !== "number")
            return;
        const size = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString(english ? "en-US" : "zh-CN", { maximumFractionDigits: 2 })} MB`;
        return english ? `Insufficient download allowance: ${size(required_bytes)} required, ${size(remaining_bytes)} remaining including traffic packs. Ask the workspace owner to add allowance.` : `下载额度不足：本次需要 ${size(required_bytes)}，当前剩余 ${size(remaining_bytes)}（含流量包）。请联系组织所有者增加额度。`;
    }
    if (detail.reason !== "LIMIT_EXCEEDED" || typeof detail.field !== "string")
        return;
    if (["base_history_days", "base_export_days"].includes(detail.field) && typeof detail.maximum === "number" && detail.maximum > 0) {
        const action = detail.field === "base_history_days" ? (english ? "query" : "查询") : (english ? "export" : "导出");
        return english ? `The base plan can only ${action} the most recent ${detail.maximum} days. Select a range within this window or upgrade to Professional.${detail.field === "base_export_days" ? " Export end time cannot be in the future." : ""}` : `基础版仅能${action}最近 ${detail.maximum} 天的数据，请调整开始和结束时间，或升级专业版。${detail.field === "base_export_days" ? "导出结束时间不能晚于当前时间。" : ""}`;
    }
    const field = fields[detail.field];
    const maximum = detail.maximum;
    const actual = detail.actual;
    if (!field || typeof maximum !== "number" || !Number.isFinite(maximum) || maximum <= 0)
        return;
    const unit = typeof detail.unit === "string" ? detail.unit : "";
    const labels: Record<string, [
        string,
        string
    ]> = { days: ["天", "days"], hours: ["小时", "hours"], points: ["条", "records"], images: ["张", "photos"], characters: ["个字符", "characters"], devices: ["台", "devices"], items:["个","items"] };
    let limit: string;
    if (unit === "bytes")
        limit = `${maximum / (1024 * 1024)} MB`;
    else if (labels[unit])
        limit = `${maximum.toLocaleString(english ? "en-US" : "zh-CN")} ${labels[unit][english ? 1 : 0]}`;
    else
        return;
    const current = typeof actual === "number" && Number.isFinite(actual) && actual >= 0 && unit !== "bytes" ? english ? ` (requested ${actual.toLocaleString("en-US")})` : `（本次${unit === "days" ? "约" : ""}${actual.toLocaleString("zh-CN")} ${labels[unit]?.[0]}）` : "";
    return english ? `${field.en}: maximum ${limit}${current}. ${field.actionEn}` : `${field.zh}最多 ${limit}${current}。${field.action}`;
}
