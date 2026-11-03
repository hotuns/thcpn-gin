import { type Dataset } from "@thcpn/api";
import { type SourceInput } from "./dataset-model";

export const datasetTypeLabel = (value: Dataset["data_type"]) =>
  ({
    telemetry: "设备数据",
    image: "图片",
    video: "视频",
    audio: "音频",
    event: "事件",
    log: "日志",
    mixed: "混合数据",
  })[value] ?? value;

export const datasetStatusLabel = (value: Dataset["status"]) =>
  ({
    draft: "草稿",
    published: "已发布",
    locked: "已锁定",
    archived: "已归档",
  })[value] ?? value;

export const sourceTypeLabel = (value: SourceInput["source_type"]) =>
  ({ device: "设备", data_stream: "数据指标", file: "文件" })[value] ?? value;

export const displayTime = (input?: string) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(input))
    : "—";
