# Documentation

Start here if you are writing a browser app against ROS 2:

| I want to… | Read |
|---|---|
| Install and connect | [How to](./typescript.md#install) |
| Create a node | [Node](./typescript.md#node) |
| Publish / subscribe | [Topics](./typescript.md#topics) |
| Call or host a service | [Services](./typescript.md#services) |
| Send or host an action | [Actions](./typescript.md#actions) |
| Look up every method | [API reference](./api.md) |
| Run the gateway | [Deploy `rclwebd`](./deploy.md) |

Runnable demo: [`examples/subscribe-chatter`](../examples/subscribe-chatter/).

## Internals

These pages are for people changing this repository, not for calling `Node`.

| Topic | Document |
|---|---|
| What ships, what does not | [Product scope](./product-scope.md) |
| Process boundaries | [Architecture](./architecture.md) |
| Sample path vs Foxglove / rosbridge | [Performance](./performance.md) |
| Related projects | [Landscape](./landscape.md), [references](./references.md) |
| Wire protocol | [R2WP](./protocol/r2wp.md) |
| Rust core / CDR | [`rclweb` core](./runtime/core.md), [CDR](./runtime/cdr.md), [generated types](./runtime/generated-types.md) |
| Gateway internals | [`rclwebd`](./gateway/rclwebd.md), [security](./security.md), [ACL reference](./acl-reference.json) |
| Support rows | [Support matrix](./support-matrix.md), [compatibility](./compatibility.md) |
| How CI proves claims | [Validation](./validation.md) |
| License | [Licensing](./licensing.md), [third-party inventory](./third-party.md) |
| Publish to npm / crates.io | [Release](./release.md) |
| Decisions | [ADR register](./adr/README.md) |
| Open work | [Open work](../tasks/plan.md) |
| Studio (not in tree) | [Studio prototype](./prototypes/studio-ui.md), [design system](../.agents/docs/DESIGN.md) |

Workspace routes for contributors: [CONTRIBUTING.md](../CONTRIBUTING.md),
[PCR map](../.agents/docs/README.md).
