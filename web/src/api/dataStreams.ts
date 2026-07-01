import { get, post } from "./client";
import type {
  DataStream,
  DataStreamBindingAdapterCode,
  DataStreamBinding,
  DataStreamBindingListResponse,
  DataStreamBindingPayloadType,
  DataStreamListResponse,
  DataStreamType
} from "./types";

export const dataStreamsApi = {
  list(deviceId: string): Promise<DataStreamListResponse> {
    return get<DataStreamListResponse>("/api/v1/data-streams", { device_id: deviceId });
  },

  create(input: {
    device_id: string;
    code: string;
    name: string;
    type: DataStreamType;
    unit?: string;
  }): Promise<DataStream> {
    return post<DataStream>("/api/v1/data-streams", input);
  }
};

export const bindingsApi = {
  list(dataStreamId: string): Promise<DataStreamBindingListResponse> {
    return get<DataStreamBindingListResponse>("/api/v1/data-stream-bindings", { data_stream_id: dataStreamId });
  },

  create(input: {
    data_stream_id: string;
    data_source_id: string;
    adapter_code: DataStreamBindingAdapterCode;
    database_name?: string;
    schema_name?: string;
    table_name?: string;
    device_key_field?: string;
    device_key_value?: string;
    time_field?: string;
    value_field?: string;
    payload_type: DataStreamBindingPayloadType;
    adapter_config?: Record<string, unknown>;
  }): Promise<DataStreamBinding> {
    return post<DataStreamBinding>("/api/v1/data-stream-bindings", input);
  }
};
