/**
 * ROS interface types as values, matching rclcpp `std_msgs::msg::String`.
 *
 *   const msg = new std_msgs.msg.String();
 *   msg.data = "hello";
 *
 * Field names follow the ROS IDL (snake_case), not JS camelCase.
 */

export type MessageType<T> = {
  readonly typeName: string;
  new (): T;
};

/** A ROS type: the message class, or a `{ typeName }` / wire name string. */
export type TypeNameLike = string | { readonly typeName: string };

export function typeNameOf(type: TypeNameLike): string {
  return typeof type === "string" ? type : type.typeName;
}

export class Time {
  static readonly typeName = "builtin_interfaces/msg/Time" as const;
  sec = 0;
  nanosec = 0;
}

export class Header {
  static readonly typeName = "std_msgs/msg/Header" as const;
  stamp = new Time();
  frame_id = "";
}

export class String {
  static readonly typeName = "std_msgs/msg/String" as const;
  data = "";
}

/** `sensor_msgs/msg/PointField` datatype constants (ROS IDL). */
export class PointField {
  static readonly typeName = "sensor_msgs/msg/PointField" as const;
  static readonly INT8 = 1;
  static readonly UINT8 = 2;
  static readonly INT16 = 3;
  static readonly UINT16 = 4;
  static readonly INT32 = 5;
  static readonly UINT32 = 6;
  static readonly FLOAT32 = 7;
  static readonly FLOAT64 = 8;
  name = "";
  offset = 0;
  datatype = 0;
  count = 0;
}

export class PointCloud2 {
  static readonly typeName = "sensor_msgs/msg/PointCloud2" as const;
  header = new Header();
  height = 0;
  width = 0;
  fields: PointField[] = [];
  is_bigendian = false;
  point_step = 0;
  row_step = 0;
  data = new Uint8Array();
  is_dense = true;
}

export class PrimitiveScalars {
  static readonly typeName = "rclweb_cdr_interfaces/msg/PrimitiveScalars" as const;
  bool_value = false;
  byte_value = 0;
  char_value = 0;
  float32_value = 0;
  float64_value = 0;
  int8_value = 0;
  uint8_value = 0;
  int16_value = 0;
  uint16_value = 0;
  int32_value = 0;
  uint32_value = 0;
  int64_value = 0n;
  uint64_value = 0n;
  string_value = "";
  wstring_value = "";
}

export class Collections {
  static readonly typeName = "rclweb_cdr_interfaces/msg/Collections" as const;
  fixed_i32: [number, number, number] = [0, 0, 0];
  bounded_f64: number[] = [];
  bytes_value = new Uint8Array();
  bounded_string = "";
  bounded_wstring = "";
}

export class NestedSample {
  static readonly typeName = "rclweb_cdr_interfaces/msg/NestedSample" as const;
  stamp = new Time();
  scalars = new PrimitiveScalars();
  collections = new Collections();
}

export const builtin_interfaces = {
  msg: { Time },
};

export const std_msgs = {
  msg: { String, Header },
};

export const sensor_msgs = {
  msg: { PointCloud2, PointField },
};

export class EchoNested_Request {
  static readonly typeName = "rclweb_cdr_interfaces/srv/EchoNested_Request" as const;
  input = new NestedSample();
}

export class EchoNested_Response {
  static readonly typeName = "rclweb_cdr_interfaces/srv/EchoNested_Response" as const;
  output = new NestedSample();
  accepted = false;
}

export const EchoNested = {
  typeName: "rclweb_cdr_interfaces/srv/EchoNested" as const,
  Request: EchoNested_Request,
  Response: EchoNested_Response,
};

export class MeasureSequence_Goal {
  static readonly typeName = "rclweb_cdr_interfaces/action/MeasureSequence_Goal" as const;
  target = new Collections();
}

export class MeasureSequence_Result {
  static readonly typeName = "rclweb_cdr_interfaces/action/MeasureSequence_Result" as const;
  result = new NestedSample();
}

export class MeasureSequence_Feedback {
  static readonly typeName = "rclweb_cdr_interfaces/action/MeasureSequence_Feedback" as const;
  progress = 0;
  sample = new NestedSample();
}

export const MeasureSequence = {
  typeName: "rclweb_cdr_interfaces/action/MeasureSequence" as const,
  Goal: MeasureSequence_Goal,
  Result: MeasureSequence_Result,
  Feedback: MeasureSequence_Feedback,
};

export const rclweb_cdr_interfaces = {
  msg: { PrimitiveScalars, NestedSample, Collections },
  srv: { EchoNested },
  action: { MeasureSequence },
};

export function isGeneratedMsgType(typeName: string): boolean {
  return (
    typeName === PrimitiveScalars.typeName ||
    typeName === NestedSample.typeName ||
    typeName === Collections.typeName
  );
}

export type GeneratedOpKind = "Request" | "Response" | "Goal" | "Result" | "Feedback";

/** Sectioned ROS type for a service/action payload on the OpenChannel parent name. */
export function generatedOpTypeName(
  channelType: string,
  op: GeneratedOpKind,
): string | undefined {
  if (channelType === EchoNested.typeName) {
    if (op === "Request") return EchoNested_Request.typeName;
    if (op === "Response") return EchoNested_Response.typeName;
    return undefined;
  }
  if (channelType === MeasureSequence.typeName) {
    if (op === "Goal") return MeasureSequence_Goal.typeName;
    if (op === "Result") return MeasureSequence_Result.typeName;
    if (op === "Feedback") return MeasureSequence_Feedback.typeName;
  }
  return undefined;
}
