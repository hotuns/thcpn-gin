import type { JsonRecord } from "@thcpn/api";

export type ConfigSaveReview = { payload: JsonRecord; changes: string[]; warnings: string[]; destructive: boolean };
