/**
 * ROS interface types as values, matching rclcpp `std_msgs::msg::String`.
 *
 *   const msg = new std_msgs.msg.String();
 *   msg.data = "hello";
 *
 * Field names follow the ROS IDL (snake_case), not JS camelCase.
 * Message classes are generated from `.msg` / `.srv` / `.action`
 * (`scripts/rosidl-dts.ts`).
 */

import {
  Collections,
  EchoNested,
  EchoNested_Request,
  EchoNested_Response,
  MeasureSequence,
  MeasureSequence_Feedback,
  MeasureSequence_Goal,
  MeasureSequence_Result,
  NestedSample,
  PrimitiveScalars,
} from "./interfaces.generated.ts";

export {
  Time,
  Header,
  String,
  PointField,
  PointCloud2,
  PrimitiveScalars,
  NestedSample,
  Collections,
  EchoNested,
  EchoNested_Request,
  EchoNested_Response,
  MeasureSequence,
  MeasureSequence_Goal,
  MeasureSequence_Result,
  MeasureSequence_Feedback,
  builtin_interfaces,
  std_msgs,
  sensor_msgs,
  rclweb_cdr_interfaces,
} from "./interfaces.generated.ts";

export type MessageType<T> = {
  readonly typeName: string;
  new (): T;
};

/** A ROS type: the message class, or a `{ typeName }` / wire name string. */
export type TypeNameLike = string | { readonly typeName: string };

export function typeNameOf(type: TypeNameLike): string {
  return typeof type === "string" ? type : type.typeName;
}

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
