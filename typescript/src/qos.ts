/**
 * rclcpp-shaped QoS: a history depth number is KeepLast(n) + reliable.
 *
 *   node.createPublisher(std_msgs.msg.String, "chatter", 10)
 *   node.createPublisher(std_msgs.msg.String, "chatter", new QoS(10).bestEffort())
 *
 * Reliability numbers match the core OpenChannel subset: 1 RELIABLE, 2 BEST_EFFORT.
 */

import type { QosOptions } from "./types.ts";

export const RELIABLE = 1;
export const BEST_EFFORT = 2;

export class QoS {
  #depth: number;
  #reliability = RELIABLE;

  constructor(historyDepth: number) {
    this.#depth = historyDepth;
  }

  keepLast(depth: number): this {
    this.#depth = depth;
    return this;
  }

  reliable(): this {
    this.#reliability = RELIABLE;
    return this;
  }

  bestEffort(): this {
    this.#reliability = BEST_EFFORT;
    return this;
  }

  /** @internal */
  toOptions(): QosOptions {
    return { depth: this.#depth, reliability: this.#reliability };
  }
}

/** rclcpp `KeepLast(n)` — KeepLast history with reliable by default. */
export function KeepLast(depth: number): QoS {
  return new QoS(depth);
}

export type QoSInput = number | QoS;

export function qosToOptions(qos: QoSInput): QosOptions {
  if (typeof qos === "number") {
    return { depth: qos, reliability: RELIABLE };
  }
  return qos.toOptions();
}
