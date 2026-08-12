# 0007: Lock phase-one Humble and Jazzy schema identity strategy

## Status

Accepted

## Date

2026-08-10

## Context

Browser runtime, R2WP, gateway caches, fixtures, and recording metadata need a stable schema identity across ROS distros that expose different type-description surfaces. Phase one qualifies two LTS platforms with three first-class RMW implementations each.

## Decision

Lock the first-phase schema identity and acquisition strategy on ROS 2 Humble Hawksbill and ROS 2 Jazzy Jalisco.

- Phase-one distros are Humble Hawksbill and Jazzy Jalisco. Qualification matrix targets are Humble on Ubuntu 22.04 Jammy and Jazzy on Ubuntu 24.04 Noble, each on `amd64` and `arm64`.
- Both distros use `rmw_fastrtps_cpp` as the default and reference support row and qualify `rmw_cyclonedds_cpp` and `rmw_zenoh_cpp` as peer first-class rows. Each distro/RMW combination is an independent support row (H-FT, H-CY, H-ZN, J-FT, J-CY, J-ZN).
- Jazzy uses native `GetTypeDescription` with REP-2011 RIHS. That identity scheme is named `rep2011-rihs`.
- Humble uses `rclcpp` generic serialized publish and subscribe together with runtime type-support libraries. Phase-one custom types ship with a complete, recursive, versioned schema bundle and manifest at deployment. Channel open returns a stable `schema_unavailable` error when the required bundle is missing.
- Humble bundles use the independent identity scheme `rclweb-schema-v1`. The value is the SHA-256 digest of the deterministic canonical bundle bytes. That digest keeps the `rclweb-schema-v1` scheme and stays a separate identity from `rep2011-rihs`.
- Unified schema identity is the pair `(scheme, value)`. R2WP, the C ABI, caches, fixtures, and recording metadata carry `scheme`, `value`, type name, encoding, and schema generation together.
- A canonical bundle includes at least the root type name, the recursive dependency graph, each source entry's type name, encoding, and content, and the generator revision. Entry ordering and byte canonicalization freeze in M0-04 and validate through cross-language golden fixtures.
- Humble and Jazzy may reuse the same application schema bundle. On Jazzy, deployments record a mapping between `rep2011-rihs` and the bundle digest for provenance and cross-version lookup. The two identity schemes remain independent.
- Kilted, Lyrical, and Rolling are later expansion candidates. Zenoh router topologies beyond the Phase 1 `rmw_zenoh_cpp` support rows remain later topology work.

## Rationale

- Humble and Jazzy give two LTS baselines with documented Ubuntu host targets and broad robotics adoption.
- Independent distro/RMW support rows keep Fast DDS, Cyclone DDS, and Zenoh evidence separable while sharing one R2WP and SDK contract surface.
- `rep2011-rihs` matches Jazzy's native type-description and type-hash path.
- `rclweb-schema-v1` supplies a deterministic identity for Humble deployments that ship recursive schema bundles with generic serialized interfaces.
- Carrying `(scheme, value)` with type name, encoding, and generation keeps every cache, channel, fixture, and recording record explicit about which identity system produced the value.
- Recording RIHS-to-bundle mappings on Jazzy preserves provenance across distros while leaving each scheme's meaning intact.

## Consequences

- Phase-one qualification covers Humble/Jammy and Jazzy/Noble on `amd64` and `arm64` for `rmw_fastrtps_cpp`, `rmw_cyclonedds_cpp`, and `rmw_zenoh_cpp` support rows.
- Gateway channel setup and browser type registries key schema state by `(scheme, value)` plus type name, encoding, and schema generation.
- Humble custom-type deployments include complete recursive bundles; open attempts that lack the bundle surface `schema_unavailable`.
- M0-04 freezes canonical bundle layout, ordering, hashing, and cross-language fixtures for `rclweb-schema-v1`.
- This decision is reflected in [compatibility](../compatibility.md), [R2WP](../protocol/r2wp.md), [the core runtime](../runtime/core.md), [`rclwebd`](../gateway/rclwebd.md), [support matrix](../support-matrix.md), [validation](../validation.md), and the [implementation plan](../../tasks/plan.md).

## Revisit triggers

- Humble or Jazzy type-description, generic serialized, or RIHS platform behavior changes in a way that breaks the declared schemes.
- Canonical bundle hashing, ordering, or fixture agreement falls outside an accepted M0-04 gate.
- A phase-one deployment needs an identity scheme beyond `rep2011-rihs` and `rclweb-schema-v1`.
- Kilted, Lyrical, Rolling, or additional Zenoh router topology evidence is ready to enter the active support matrix.

## Source

- ROS distro and platform targets: [REP-2000](https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-2000.rst)
- Humble generic publish and subscribe: [`rclcpp::GenericPublisher`](https://docs.ros.org/en/humble/p/rclcpp/generated/classrclcpp_1_1GenericPublisher.html), [`rclcpp::GenericSubscription`](https://docs.ros.org/en/humble/p/rclcpp/generated/classrclcpp_1_1GenericSubscription.html)
- Humble runtime type support: [`rclcpp::get_typesupport_library`](https://docs.ros.org/en/ros2_packages/humble/api/rclcpp/generated/function_namespacerclcpp_1a629c76e9f974bbaed3b82b030f7f1b01.html)
- Jazzy release surface: [Jazzy Jalisco complete changelog](https://docs.ros.org/en/jazzy/Releases/Jazzy-Jalisco-Complete-Changelog.html)
- Jazzy type description fetch: [`rcl_node_type_description_service`](https://docs.ros.org/en/ros2_packages/jazzy/api/rcl/generated/function_node_8h_1a44baca8938b0a97a9f0a53ff9264ba36.html)
- Local architecture ownership: [architecture](../architecture.md), [architecture rationale](../../.agents/docs/architecture.md), [compatibility](../compatibility.md)
