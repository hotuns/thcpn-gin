export type StreamPurpose = "measurement" | "status" | "location";
export const streamPurpose = (stream: { purpose?: StreamPurpose }) => stream.purpose ?? "measurement";
export const isMeasurement = (stream: { purpose?: StreamPurpose }) => streamPurpose(stream) === "measurement";
export const streamPurposeLabel = (stream: { purpose?: StreamPurpose }) => ({measurement:"采集指标",status:"运行状态",location:"定位信息"})[streamPurpose(stream)];
