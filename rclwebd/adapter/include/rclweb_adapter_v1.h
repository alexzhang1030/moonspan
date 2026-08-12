/* rclweb serialized ROS adapter ABI v1 (ADR 0006).
 *
 * Versioned structs, opaque handles, stable status codes, and explicit buffer
 * ownership. The gateway Rust side mirrors these layouts in
 * `rclwebd/src/adapter/`. Distro/RMW variation stays behind this surface.
 *
 * ABI identity string: "serialized-adapter-v1"
 */
#ifndef RCLWEB_ADAPTER_V1_H_
#define RCLWEB_ADAPTER_V1_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RCLWEB_ADAPTER_ABI_MAJOR 1u
#define RCLWEB_ADAPTER_ABI_MINOR 0u
#define RCLWEB_ADAPTER_ABI_VERSION_STRING "serialized-adapter-v1"

/* Stable status codes (map to R2WP wire codes at the Rust edge where noted). */
typedef enum rclweb_adapter_status_e {
  RCLWEB_ADAPTER_OK = 0,
  RCLWEB_ADAPTER_SCHEMA_UNAVAILABLE = 10, /* wire 10 */
  RCLWEB_ADAPTER_QOS_INCOMPATIBLE = 11,   /* wire 11 */
  RCLWEB_ADAPTER_RESOURCE_EXHAUSTED = 13, /* wire 13 */
  RCLWEB_ADAPTER_TIMEOUT = 14,
  RCLWEB_ADAPTER_INVALID_ARGUMENT = 15,
  RCLWEB_ADAPTER_PROFILE_MISMATCH = 16, /* readiness: adapter_profile_mismatch */
  RCLWEB_ADAPTER_INTERNAL = 17
} rclweb_adapter_status_t;

/* Opaque entity handle (context/node/pub/sub/client/service/action). */
typedef uint64_t rclweb_adapter_handle_t;

#define RCLWEB_ADAPTER_HANDLE_INVALID ((rclweb_adapter_handle_t)0)

/* Buffer owned by the allocating side; release via the matching release op. */
typedef struct rclweb_adapter_buffer_v1_s {
  uint8_t *data;
  size_t length;
  size_t capacity;
  /* 0 = Rust/gateway heap; 1 = adapter/ROS heap. */
  uint32_t owner;
  uint32_t reserved;
} rclweb_adapter_buffer_v1_t;

#define RCLWEB_ADAPTER_BUFFER_OWNER_RUST 0u
#define RCLWEB_ADAPTER_BUFFER_OWNER_ADAPTER 1u

typedef struct rclweb_adapter_status_record_v1_s {
  uint32_t abi_major;
  uint32_t abi_minor;
  rclweb_adapter_status_t code;
  /* NUL-terminated detail; empty when unused. */
  char message[256];
} rclweb_adapter_status_record_v1_t;

typedef struct rclweb_adapter_probe_v1_s {
  uint32_t abi_major;
  uint32_t abi_minor;
  /* Support-row id, e.g. "J-FT" / "H-FT". */
  char support_row_id[16];
  /* ROS distro id, e.g. "jazzy" / "humble". */
  char ros_distro[32];
  /* RMW implementation identifier. */
  char rmw_implementation[64];
  /* ABI version string (RCLWEB_ADAPTER_ABI_VERSION_STRING). */
  char abi_version[32];
} rclweb_adapter_probe_v1_t;

/* Bounded SPSC queue limits declared at adapter attach. */
typedef struct rclweb_adapter_queue_limits_v1_s {
  uint32_t command_capacity;
  uint32_t event_capacity;
  uint64_t command_max_bytes;
  uint64_t event_max_bytes;
} rclweb_adapter_queue_limits_v1_t;

#ifdef __cplusplus
}
#endif

#endif /* RCLWEB_ADAPTER_V1_H_ */
