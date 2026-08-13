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

export const builtin_interfaces = {
  msg: { Time },
};

export const std_msgs = {
  msg: { String, Header },
};

export const sensor_msgs = {
  msg: { PointCloud2, PointField },
};
