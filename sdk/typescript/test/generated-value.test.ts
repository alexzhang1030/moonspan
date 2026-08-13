import { expect, test } from "bun:test";
import {
  decodeGeneratedHostValue,
  encodeGeneratedHostValue,
  reviveGenerated,
  sampleEchoNestedRequest,
  sampleEchoNestedResponse,
  sampleNestedSample,
  samplePrimitiveScalars,
} from "../src/generated-value.ts";
import {
  Collections,
  EchoNested_Request,
  EchoNested_Response,
  NestedSample,
  PrimitiveScalars,
  Time,
  generatedOpTypeName,
} from "../src/interfaces.ts";

test("host-value round-trips PrimitiveScalars including bigint", () => {
  const original = samplePrimitiveScalars();
  const bytes = encodeGeneratedHostValue(PrimitiveScalars.typeName, original);
  const round = decodeGeneratedHostValue(PrimitiveScalars.typeName, bytes);
  expect(round).toBeInstanceOf(PrimitiveScalars);
  const msg = round as PrimitiveScalars;
  expect(msg.bool_value).toBe(true);
  expect(msg.byte_value).toBe(7);
  expect(msg.char_value).toBe(65);
  expect(msg.float32_value).toBeCloseTo(1.5);
  expect(msg.float64_value).toBeCloseTo(2.25);
  expect(msg.int8_value).toBe(-3);
  expect(msg.uint8_value).toBe(9);
  expect(msg.int16_value).toBe(-300);
  expect(msg.uint16_value).toBe(400);
  expect(msg.int32_value).toBe(-50_000);
  expect(msg.uint32_value).toBe(60_000);
  expect(msg.int64_value).toBe(-70_000n);
  expect(msg.uint64_value).toBe(80_000n);
  expect(msg.string_value).toBe("hello-scalars");
  expect(msg.wstring_value).toBe("wide");
});

test("host-value round-trips NestedSample collections", () => {
  const original = sampleNestedSample();
  const bytes = encodeGeneratedHostValue(NestedSample.typeName, original);
  const round = decodeGeneratedHostValue(NestedSample.typeName, bytes);
  expect(round).toBeInstanceOf(NestedSample);
  const msg = round as NestedSample;
  expect(msg.stamp.sec).toBe(11);
  expect(msg.stamp.nanosec).toBe(22);
  expect(msg.scalars.string_value).toBe("hello-scalars");
  expect(msg.collections.fixed_i32).toEqual([1, 2, 3]);
  expect(msg.collections.bounded_f64).toEqual([1.0, 2.0]);
  expect([...msg.collections.bytes_value]).toEqual([10, 20, 30]);
  expect(msg.collections.bounded_string).toBe("abc");
  expect(msg.collections.bounded_wstring).toBe("xyz");
});

test("reviveGenerated reconstructs class instances after structured clone", () => {
  const original = sampleNestedSample();
  const cloned = structuredClone(original);
  const msg = reviveGenerated(NestedSample.typeName, cloned) as NestedSample;
  expect(msg).toBeInstanceOf(NestedSample);
  expect(msg.stamp).toBeInstanceOf(Time);
  expect(msg.scalars.int64_value).toBe(-70_000n);
  expect(msg.collections).toBeInstanceOf(Collections);
});

test("host-value round-trips EchoNested request and response", () => {
  const request = sampleEchoNestedRequest();
  const reqBytes = encodeGeneratedHostValue(EchoNested_Request.typeName, request);
  const reqRound = decodeGeneratedHostValue(
    EchoNested_Request.typeName,
    reqBytes,
  ) as EchoNested_Request;
  expect(reqRound).toBeInstanceOf(EchoNested_Request);
  expect(reqRound.input.scalars.string_value).toBe("hello-scalars");
  expect(reqRound.input.scalars.int64_value).toBe(-70_000n);
  expect(reqRound.input.collections.bounded_string).toBe("abc");

  const response = sampleEchoNestedResponse();
  const resBytes = encodeGeneratedHostValue(EchoNested_Response.typeName, response);
  const resRound = decodeGeneratedHostValue(
    EchoNested_Response.typeName,
    resBytes,
  ) as EchoNested_Response;
  expect(resRound).toBeInstanceOf(EchoNested_Response);
  expect(resRound.accepted).toBe(true);
  expect(resRound.output.stamp.sec).toBe(11);
});

test("generatedOpTypeName maps parent service and action sections", () => {
  expect(generatedOpTypeName("rclweb_cdr_interfaces/srv/EchoNested", "Request")).toBe(
    EchoNested_Request.typeName,
  );
  expect(generatedOpTypeName("rclweb_cdr_interfaces/srv/EchoNested", "Response")).toBe(
    EchoNested_Response.typeName,
  );
  expect(generatedOpTypeName("example_interfaces/srv/AddTwoInts", "Request")).toBeUndefined();
});
